package hub

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/notmarkopadjen/muxway/internal/secure"
	"github.com/notmarkopadjen/muxway/internal/text"
	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

const maxBody = 16 << 10

func (h *Hub) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/pair", h.handlePair)
	mux.HandleFunc("GET /v1/agent", h.handleAgent)
	mux.HandleFunc("GET /v1/auth", h.handleAuthMethods)
	mux.HandleFunc("POST /v1/auth/token", h.handleAuthToken)
	mux.HandleFunc("POST /v1/auth/logout", h.handleLogout)
	mux.HandleFunc("GET /v1/me", h.withPrincipal(h.handleMe))
	for _, prov := range h.cfg.Providers {
		mux.HandleFunc("GET /v1/auth/"+prov.Name()+"/start", h.handleSignInStart(prov))
		mux.HandleFunc("GET /v1/auth/"+prov.Name()+"/callback", h.handleSignInFinish(prov))
	}
	mux.HandleFunc("GET /v1/hosts", h.withPrincipal(h.handleHosts))
	mux.HandleFunc("GET /v1/hosts/{host}/tree", h.withPrincipal(h.handleTree))
	mux.HandleFunc("GET /v1/panes", h.withPrincipal(h.handlePanes))
	mux.HandleFunc("GET /v1/events", h.withPrincipal(h.handleEvents))
	mux.HandleFunc("GET /v1/transcribe", h.withPrincipal(h.handleTranscribeProbe))
	mux.HandleFunc("POST /v1/transcribe", h.withPrincipal(h.handleTranscribe))
	mux.HandleFunc("GET /v1/panes/{host}/{path...}", h.withPrincipal(h.handleRead))
	mux.HandleFunc("POST /v1/panes/{host}/{path...}", h.withPrincipal(h.handlePost))
	mux.HandleFunc("GET /v1/windows/{host}/{session}/{window}", h.withPrincipal(h.handleWindow))
	mux.HandleFunc("POST /v1/windows/{host}/{session}/{window}/panes", h.withPrincipal(h.handleSplit))
	mux.HandleFunc("POST /v1/hosts/{host}/sessions", h.withPrincipal(h.handleNewSession))
	if h.cfg.NoWeb {
		mux.HandleFunc("/", h.handleRoot)
	} else {
		mux.Handle("/", h.webHandler())
	}
	h.adminRoutes(mux)
	return securityHeaders(h.gate(cors(mux)))
}

// handleRoot stands in for the web client on a hub that does not serve
// it: with a sign-in provider configured, a browser is sent to sign in, and
// a signed-in one is told so. The cookie alone suffices here because the page only names
// the principal and a cross-site navigation does not carry it anyway.
func (h *Hub) handleRoot(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" || r.Method != http.MethodGet || len(h.cfg.Providers) == 0 {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	if c, err := r.Cookie(sessionCookie); err == nil {
		if p, ok := h.sessionPrincipal(c.Value); ok {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.Header().Set("Content-Security-Policy", "default-src 'none'")
			fmt.Fprintf(w, "muxway: signed in as %s (%s, %s). The web client is on its way.\n", p.Name, p.ID, p.Method)
			return
		}
	}
	http.Redirect(w, r, "/v1/auth/"+h.cfg.Providers[0].Name()+"/start", http.StatusFound)
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

func fail(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	fmt.Fprintf(w, "{\"error\":%q}\n", code)
}

func reply(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func created(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(v)
}

func wantsText(r *http.Request) bool {
	accept := r.Header.Get("Accept")
	return strings.Contains(accept, "text/plain") && !strings.Contains(accept, "application/json")
}

// clientAddr is the peer address, or with TrustProxy the last address a
// loopback proxy appended to X-Forwarded-For.
func (h *Hub) clientAddr(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if h.cfg.TrustProxy {
		if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
			if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
				parts := strings.Split(xff, ",")
				if last := strings.TrimSpace(parts[len(parts)-1]); net.ParseIP(last) != nil {
					return last
				}
			}
		}
	}
	return host
}

type principalHandler func(w http.ResponseWriter, r *http.Request, t Principal)

