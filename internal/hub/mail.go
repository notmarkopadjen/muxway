package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

// Mail: a message left for a pane's process, held by its host's agent,
// never typed. The hub takes it under the write grant like an answer,
// forwards it, keeps a feed entry, and remembers the id it issued for a
// day so the pane may reply to the sender's pane and to nothing else.
const mailMemory = 24 * time.Hour

type mailRecord struct {
	ToHost, ToPane     string
	FromHost, FromPane string
	At                 time.Time
	Replied            bool
}

type mailIDs struct {
	mu   sync.Mutex
	next uint64
	m    map[uint64]*mailRecord
}

// newMailIDs starts the ids where a hub restarted cannot reissue what an
// agent still holds from before.
func newMailIDs() *mailIDs {
	return &mailIDs{next: uint64(time.Now().Unix()) * 1000, m: map[uint64]*mailRecord{}}
}

func (l *mailIDs) issue(rec mailRecord) uint64 {
	l.mu.Lock()
	defer l.mu.Unlock()
	for id, r := range l.m {
		if time.Since(r.At) > mailMemory {
			delete(l.m, id)
		}
	}
	l.next++
	rec.At = time.Now()
	l.m[l.next] = &rec
	return l.next
}

func (l *mailIDs) drop(id uint64) {
	l.mu.Lock()
	delete(l.m, id)
	l.mu.Unlock()
}

// get is the record of an id the hub issued within the day.
func (l *mailIDs) get(id uint64) (mailRecord, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	r, ok := l.m[id]
	if !ok || time.Since(r.At) > mailMemory {
		return mailRecord{}, false
	}
	return *r, true
}

func (l *mailIDs) replied(id uint64) {
	l.mu.Lock()
	if r := l.m[id]; r != nil {
		r.Replied = true
	}
	l.mu.Unlock()
}

// handleMail leaves a mail for a pane: POST /v1/panes/{address}/mail.
func (h *Hub) handleMail(w http.ResponseWriter, r *http.Request, t Principal) {
	host := r.PathValue("host")
	path, _ := strings.CutSuffix(r.PathValue("path"), "/mail")
	var in struct {
		Text string  `json:"text"`
		From *origin `json:"from"`
	}
	if !decodeBody(w, r, &in) {
		return
	}
	if !wire.ValidMail(in.Text) {
		fail(w, http.StatusBadRequest, "bad_input")
		return
	}
	a, p, status := h.locate(r.Context(), t, host, path)
	if status != 0 {
		if status == http.StatusServiceUnavailable {
			fail(w, status, "host_offline")
		} else {
			fail(w, status, "not_found")
		}
		return
	}
	attrs := []any{"token", t.ID, "method", t.Method, "host", host, "pane", p.PaneID, "bytes", len(in.Text)}
	if !t.canWrite(host, p) || p.Mode != tmux.ModeWrite {
		h.log.Info("audit mail", append(attrs, "result", "read_only")...)
		fail(w, http.StatusForbidden, "read_only")
		return
	}
	if !a.mails(r.Context()) {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	req := wire.Request{Op: wire.OpMail, Actor: t.ID, Pane: p.PaneID, Text: &in.Text, Name: t.Name}
	var from tmux.Pane
	rec := mailRecord{ToHost: host, ToPane: p.PaneID}
	if in.From != nil {
		var status int
		var code string
		if from, status, code = h.origin(r.Context(), t, in.From); status != 0 {
			h.log.Info("audit mail", append(attrs, "from", in.From.Host+"/"+in.From.PaneID, "result", "bad_origin")...)
			fail(w, status, code)
			return
		}
		req.From = in.From.Host + "/" + from.PaneID
		req.Address = in.From.Host + "/" + from.Address()
		rec.FromHost, rec.FromPane = in.From.Host, from.PaneID
		attrs = append(attrs, "from", req.From)
	}
	req.MailID = h.mails.issue(rec)
	resp, err := a.request(r.Context(), req)
	a.forget()
	if err != nil {
		h.mails.drop(req.MailID)
		fail(w, http.StatusServiceUnavailable, "host_offline")
		return
	}
	if resp.Error != "" {
		h.mails.drop(req.MailID)
		h.log.Info("audit mail", append(attrs, "result", resp.Error)...)
		status, code := statusFor(resp.Error)
		fail(w, status, code)
		return
	}
	h.log.Info("audit mail", append(attrs, "mail", req.MailID, "result", "ok")...)
	e := talkEntry{Actor: t.ID, ActorName: t.Name, ToHost: host, To: p, Kind: "mail", Bytes: len(in.Text),
		Text: kept(in.Text), MailID: req.MailID}
	if in.From != nil {
		e.FromHost, e.From = in.From.Host, from
	}
	h.record(e)
	created(w, map[string]any{"mail": map[string]any{"id": req.MailID, "at": time.Now().Unix()}})
}

// MailView is a mail as a reader of the pane sees it.
type MailView struct {
	ID      uint64   `json:"id"`
	At      int64    `json:"at"`
	Actor   actorID  `json:"actor"`
	From    *TalkEnd `json:"from"`
	Text    string   `json:"text"`
	ReadAt  int64    `json:"read_at,omitempty"`
	ReplyTo uint64   `json:"reply_to,omitempty"`
	Replied bool     `json:"replied,omitempty"`
}

// handleMailbox lists a pane's mail for a reader: GET /v1/panes/{address}/mail.
func (h *Hub) handleMailbox(w http.ResponseWriter, r *http.Request, t Principal, path string) {
	host := r.PathValue("host")
	a, p, status := h.locate(r.Context(), t, host, path)
	if status != 0 {
		if status == http.StatusServiceUnavailable {
			fail(w, status, "host_offline")
		} else {
			fail(w, status, "not_found")
		}
		return
	}
	if !a.mails(r.Context()) {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	resp, err := a.request(r.Context(), wire.Request{Op: wire.OpMailList, Actor: t.ID, Pane: p.PaneID})
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
	out := []MailView{}
	lists := map[string][]tmux.Pane{}
	for _, m := range resp.Mail {
		v := MailView{ID: m.ID, At: m.At, Actor: actorID{m.Actor, m.Name}, Text: m.Text, ReadAt: m.ReadAt, ReplyTo: m.ReplyTo, Replied: m.Replied}
		// The origin is named only where the reader may read it too.
		if fh, fid, ok := strings.Cut(m.From, "/"); ok && t.canSeeHost(fh) {
			panes, seen := lists[fh]
			if !seen {
				panes, _, _ = h.readable(r.Context(), t, fh)
				lists[fh] = panes
			}
			for _, q := range panes {
				if q.PaneID == fid {
					e := end(fh, q)
					v.From = &e
				}
			}
		}
		out = append(out, v)
	}
	if wantsText(r) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		for _, v := range out {
			from := ""
			if v.From != nil {
				from = v.From.Address
			}
			text := strings.NewReplacer("\t", " ", "\n", " ").Replace(v.Text)
			fmt.Fprintf(w, "%d\t%d\t%s\t%s\t%d\t%s\n", v.ID, v.At, from, v.Actor.Name, v.ReadAt, text)
		}
		return
	}
	reply(w, map[string]any{"mail": out})
}

// acceptReply takes a pane's answer to a mail: the id must be one the
// hub sent into that pane within the day, from a pane, not answered
// yet; then the origin pane gets the answer as a mail, and the agent
// hears how it went.
func (h *Hub) acceptReply(a *agentConn, rp wire.Reply) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	code := h.deliverReply(ctx, a, rp)
	h.log.Info("reply", "host", a.host, "pane", rp.Pane, "mail", rp.MailID, "bytes", len(rp.Text), "result", resultWord(code))
	raw, _ := json.Marshal(wire.Request{Op: wire.OpReplied, Reply: rp.ID, Result: code})
	a.sess.Write(ctx, raw)
}

