package hub

import (
	"bytes"
	"context"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/notmarkopadjen/muxway/internal/secure"
	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

// A share lets one person watch one pane, read only, with a link and a
// password sent apart. The record lives in hub.json beside the tokens;
// the password's hash only. An observer is never a principal: the share
// cookie travels only under /v1/share/{id}/, whose handlers read one pane
// by its id and serve what the sharer's page is showing, nothing else.

const (
	shareCookie   = "muxway_share"
	shareTTL      = 24 * time.Hour
	shareMinTTL   = time.Minute
	shareMaxTTL   = 7 * 24 * time.Hour
	shareFails    = 10 // wrong passwords before the share is burned
	sharesPerUser = 20
	sharesPerHub  = 200
	shareRate     = 0.1 // shares made per second per principal after a burst: one every ten seconds
	shareBurst    = sharesPerUser
	openRate      = 1 // password attempts per second per address
	openBurst     = 5
	probeRate     = 5 // link probes per second per address
	probeBurst    = 10
	showingTTL    = 10 * time.Minute // a showing the sharer's page stops refreshing
	changesMax    = 1 << 20          // the changes window as JSON
	paneGoneAfter = time.Minute      // a pane missing from its host's listing this long ends the share
	pbkdfRounds   = 210_000
	passwordMin   = 8
	passwordMax   = 64
	showingKinds  = "file diff"
	showingViews  = "rendered plain diff file"
	changeKinds   = "added modified deleted renamed untracked conflict"
)

// Share is the record kept on disk.
type Share struct {
	ID      string    `json:"id"`     // in the link
	Handle  string    `json:"handle"` // names it in logs and to admins
	Hash    string    `json:"hash"`
	Salt    string    `json:"salt"`
	By      string    `json:"by"`     // the sharer's principal id
	Method  string    `json:"method"` // token, or the sharer's provider
	Name    string    `json:"name"`   // the sharer's name, for the host's audit
	Host    string    `json:"host"`
	PaneID  string    `json:"pane_id"`
	Created time.Time `json:"created"`
	Expires time.Time `json:"expires"`
}

// What the sharer's page shows over the pane, held for the observers.
type showing struct {
	Kind  string `json:"kind"`
	Path  string `json:"path"`
	View  string `json:"view"`
	Type  string `json:"type"`
	Bytes int    `json:"bytes"`
	// FileRev is the revision the bytes last changed at, so an observer
	// fetches them once and keeps them while only the meta or the
	// changes window moves.
	FileRev uint64 `json:"file_rev"`
	data    []byte
	set     time.Time
}

// The changes window the sharer's page has open, held for the observers.
type shownChanges struct {
	wire.Changes
	Folded bool `json:"folded,omitempty"`
	set    time.Time
}

// The hub's memory of a share: failures, observers, the showing and the
// changes window.
type shareLive struct {
	fails   int
	missing time.Time // when the pane was first not listed
	rev     uint64
	show    *showing
	changes *shownChanges
	wake    chan struct{}
}

type observer struct {
	id      string
	share   string
	addr    string
	created time.Time
	expires time.Time
	seen    time.Time
}

type shareState struct {
	mu        sync.Mutex
	live      map[string]*shareLive
	observers map[string]*observer
}

func newShareState() *shareState {
	return &shareState{live: map[string]*shareLive{}, observers: map[string]*observer{}}
}

func (s *shareState) of(id string) *shareLive {
	l, ok := s.live[id]
	if !ok {
		l = &shareLive{wake: make(chan struct{})}
		s.live[id] = l
	}
	return l
}

// forget drops everything the hub holds for a share, its observers too.
func (s *shareState) forget(id string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	if l, ok := s.live[id]; ok {
		close(l.wake)
		delete(s.live, id)
	}
	n := 0
	for oid, o := range s.observers {
		if o.share == id {
			delete(s.observers, oid)
			n++
		}
	}
	return n
}

func (s *shareState) watching(id string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	now := time.Now()
	for _, o := range s.observers {
		if o.share == id && now.Before(o.expires) {
			n++
		}
	}
	return n
}

// --- the store -------------------------------------------------------------

func (st *Store) addShare(sh Share) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	st.s.Shares = append(st.s.Shares, sh)
	return st.save()
}