// presentedToken reads the token from Authorization: Bearer, or from
// X-Muxway-Token for clients whose stack rewrites Authorization (WAP 1.x
// gateways turn it into Basic). Both present and different is refused.
func presentedToken(r *http.Request) (string, bool) {
	bearer, hasBearer := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	alt := r.Header.Get("X-Muxway-Token")
	switch {
	case hasBearer && alt != "":
		return bearer, bearer != "" && bearer == alt
	case hasBearer:
		return bearer, bearer != ""
	case alt != "":
		return alt, true
	}
	return "", false
}

// withPrincipal authenticates the request: a bearer token, or a session
// cookie together with the client header. Failures count toward the
// address's lockout; the answer never says why.
func (h *Hub) withPrincipal(next principalHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		addr := h.clientAddr(r)
		if h.limits.isLocked(addr) {
			fail(w, http.StatusTooManyRequests, "locked_out")
			return
		}
		var p Principal
		ok, tried := false, false
		if secret, has := presentedToken(r); has {
			tried = true
			if t, found := h.store.lookupToken(secret); found {
				p, ok = t.principal(), true
				h.bearers.touch(t.ID, clientType(r), addr)
			}
		} else if c, err := r.Cookie(sessionCookie); err == nil && r.Header.Get(clientHeader) != "" {
			p, ok = h.sessionPrincipal(c.Value)
			if ok {
				h.sessions.touch(c.Value, addr)
			} else {
				// A session the hub does not know is one it ended, or one from
				// before a restart: 256 random bits are not guessed, so it does
				// not count, and the cookie is cleared so the browser stops.
				clearSessionCookie(w)
				h.log.Info("stale session", "addr", addr, "path", r.URL.Path)
			}
		}
		if !ok {
			// Only a presented credential counts toward the lockout: a browser
			// asking who it is before signing in, or holding a cookie the hub
			// has forgotten, is not an attack.
			if tried {
				h.limits.fail(addr)
				h.log.Warn("authentication failed", "addr", addr, "path", r.URL.Path)
			}
			fail(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if !h.limits.allow(p.ID) {
			fail(w, http.StatusTooManyRequests, "rate_limited")
			return
		}
		next(w, r, p)
	}
}

// --- client API -------------------------------------------------------------

// PaneView is a pane as a client sees it.
type PaneView struct {
	Host    string `json:"host"`
	Address string `json:"address"`
	tmux.Pane
}

func view(host string, t Principal, p tmux.Pane) PaneView {
	if p.Mode == tmux.ModeWrite && !t.canWrite(host, p) {
		p.Mode = tmux.ModeRead
	}
	return PaneView{Host: host, Address: host + "/" + p.Address(), Pane: p}
}

func (h *Hub) visibleHosts(t Principal) []string {
	var out []string
	for _, host := range h.store.agents() {
		if t.canSeeHost(host) {
			out = append(out, host)
		}
	}
	return out
}

func (h *Hub) handleHosts(w http.ResponseWriter, r *http.Request, t Principal) {
	type hostView struct {
		Name     string `json:"name"`
		Online   bool   `json:"online"`
		Sessions bool   `json:"sessions,omitempty"`
		Close    bool   `json:"close,omitempty"`
	}
	var out []hostView
	for _, host := range h.visibleHosts(t) {
		a := h.agent(host)
		out = append(out, hostView{host, a != nil, a != nil && a.startsSessions(r.Context()), a != nil && a.closesPanes(r.Context())})
	}
	if wantsText(r) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		for _, v := range out {
			state := "offline"
			if v.Online {
				state = "online"
			}
			fmt.Fprintf(w, "%s\t%s\n", v.Name, state)
		}
		return
	}
	reply(w, map[string]any{"hosts": out})
}

// readable lists the panes of one host that the token may read.
func (h *Hub) readable(ctx context.Context, t Principal, host string) ([]tmux.Pane, *agentConn, error) {
	a := h.agent(host)
	if a == nil {
		return nil, nil, errOffline
	}
	panes, err := a.panes(ctx)
	if err != nil {
		return nil, a, err
	}
	var out []tmux.Pane
	for _, p := range panes {
		if t.canRead(host, p) {
			out = append(out, p)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.SessionName != b.SessionName {
			return a.SessionName < b.SessionName
		}
		if a.WindowIndex != b.WindowIndex {
			return a.WindowIndex < b.WindowIndex
		}
		return a.PaneIndex < b.PaneIndex
	})
	return out, a, nil
}