func (h *Hub) deliverReply(ctx context.Context, a *agentConn, rp wire.Reply) string {
	if !paneID.MatchString(rp.Pane) || !wire.ValidMail(rp.Text) || rp.ID == 0 {
		return "bad_input"
	}
	a.mu.Lock()
	ok := a.evts.take(eventRate, eventBurst)
	a.mu.Unlock()
	if !ok {
		return "rate_limited"
	}
	rec, found := h.mails.get(rp.MailID)
	switch {
	case !found, rec.ToHost != a.host, rec.ToPane != rp.Pane:
		return wire.ErrNoMail
	case rec.FromHost == "":
		return wire.ErrNoOrigin
	case rec.Replied:
		return wire.ErrReplied
	}
	// The replying pane, as its own agent lists it, for the feed.
	mine, err := a.panes(ctx)
	if err != nil {
		return "host_offline"
	}
	var from tmux.Pane
	for _, q := range mine {
		if q.PaneID == rp.Pane {
			from = q
		}
	}
	if from.PaneID == "" {
		return wire.ErrNotExposed
	}
	oa := h.agent(rec.FromHost)
	if oa == nil {
		return "host_offline"
	}
	theirs, err := oa.panes(ctx)
	if err != nil {
		return "host_offline"
	}
	var to tmux.Pane
	for _, q := range theirs {
		if q.PaneID == rec.FromPane {
			to = q
		}
	}
	if to.PaneID == "" {
		return wire.ErrNotExposed
	}
	if to.Mode != tmux.ModeWrite {
		return wire.ErrReadOnly
	}
	text := rp.Text
	id := h.mails.issue(mailRecord{ToHost: rec.FromHost, ToPane: to.PaneID, FromHost: a.host, FromPane: from.PaneID})
	req := wire.Request{Op: wire.OpMail, Actor: "reply", Name: "reply", Pane: to.PaneID, Text: &text,
		From: a.host + "/" + from.PaneID, Address: a.host + "/" + from.Address(), MailID: id, Reply: rp.MailID}
	resp, err := oa.request(ctx, req)
	oa.forget()
	if err != nil {
		h.mails.drop(id)
		return "host_offline"
	}
	if resp.Error != "" {
		h.mails.drop(id)
		return resp.Error
	}
	h.mails.replied(rp.MailID)
	h.record(talkEntry{Actor: "reply", ActorName: "reply", FromHost: a.host, From: from, ToHost: rec.FromHost, To: to,
		Kind: "mail", Bytes: len(text), Text: kept(text), MailID: id, ReplyTo: rp.MailID})
	return ""
}

func resultWord(code string) string {
	if code == "" {
		return "ok"
	}
	return code
}

// mails says, from the agent's listing, whether the agent holds mail.
func (a *agentConn) mails(ctx context.Context) bool {
	if _, err := a.panes(ctx); err != nil {
		return false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.mailbox
}