func (st *Store) shareByID(id string) (Share, bool) {
	st.mu.RLock()
	defer st.mu.RUnlock()
	for _, sh := range st.s.Shares {
		if subtle.ConstantTimeCompare([]byte(sh.ID), []byte(id)) == 1 {
			return sh, time.Now().Before(sh.Expires)
		}
	}
	return Share{}, false
}

func (st *Store) shares() []Share {
	st.mu.RLock()
	defer st.mu.RUnlock()
	now := time.Now()
	var out []Share
	for _, sh := range st.s.Shares {
		if now.Before(sh.Expires) {
			out = append(out, sh)
		}
	}
	return out
}

func (st *Store) dropShare(id string) (Share, bool, error) {
	st.mu.Lock()
	defer st.mu.Unlock()
	for i, sh := range st.s.Shares {
		if sh.ID == id {
			st.s.Shares = append(st.s.Shares[:i], st.s.Shares[i+1:]...)
			return sh, true, st.save()
		}
	}
	return Share{}, false, nil
}

// dropExpiredShares removes the records whose time is up and returns them.
func (st *Store) dropExpiredShares() []Share {
	st.mu.Lock()
	defer st.mu.Unlock()
	now := time.Now()
	var gone []Share
	kept := st.s.Shares[:0]
	for _, sh := range st.s.Shares {
		if now.Before(sh.Expires) {
			kept = append(kept, sh)
		} else {
			gone = append(gone, sh)
		}
	}
	st.s.Shares = kept
	if len(gone) > 0 {
		st.save()
	}
	return gone
}

// --- passwords -------------------------------------------------------------

const passwordAlphabet = "abcdefghijklmnopqrstuvwxyz234567"

// newPassword is twelve letters and digits in three groups: 60 bits, and
// nothing a phone's keyboard makes hard.
func newPassword() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	var b strings.Builder
	for i, c := range buf {
		if i > 0 && i%4 == 0 {
			b.WriteByte('-')
		}
		b.WriteByte(passwordAlphabet[int(c)&31])
	}
	return b.String()
}

func validPassword(s string) bool {
	n := utf8.RuneCountInString(s)
	if n < passwordMin || n > passwordMax || !utf8.ValidString(s) {
		return false
	}
	return !strings.ContainsFunc(s, func(r rune) bool { return unicode.IsControl(r) })
}

func hashPassword(password, salt string) string {
	raw, _ := hex.DecodeString(salt)
	key, err := pbkdf2.Key(sha256.New, password, raw, pbkdfRounds, 32)
	if err != nil {
		panic(err)
	}
	return hex.EncodeToString(key)
}

func (sh Share) passwordIs(password string) bool {
	return subtle.ConstantTimeCompare([]byte(hashPassword(password, sh.Salt)), []byte(sh.Hash)) == 1
}

// --- the sharer's side -----------------------------------------------------

func (h *Hub) shareURL(id string) string {
	base := strings.TrimSuffix(h.cfg.PublicURL, "/")
	return base + "/s/" + id
}

type shareView struct {
	ID       string `json:"id"`
	URL      string `json:"url"`
	Password string `json:"password,omitempty"`
	Expires  int64  `json:"expires"`
	Host     string `json:"host"`
	PaneID   string `json:"pane_id"`
	Address  string `json:"address,omitempty"`
	Watching int    `json:"watching"`
}

func (h *Hub) viewShare(ctx context.Context, sh Share) shareView {
	v := shareView{ID: sh.ID, URL: h.shareURL(sh.ID), Expires: sh.Expires.Unix(), Host: sh.Host, PaneID: sh.PaneID,
		Watching: h.shares.watching(sh.ID)}
	if p, ok := h.sharedPane(ctx, sh); ok {
		v.Address = sh.Host + "/" + p.Address()
	}
	return v
}