func (h *Hub) handlePanes(w http.ResponseWriter, r *http.Request, t Principal) {
	charset, ok := charsetParam(r)
	if !ok {
		fail(w, http.StatusBadRequest, "bad_parameter")
		return
	}
	var out []PaneView
	for _, host := range h.visibleHosts(t) {
		panes, _, err := h.readable(r.Context(), t, host)
		if err != nil {
			continue
		}
		for _, p := range panes {
			out = append(out, view(host, t, p))
		}
	}
	if wantsText(r) {
		// Command and title are what a program in the pane chose; the rest is ASCII already.
		w.Header().Set("Content-Type", text.ContentType(charset))
		var b strings.Builder
		for _, v := range out {
			kind := ""
			if v.Attention != nil {
				kind = v.Attention.Kind
			}
			fmt.Fprintf(&b, "%s\t%s\t%s\t%s\t%s\n", v.Address, v.Mode, text.Fold(v.Command, charset), text.Fold(v.Title, charset), kind)
		}
		w.Write(text.Encode(b.String(), charset))
		return
	}
	reply(w, map[string]any{"panes": out})
}

// EventView is an event as a client sees it.
type EventView struct {
	Seq     uint64 `json:"seq"`
	At      int64  `json:"at"`
	Host    string `json:"host"`
	Address string `json:"address"`
	PaneID  string `json:"pane_id"`
	Alias   string `json:"alias,omitempty"`
	Kind    string `json:"kind"`
	Text    string `json:"text,omitempty"`
}

// handleEvents returns the events after the client's cursor for panes the
// token may read, waiting up to `wait` seconds for one to arrive.
func (h *Hub) handleEvents(w http.ResponseWriter, r *http.Request, t Principal) {
	limit, ok1 := intParam(r, "limit", 50, 1, 100)
	wait, ok2 := intParam(r, "wait", 0, 0, int(maxWait/time.Second))
	cursor, ok3 := uint64(0), true
	if s := r.URL.Query().Get("after"); s != "" {
		cursor, ok3 = parseCursor(s)
	} else {
		cursor = ^uint64(0)
	}
	if !ok1 || !ok2 || !ok3 {
		fail(w, http.StatusBadRequest, "bad_parameter")
		return
	}
	visible := func(e event) bool { return t.canSeeHost(e.Host) && t.canRead(e.Host, e.Pane) }
	deadline := time.Now().Add(time.Duration(wait) * time.Second)
	events, next := h.events.after(cursor, limit, visible)
	for len(events) == 0 && time.Now().Before(deadline) && r.Context().Err() == nil {
		ctx, cancel := context.WithDeadline(r.Context(), deadline)
		h.events.wait(ctx, next)
		cancel()
		events, next = h.events.after(next, limit, visible)
	}
	var out []EventView
	for _, e := range events {
		out = append(out, EventView{Seq: e.Seq, At: e.At, Host: e.Host, Address: e.Host + "/" + e.Pane.Address(),
			PaneID: e.Pane.PaneID, Alias: e.Pane.Alias, Kind: e.Kind, Text: e.Text})
	}
	if wantsText(r) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		for _, v := range out {
			fmt.Fprintf(w, "%d\t%d\t%s\t%s\t%s\n", v.Seq, v.At, v.Address, v.Kind, v.Text)
		}
		fmt.Fprintf(w, "next\t%d\n", next)
		return
	}
	if out == nil {
		out = []EventView{}
	}
	reply(w, map[string]any{"events": out, "next": next})
}

func parseCursor(s string) (uint64, bool) {
	if len(s) > 20 {
		return 0, false
	}
	n, err := strconv.ParseUint(s, 10, 64)
	return n, err == nil
}

func (h *Hub) handleTree(w http.ResponseWriter, r *http.Request, t Principal) {
	host := r.PathValue("host")
	if !hostName.MatchString(host) || !t.canSeeHost(host) {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	panes, _, err := h.readable(r.Context(), t, host)
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "host_offline")
		return
	}
	type windowView struct {
		Index  int        `json:"index"`
		Name   string     `json:"name"`
		Layout string     `json:"layout"`
		Active bool       `json:"active"`
		Panes  []PaneView `json:"panes"`
	}
	type sessionView struct {
		Name    string        `json:"name"`
		Windows []*windowView `json:"windows"`
	}
	var sessions []*sessionView
	for _, p := range panes {
		if len(sessions) == 0 || sessions[len(sessions)-1].Name != p.SessionName {
			sessions = append(sessions, &sessionView{Name: p.SessionName})
		}
		s := sessions[len(sessions)-1]
		if len(s.Windows) == 0 || s.Windows[len(s.Windows)-1].Index != p.WindowIndex {
			s.Windows = append(s.Windows, &windowView{Index: p.WindowIndex, Name: p.WindowName,
				Layout: p.WindowLayout, Active: p.WindowActive})
		}
		win := s.Windows[len(s.Windows)-1]
		win.Panes = append(win.Panes, view(host, t, p))
	}
	reply(w, map[string]any{"host": host, "sessions": sessions})
}

var (
	paneID   = regexp.MustCompile(`^%[0-9]{1,9}$`)
	nameSeg  = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)
	indexSeg = regexp.MustCompile(`^[0-9]{1,4}$`)
	aliasSeg = regexp.MustCompile(`^@[a-z0-9-]{1,32}$`)
)

// locate resolves a client's address to one of the token's readable panes.
// Anything the token may not see is reported exactly like a missing pane.
func (h *Hub) locate(ctx context.Context, t Principal, host, path string) (*agentConn, tmux.Pane, int) {
	if !hostName.MatchString(host) || !t.canSeeHost(host) {
		return nil, tmux.Pane{}, http.StatusNotFound
	}
	var match func(tmux.Pane) bool
	switch {
	case aliasSeg.MatchString(path):
		alias := path[1:]
		match = func(p tmux.Pane) bool { return p.Alias == alias }
	default:
		session, wp, ok := strings.Cut(path, "/")
		i := strings.LastIndex(wp, ".")
		if !ok || i < 0 {
			return nil, tmux.Pane{}, http.StatusNotFound
		}
		window, pane := wp[:i], wp[i+1:]
		if !nameSeg.MatchString(session) || !nameSeg.MatchString(window) || !indexSeg.MatchString(pane) {
			return nil, tmux.Pane{}, http.StatusNotFound
		}
		paneIdx, _ := strconv.Atoi(pane)
		match = func(p tmux.Pane) bool {
			if p.SessionName != session || p.PaneIndex != paneIdx {
				return false
			}
			if indexSeg.MatchString(window) {
				n, _ := strconv.Atoi(window)
				return p.WindowIndex == n
			}
			return p.WindowName == window
		}
	}
	panes, a, err := h.readable(ctx, t, host)
	if err != nil {
		return nil, tmux.Pane{}, http.StatusServiceUnavailable
	}
	for _, p := range panes {
		if match(p) {
			return a, p, 0
		}
	}
	return nil, tmux.Pane{}, http.StatusNotFound
}

func statusFor(code string) (int, string) {
	switch code {
	case wire.ErrNotExposed:
		return http.StatusNotFound, "not_found"
	case wire.ErrReadOnly:
		return http.StatusForbidden, "read_only"
	case wire.ErrBadInput:
		return http.StatusBadRequest, "bad_input"
	case wire.ErrRateLimit:
		return http.StatusTooManyRequests, "rate_limited"
	case wire.ErrNotAllowed:
		return http.StatusNotFound, "not_found"
	case wire.ErrExists:
		return http.StatusConflict, "exists"
	case wire.ErrTooMany:
		return http.StatusConflict, "too_many"
	}
	return http.StatusBadGateway, "host_error"
}

// handlePost routes the actions on a pane: /input, /resize and /close.
func (h *Hub) handlePost(w http.ResponseWriter, r *http.Request, t Principal) {
	if strings.HasSuffix(r.PathValue("path"), "/resize") {
		h.handleResize(w, r, t)
		return
	}
	if strings.HasSuffix(r.PathValue("path"), "/close") {
		h.handleClose(w, r, t)
		return
	}
	h.handleInput(w, r, t)
}