// sharedPane finds the share's pane on its host, as the agent lists it.
func (h *Hub) sharedPane(ctx context.Context, sh Share) (tmux.Pane, bool) {
	a := h.await(ctx, sh.Host)
	if a == nil {
		return tmux.Pane{}, false
	}
	panes, err := a.panes(ctx)
	if err != nil {
		return tmux.Pane{}, false
	}
	for _, p := range panes {
		if p.PaneID == sh.PaneID {
			return p, true
		}
	}
	return tmux.Pane{}, false
}

// sharerAlive says whether the principal that made the share still exists.
func (h *Hub) sharerAlive(sh Share) bool {
	if sh.Method == "token" {
		_, ok := h.store.tokenByID(sh.By)
		return ok
	}
	_, ok := h.store.userByID(sh.By)
	return ok
}

// handleShareCreate makes a share of a pane the principal may write.
func (h *Hub) handleShareCreate(w http.ResponseWriter, r *http.Request, t Principal) {
	path, _ := strings.CutSuffix(r.PathValue("path"), "/shares")
	var in struct {
		TTL      *int   `json:"ttl"`
		Password string `json:"password"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil && !errors.Is(err, io.EOF) {
		fail(w, http.StatusBadRequest, "bad_json")
		return
	} else if err == nil {
		if _, err := dec.Token(); err != io.EOF {
			fail(w, http.StatusBadRequest, "bad_json")
			return
		}
	}
	ttl := shareTTL
	if in.TTL != nil {
		ttl = time.Duration(*in.TTL) * time.Second
		if ttl < shareMinTTL || ttl > shareMaxTTL {
			fail(w, http.StatusBadRequest, "bad_input")
			return
		}
	}
	if in.Password != "" && !validPassword(in.Password) {
		fail(w, http.StatusBadRequest, "bad_input")
		return
	}
	host := r.PathValue("host")
	_, p, status := h.locate(r.Context(), t, host, path)
	if status == http.StatusServiceUnavailable {
		fail(w, status, "host_offline")
		return
	}
	if status != 0 {
		fail(w, status, "not_found")
		return
	}
	attrs := []any{"token", t.ID, "method", t.Method, "host", host, "pane", p.PaneID}
	if !t.canWrite(host, p) || p.Mode != tmux.ModeWrite {
		fail(w, http.StatusForbidden, "read_only")
		return
	}
	mine, all := 0, 0
	for _, sh := range h.store.shares() {
		all++
		if sh.By == t.ID {
			mine++
		}
	}
	if mine >= sharesPerUser || all >= sharesPerHub {
		h.log.Info("audit share", append(attrs, "result", "too_many")...)
		fail(w, http.StatusConflict, "too_many")
		return
	}
	if !h.limits.allowNamed("share:"+t.ID, shareRate, shareBurst) {
		fail(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	password := in.Password
	if password == "" {
		password = newPassword()
	}
	now := time.Now().UTC()
	expires := now.Add(ttl)
	if t.Expires.Before(expires) {
		expires = t.Expires
	}
	salt := make([]byte, 16)
	rand.Read(salt)
	sh := Share{ID: secure.Random(16), Handle: secure.Random(6), Salt: hex.EncodeToString(salt),
		By: t.ID, Method: t.Method, Name: t.Name, Host: host, PaneID: p.PaneID, Created: now, Expires: expires}
	sh.Hash = hashPassword(password, sh.Salt)
	if err := h.store.addShare(sh); err != nil {
		h.log.Error("share not saved", "err", err)
		fail(w, http.StatusInternalServerError, "hub_error")
		return
	}
	h.log.Info("share created", append(attrs, "share", sh.Handle, "expires", expires.Unix())...)
	v := h.viewShare(r.Context(), sh)
	v.Password = password
	created(w, map[string]any{"share": v})
}

func (h *Hub) handleShares(w http.ResponseWriter, r *http.Request, t Principal) {
	out := []shareView{}
	for _, sh := range h.store.shares() {
		if sh.By == t.ID {
			out = append(out, h.viewShare(r.Context(), sh))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Expires < out[j].Expires })
	reply(w, map[string]any{"shares": out})
}

// handleShareRevoke ends a share of the principal's, or any for an admin.
func (h *Hub) handleShareRevoke(w http.ResponseWriter, r *http.Request, t Principal) {
	sh, ok := h.store.shareByID(r.PathValue("id"))
	if !ok || (sh.By != t.ID && !t.Admin) {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	h.endShare(sh, "revoked", "by", t.ID)
	w.WriteHeader(http.StatusNoContent)
}

// endShare removes a share and everything held for it, and says why.
func (h *Hub) endShare(sh Share, why string, attrs ...any) {
	h.store.dropShare(sh.ID)
	watching := h.shares.forget(sh.ID)
	h.log.Info("share "+why, append([]any{"share", sh.Handle, "host", sh.Host, "pane", sh.PaneID, "watching", watching}, attrs...)...)
}

// dropSharesBy ends every share a principal made, when it goes.
func (h *Hub) dropSharesBy(id string) {
	for _, sh := range h.store.shares() {
		if sh.By == id {
			h.endShare(sh, "ended with its sharer")
		}
	}
}

// sharedCounts says, per pane, how many live shares the principal made.
func (h *Hub) sharedCounts(t Principal) map[string]int {
	var out map[string]int
	for _, sh := range h.store.shares() {
		if sh.By == t.ID {
			if out == nil {
				out = map[string]int{}
			}
			out[sh.Host+" "+sh.PaneID]++
		}
	}
	return out
}

func (h *Hub) withShared(t Principal, vs []PaneView) {
	counts := h.sharedCounts(t)
	if counts == nil {
		return
	}
	for i := range vs {
		vs[i].Shared = counts[vs[i].Host+" "+vs[i].PaneID]
	}
}

// sharerShare finds a live share of the principal's by id, with the pane
// still writable by them; any other answer is one 404.
func (h *Hub) sharerShare(w http.ResponseWriter, r *http.Request, t Principal) (Share, bool) {
	sh, ok := h.store.shareByID(r.PathValue("id"))
	if !ok || sh.By != t.ID {
		fail(w, http.StatusNotFound, "not_found")
		return Share{}, false
	}
	p, ok := h.sharedPane(r.Context(), sh)
	if !ok {
		fail(w, http.StatusNotFound, "not_found")
		return Share{}, false
	}
	if !t.canWrite(sh.Host, p) || p.Mode != tmux.ModeWrite {
		fail(w, http.StatusForbidden, "read_only")
		return Share{}, false
	}
	return sh, true
}

// handleShowingPut takes what the sharer's page shows over the pane: a
// meta part, and the bytes when they changed.
func (h *Hub) handleShowingPut(w http.ResponseWriter, r *http.Request, t Principal) {
	sh, ok := h.sharerShare(w, r, t)
	if !ok {
		return
	}
	attrs := []any{"token", t.ID, "share", sh.Handle, "host", sh.Host, "pane", sh.PaneID}
	meta, typ, data, code := readShowing(w, r)
	if code != "" {
		h.log.Info("audit showing", append(attrs, "result", code)...)
		status := http.StatusBadRequest
		if code == "too_large" {
			status = http.StatusRequestEntityTooLarge
		}
		fail(w, status, code)
		return
	}
	h.shares.mu.Lock()
	l := h.shares.of(sh.ID)
	fileRev := l.rev + 1
	if data == nil && l.show != nil {
		typ, data, fileRev = l.show.Type, l.show.data, l.show.FileRev
	}
	if data == nil {
		h.shares.mu.Unlock()
		h.log.Info("audit showing", append(attrs, "result", "bad_input")...)
		fail(w, http.StatusBadRequest, "bad_input")
		return
	}
	l.rev++
	l.show = &showing{Kind: meta.Kind, Path: meta.Path, View: meta.View, Type: typ, Bytes: len(data), FileRev: fileRev, data: data, set: time.Now()}
	close(l.wake)
	l.wake = make(chan struct{})
	h.shares.mu.Unlock()
	h.log.Info("audit showing", append(attrs, "result", "ok", "kind", meta.Kind, "view", meta.View, "bytes", len(data), "path_len", len(meta.Path))...)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Hub) handleShowingDelete(w http.ResponseWriter, r *http.Request, t Principal) {
	sh, ok := h.sharerShare(w, r, t)
	if !ok {
		return
	}
	h.clearShowing(sh)
	h.log.Info("audit showing", "token", t.ID, "share", sh.Handle, "host", sh.Host, "pane", sh.PaneID, "result", "cleared")
	w.WriteHeader(http.StatusNoContent)
}

func (h *Hub) clearShowing(sh Share) {
	h.shares.mu.Lock()
	l := h.shares.of(sh.ID)
	if l.show != nil {
		l.show = nil
		l.rev++
		close(l.wake)
		l.wake = make(chan struct{})
	}
	h.shares.mu.Unlock()
}

// handleChangesPut takes the changes window the sharer's page has open:
// the listing as the host gave it, and whether the window is folded.
func (h *Hub) handleChangesPut(w http.ResponseWriter, r *http.Request, t Principal) {
	sh, ok := h.sharerShare(w, r, t)
	if !ok {
		return
	}
	attrs := []any{"token", t.ID, "share", sh.Handle, "host", sh.Host, "pane", sh.PaneID}
	var c shownChanges
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, changesMax))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&c); err != nil || !validChanges(c.Changes) {
		code := "bad_input"
		if err != nil {
			code = sizeOr(err, code)
		}
		h.log.Info("audit share changes", append(attrs, "result", code)...)
		status := http.StatusBadRequest
		if code == "too_large" {
			status = http.StatusRequestEntityTooLarge
		}
		fail(w, status, code)
		return
	}
	c.set = time.Now()
	h.shares.mu.Lock()
	l := h.shares.of(sh.ID)
	l.changes = &c
	l.rev++
	close(l.wake)
	l.wake = make(chan struct{})
	h.shares.mu.Unlock()
	h.log.Info("audit share changes", append(attrs, "result", "ok", "entries", len(c.Entries), "folded", c.Folded)...)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Hub) handleChangesDelete(w http.ResponseWriter, r *http.Request, t Principal) {
	sh, ok := h.sharerShare(w, r, t)
	if !ok {
		return
	}
	h.clearChanges(sh)
	h.log.Info("audit share changes", "token", t.ID, "share", sh.Handle, "host", sh.Host, "pane", sh.PaneID, "result", "cleared")
	w.WriteHeader(http.StatusNoContent)
}

func (h *Hub) clearChanges(sh Share) {
	h.shares.mu.Lock()
	l := h.shares.of(sh.ID)
	if l.changes != nil {
		l.changes = nil
		l.rev++
		close(l.wake)
		l.wake = make(chan struct{})
	}
	h.shares.mu.Unlock()
}

// validChanges takes a listing as an agent would give it: a root and a
// branch without control characters, each entry a path of a known kind.
// A file's name may hold a tab or a newline, as git allows: the page
// draws it as text.
func validChanges(c wire.Changes) bool {
	if c.Root == "" || !wire.ValidPath(c.Root) || !wire.ValidPath(c.Branch) {
		return false
	}
	if c.Ahead < 0 || c.Behind < 0 || len(c.Entries) > wire.MaxChanges {
		return false
	}
	for _, e := range c.Entries {
		if !validChangePath(e.Path) || (e.From != "" && !validChangePath(e.From)) || !among(e.Kind, changeKinds) {
			return false
		}
	}
	return true
}

func validChangePath(p string) bool {
	if p == "" || len(p) > wire.MaxPathBytes || !utf8.ValidString(p) {
		return false
	}
	return !strings.ContainsFunc(p, func(r rune) bool {
		return (r < 0x20 && r != '\t' && r != '\n') || r == 0x7f
	})
}

type showingMeta struct {
	Kind string `json:"kind"`
	Path string `json:"path"`
	View string `json:"view"`
}

// readShowing parses the multipart body: a meta part, then an optional
// file part of a type a window shows.
func readShowing(w http.ResponseWriter, r *http.Request) (showingMeta, string, []byte, string) {
	var meta showingMeta
	mt, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mt != "multipart/form-data" || params["boundary"] == "" {
		return meta, "", nil, "bad_input"
	}
	mr := multipart.NewReader(http.MaxBytesReader(w, r.Body, wire.MaxFile+64<<10), params["boundary"])
	part, err := mr.NextPart()
	if err != nil || part.FormName() != "meta" {
		return meta, "", nil, sizeOr(err, "bad_input")
	}
	raw, err := io.ReadAll(io.LimitReader(part, 4096))
	if err != nil {
		return meta, "", nil, sizeOr(err, "bad_input")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&meta); err != nil {
		return meta, "", nil, "bad_input"
	}
	if !among(meta.Kind, showingKinds) || !among(meta.View, showingViews) || !wire.ValidPath(meta.Path) {
		return meta, "", nil, "bad_input"
	}
	part, err = mr.NextPart()
	if err == io.EOF {
		return meta, "", nil, ""
	}
	if err != nil || part.FormName() != "file" {
		return meta, "", nil, sizeOr(err, "bad_input")
	}
	typ, _, err := mime.ParseMediaType(part.Header.Get("Content-Type"))
	if err != nil {
		return meta, "", nil, "bad_input"
	}
	data, err := io.ReadAll(io.LimitReader(part, wire.MaxFile+1))
	if err != nil {
		return meta, "", nil, sizeOr(err, "bad_input")
	}
	if len(data) > wire.MaxFile {
		return meta, "", nil, "too_large"
	}
	if _, err := mr.NextPart(); err != io.EOF {
		return meta, "", nil, sizeOr(err, "bad_input")
	}
	if !validShowingFile(typ, data) {
		return meta, "", nil, "bad_input"
	}
	return meta, typ, data, ""
}

func among(s, list string) bool {
	for _, v := range strings.Fields(list) {
		if s == v {
			return true
		}
	}
	return false
}

// validShowingFile takes what a file window shows: text, an image, a
// PDF, or the octet stream a download-only file is served as.
func validShowingFile(typ string, data []byte) bool {
	if len(data) == 0 {
		return false
	}
	switch typ {
	case "text/plain":
		return utf8.Valid(data) && !bytes.ContainsFunc(data, func(r rune) bool {
			return (r < 0x20 && r != '\t' && r != '\n' && r != '\r') || r == 0x7f
		})
	case "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "application/pdf":
		return http.DetectContentType(data) == typ
	case "image/avif", "image/x-icon", "image/vnd.microsoft.icon", "application/octet-stream":
		return true
	}
	return false
}

// --- the observer's side ---------------------------------------------------

// liveShare answers a share that is live for an observer: not expired,
// its sharer still here.
func (h *Hub) liveShare(id string) (Share, bool) {
	sh, ok := h.store.shareByID(id)
	if !ok || !h.sharerAlive(sh) {
		return Share{}, false
	}
	return sh, true
}

func (h *Hub) handleShareProbe(w http.ResponseWriter, r *http.Request) {
	if !h.limits.allowNamed("share-probe:"+h.clientAddr(r), probeRate, probeBurst) {
		fail(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	sh, ok := h.liveShare(r.PathValue("id"))
	if !ok {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	reply(w, map[string]any{"share": map[string]any{"expires": sh.Expires.Unix()}})
}

// handleShareOpen checks the password and sets the share cookie. A wrong
// one counts toward the address lockout and toward the share's own ten.
func (h *Hub) handleShareOpen(w http.ResponseWriter, r *http.Request) {
	addr := h.clientAddr(r)
	if h.limits.isLocked(addr) {
		fail(w, http.StatusTooManyRequests, "locked_out")
		return
	}
	if !h.limits.allowNamed("share-open:"+addr, openRate, openBurst) {
		fail(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	var in struct {
		Password string `json:"password"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		fail(w, http.StatusBadRequest, "bad_json")
		return
	}
	if _, err := dec.Token(); err != io.EOF {
		fail(w, http.StatusBadRequest, "bad_json")
		return
	}
	sh, ok := h.liveShare(r.PathValue("id"))
	if !ok {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	if !sh.passwordIs(in.Password) {
		h.limits.fail(addr)
		h.shares.mu.Lock()
		l := h.shares.of(sh.ID)
		l.fails++
		fails := l.fails
		h.shares.mu.Unlock()
		h.log.Warn("share refused", "share", sh.Handle, "addr", addr, "fails", fails)
		if fails >= shareFails {
			h.endShare(sh, "burned", "addr", addr)
		}
		fail(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	now := time.Now()
	o := &observer{id: secure.Random(32), share: sh.ID, addr: addr, created: now, expires: sh.Expires, seen: now}
	if hubEnd := now.Add(h.cfg.SessionTTL); hubEnd.Before(o.expires) {
		o.expires = hubEnd
	}
	h.shares.mu.Lock()
	h.shares.observers[o.id] = o
	h.shares.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: shareCookie, Value: o.id, Path: "/v1/share/" + sh.ID, Expires: o.expires,
		HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode})
	h.log.Info("share opened", "share", sh.Handle, "addr", addr)
	w.WriteHeader(http.StatusNoContent)
}

type observerHandler func(w http.ResponseWriter, r *http.Request, sh Share, o *observer)

// withObserver authenticates an observer: the share cookie with the
// client header, for a share that is still live.
func (h *Hub) withObserver(next observerHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		addr := h.clientAddr(r)
		if h.limits.isLocked(addr) {
			fail(w, http.StatusTooManyRequests, "locked_out")
			return
		}
		c, err := r.Cookie(shareCookie)
		if err != nil || r.Header.Get(clientHeader) == "" {
			fail(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		id := r.PathValue("id")
		h.shares.mu.Lock()
		o, ok := h.shares.observers[c.Value]
		if ok && (o.share != id || time.Now().After(o.expires)) {
			ok = false
		}
		if ok {
			o.seen, o.addr = time.Now(), addr
		}
		h.shares.mu.Unlock()
		if !ok {
			fail(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		sh, live := h.liveShare(id)
		if !live {
			fail(w, http.StatusNotFound, "not_found")
			return
		}
		if !h.limits.allow("share-session:" + o.id) {
			fail(w, http.StatusTooManyRequests, "rate_limited")
			return
		}
		next(w, r, sh, o)
	}
}

// handleSharePane reads the shared pane for an observer: the screen and
// the pane as a reader sees it, with nothing of the sharer's own.
func (h *Hub) handleSharePane(w http.ResponseWriter, r *http.Request, sh Share, o *observer) {
	lines, ok := intParam(r, "lines", 100, 1, wire.MaxLines)
	if !ok {
		fail(w, http.StatusBadRequest, "bad_parameter")
		return
	}
	a := h.await(r.Context(), sh.Host)
	if a == nil {
		fail(w, http.StatusServiceUnavailable, "host_offline")
		return
	}
	p, ok := h.sharedPane(r.Context(), sh)
	if !ok {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	resp, err := a.read(r.Context(), wire.Request{Op: wire.OpRead, Actor: sh.Name + " share:" + sh.Handle, Pane: p.PaneID,
		Lines: lines, ANSI: r.URL.Query().Get("ansi") == "1", Wrapped: true})
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "host_offline")
		return
	}
	if resp.Error != "" {
		a.forget()
		status, code := statusFor(resp.Error)
		fail(w, status, code)
		return
	}
	v := view(sh.Host, Principal{}, p)
	v.Mail = nil
	v.Cwd = ""
	if v.Attention != nil {
		att := *v.Attention
		att.Choices = nil
		v.Attention = &att
	}
	body, _ := json.Marshal(map[string]any{"pane": v, "content": resp.Content, "trimmed": resp.Trimmed, "expires": sh.Expires.Unix()})
	sum := sha256.Sum256(body)
	etag := `"` + hex.EncodeToString(sum[:8]) + `"`
	w.Header().Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(body)
}

// handleShowingGet long-polls the sharer's showing, like events.
func (h *Hub) handleShowingGet(w http.ResponseWriter, r *http.Request, sh Share, o *observer) {
	wait, ok1 := intParam(r, "wait", 0, 0, int(maxWait/time.Second))
	after, ok2 := uint64(0), true
	if s := r.URL.Query().Get("after"); s != "" {
		after, ok2 = parseCursor(s)
	}
	if !ok1 || !ok2 {
		fail(w, http.StatusBadRequest, "bad_parameter")
		return
	}
	deadline := time.Now().Add(time.Duration(wait) * time.Second)
	for {
		h.shares.mu.Lock()
		l := h.shares.of(sh.ID)
		rev, show, changes, ch := l.rev, l.show, l.changes, l.wake
		h.shares.mu.Unlock()
		if rev != after || !time.Now().Before(deadline) || r.Context().Err() != nil {
			out := map[string]any{"rev": rev, "showing": nil, "changes": nil}
			if show != nil {
				out["showing"] = show
			}
			if changes != nil {
				out["changes"] = changes
			}
			reply(w, out)
			return
		}
		ctx, cancel := context.WithDeadline(r.Context(), deadline)
		select {
		case <-ch:
		case <-ctx.Done():
		}
		cancel()
	}
}

func (h *Hub) handleShowingFile(w http.ResponseWriter, r *http.Request, sh Share, o *observer) {
	h.shares.mu.Lock()
	l := h.shares.of(sh.ID)
	show, rev := l.show, l.rev
	h.shares.mu.Unlock()
	if show == nil {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	etag := `"` + hex.EncodeToString([]byte{byte(rev >> 24), byte(rev >> 16), byte(rev >> 8), byte(rev)}) + `"`
	w.Header().Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	serveBytes(w, show.Type, show.data)
}

func (h *Hub) handleShareClose(w http.ResponseWriter, r *http.Request, sh Share, o *observer) {
	h.shares.mu.Lock()
	delete(h.shares.observers, o.id)
	h.shares.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: shareCookie, Value: "", Path: "/v1/share/" + sh.ID, MaxAge: -1,
		HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode})
	w.WriteHeader(http.StatusNoContent)
}

// --- the sweeps ------------------------------------------------------------

// sweepShares ends shares whose time is up, whose sharer went, or whose
// pane has been gone from its host for a minute, and drops stale showings.
func (h *Hub) sweepShares(ctx context.Context) {
	t := time.NewTicker(15 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		for _, sh := range h.store.dropExpiredShares() {
			watching := h.shares.forget(sh.ID)
			h.log.Info("share expired", "share", sh.Handle, "host", sh.Host, "pane", sh.PaneID, "watching", watching)
		}
		now := time.Now()
		for _, sh := range h.store.shares() {
			if !h.sharerAlive(sh) {
				h.endShare(sh, "ended with its sharer")
				continue
			}
			a := h.agent(sh.Host)
			if a == nil {
				continue
			}
			_, found := h.sharedPane(ctx, sh)
			h.shares.mu.Lock()
			l := h.shares.of(sh.ID)
			switch {
			case found:
				l.missing = time.Time{}
			case l.missing.IsZero():
				l.missing = now
			}
			gone := !found && now.Sub(l.missing) >= paneGoneAfter
			stale := l.show != nil && now.Sub(l.show.set) > showingTTL
			staleChanges := l.changes != nil && now.Sub(l.changes.set) > showingTTL
			h.shares.mu.Unlock()
			if gone {
				h.endShare(sh, "ended, pane gone")
				continue
			}
			if stale {
				h.clearShowing(sh)
				h.log.Info("share showing dropped", "share", sh.Handle)
			}
			if staleChanges {
				h.clearChanges(sh)
				h.log.Info("share changes dropped", "share", sh.Handle)
			}
		}
		h.shares.mu.Lock()
		for id, o := range h.shares.observers {
			if now.After(o.expires) {
				delete(h.shares.observers, id)
			}
		}
		h.shares.mu.Unlock()
	}
}