func intParam(r *http.Request, name string, def, lo, hi int) (int, bool) {
	v := r.URL.Query()[name]
	if len(v) == 0 {
		return def, true
	}
	// A parameter given twice is a mistake or a trick; neither gets a guess.
	if len(v) > 1 {
		return 0, false
	}
	n, err := strconv.Atoi(v[0])
	return n, err == nil && n >= lo && n <= hi
}

// charsetParam reads the text-mode charset, UTF-8 when absent; a repeated
// or unknown value is refused.
func charsetParam(r *http.Request) (string, bool) {
	v := r.URL.Query()["charset"]
	if len(v) == 0 {
		return text.UTF8, true
	}
	if len(v) > 1 || !text.Charset(v[0]) {
		return "", false
	}
	return v[0], true
}

func (h *Hub) handleRead(w http.ResponseWriter, r *http.Request, t Principal) {
	lines, ok1 := intParam(r, "lines", 100, 1, wire.MaxLines)
	width, ok2 := intParam(r, "width", 80, 8, 400)
	ansi := r.URL.Query().Get("ansi") == "1"
	charset, ok3 := charsetParam(r)
	if !ok1 || !ok2 || !ok3 {
		fail(w, http.StatusBadRequest, "bad_parameter")
		return
	}
	a, p, status := h.locate(r.Context(), t, r.PathValue("host"), r.PathValue("path"))
	if status == http.StatusServiceUnavailable {
		fail(w, status, "host_offline")
		return
	}
	if status != 0 {
		fail(w, status, "not_found")
		return
	}
	resp, err := a.request(r.Context(), wire.Request{Op: wire.OpRead, Actor: t.ID, Pane: p.PaneID, Lines: lines, ANSI: ansi && !wantsText(r)})
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
	var body []byte
	contentType := "application/json"
	if wantsText(r) {
		contentType = text.ContentType(charset)
		rows := text.Wrap(text.Fold(resp.Content, charset), width, lines)
		body = text.Encode(strings.Join(rows, "\n")+"\n", charset)
	} else {
		v := view(r.PathValue("host"), t, p)
		body, _ = json.Marshal(map[string]any{"pane": v, "content": resp.Content})
	}
	sum := sha256.Sum256(body)
	etag := `"` + hex.EncodeToString(sum[:8]) + `"`
	w.Header().Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Write(body)
}

func (h *Hub) handleInput(w http.ResponseWriter, r *http.Request, t Principal) {
	path, ok := strings.CutSuffix(r.PathValue("path"), "/input")
	if !ok {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	var in struct {
		Text  *string     `json:"text"`
		Key   string      `json:"key"`
		Mouse *wire.Mouse `json:"mouse"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			fail(w, http.StatusRequestEntityTooLarge, "too_large")
			return
		}
		fail(w, http.StatusBadRequest, "bad_json")
		return
	}
	if _, err := dec.Token(); err != io.EOF {
		fail(w, http.StatusBadRequest, "bad_json")
		return
	}
	switch {
	case in.Text != nil && in.Key == "" && in.Mouse == nil:
		if !wire.ValidText(*in.Text) {
			fail(w, http.StatusBadRequest, "bad_input")
			return
		}
	case in.Text == nil && in.Key != "" && in.Mouse == nil:
		if _, known := tmux.Keys[in.Key]; !known {
			fail(w, http.StatusBadRequest, "bad_input")
			return
		}
	case in.Text == nil && in.Key == "" && in.Mouse != nil:
		if _, known := wire.Buttons[in.Mouse.Button]; !known || in.Mouse.X < 1 || in.Mouse.Y < 1 {
			fail(w, http.StatusBadRequest, "bad_input")
			return
		}
	default:
		fail(w, http.StatusBadRequest, "bad_input")
		return
	}
	host := r.PathValue("host")
	a, p, status := h.locate(r.Context(), t, host, path)
	if status == http.StatusServiceUnavailable {
		fail(w, status, "host_offline")
		return
	}
	if status != 0 {
		fail(w, status, "not_found")
		return
	}
	if !t.canWrite(host, p) || p.Mode != tmux.ModeWrite {
		fail(w, http.StatusForbidden, "read_only")
		return
	}
	if in.Mouse != nil && !wire.ValidMouse(in.Mouse, p.Width, p.Height) {
		fail(w, http.StatusBadRequest, "bad_input")
		return
	}
	resp, err := a.request(r.Context(), wire.Request{Op: wire.OpInput, Actor: t.ID, Pane: p.PaneID, Text: in.Text, Key: in.Key, Mouse: in.Mouse})
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "host_offline")
		return
	}
	attrs := []any{"token", t.ID, "method", t.Method, "host", host, "pane", p.PaneID}
	switch {
	case in.Text != nil:
		attrs = append(attrs, "text_bytes", len(*in.Text))
	case in.Mouse != nil:
		attrs = append(attrs, "mouse", in.Mouse.Button)
	default:
		attrs = append(attrs, "key", in.Key)
	}
	if resp.Error != "" {
		a.forget()
		h.log.Info("audit input", append(attrs, "result", resp.Error)...)
		status, code := statusFor(resp.Error)
		fail(w, status, code)
		return
	}
	h.log.Info("audit input", append(attrs, "result", "ok")...)
	a.forget()
	w.WriteHeader(http.StatusNoContent)
}

// --- agents and pairing -------------------------------------------------------

func (h *Hub) handleAgent(w http.ResponseWriter, r *http.Request) {
	addr := h.clientAddr(r)
	if h.limits.isLocked(addr) {
		fail(w, http.StatusTooManyRequests, "locked_out")
		return
	}
	c, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer c.CloseNow()
	c.SetReadLimit(4 << 20)
	hctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	host, sess, err := secure.HubHandshake(hctx, wire.WS{C: c}, h.key, h.store.agentKey)
	cancel()
	if err != nil {
		h.limits.fail(addr)
		h.log.Warn("agent handshake failed", "addr", addr)
		c.Close(websocket.StatusPolicyViolation, "")
		return
	}
	ctx, stop := context.WithCancel(r.Context())
	defer stop()
	a := &agentConn{host: host, addr: addr, since: time.Now(), sess: sess, cancel: stop, pending: map[uint64]chan wire.Response{}}
	h.attach(a)
	h.log.Info("agent connected", "host", host, "addr", addr)
	err = h.readLoop(ctx, a)
	h.detach(a)
	h.log.Info("agent disconnected", "host", host, "err", err)
}

func (h *Hub) handlePair(w http.ResponseWriter, r *http.Request) {
	addr := h.clientAddr(r)
	if h.limits.isLocked(addr) {
		fail(w, http.StatusTooManyRequests, "locked_out")
		return
	}
	var in struct {
		CodeID   string `json:"code_id"`
		Host     string `json:"host"`
		AgentKey string `json:"agent_key"`
		Proof    string `json:"proof"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&in); err != nil {
		fail(w, http.StatusBadRequest, "bad_json")
		return
	}
	pub, err := secure.DecodePublic(in.AgentKey)
	h.mu.Lock()
	code := h.codes[in.CodeID]
	valid := code != nil && time.Now().Before(code.expires) && err == nil && code.host == in.Host &&
		secure.CheckPairProof(code.secret, in.Host, pub, in.Proof)
	if code != nil && !valid {
		code.attempts++
		if code.attempts >= pairAttempts || time.Now().After(code.expires) {
			delete(h.codes, in.CodeID)
		}
	}
	if valid {
		delete(h.codes, in.CodeID)
	}
	h.mu.Unlock()
	if !valid {
		h.limits.fail(addr)
		h.log.Warn("pairing refused", "addr", addr)
		fail(w, http.StatusUnauthorized, "invalid_code")
		return
	}
	if err := h.store.addAgent(in.Host, pub); err != nil {
		fail(w, http.StatusInternalServerError, "store_failed")
		return
	}
	h.log.Info("agent paired", "host", in.Host, "addr", addr)
	reply(w, map[string]string{"sig": secure.SignPaired(h.key, in.Host, pub)})
}
