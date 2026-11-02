package hub

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/notmarkopadjen/muxway/internal/tmux"
)

// Talk: a write that names the pane it came from. The hub keeps one
// entry per such write, in memory, so a client that reads both panes can
// see who said what to whom; the listing marks the panes that talked
// lately with their partners.
const (
	talkRing   = 500
	talkWindow = 10 * time.Minute
	talkChars  = 200 // of a text, kept for the feed
)

// origin is the from field of an input or an answer: the sender's pane.
type origin struct {
	Host   string `json:"host"`
	PaneID string `json:"pane_id"`
}

type talkEntry struct {
	Seq       uint64
	At        int64
	Actor     string
	ActorName string
	FromHost  string
	From      tmux.Pane
	ToHost    string
	To        tmux.Pane
	Kind      string // text, key, answer or mail
	Bytes     int
	Text      string
	// MailID and ReplyTo, with a mail: the id the hub gave it, and the
	// mail it answers. A mail from a client that is not a pane has no From.
	MailID  uint64
	ReplyTo uint64
}

// hasFrom says the entry came from a pane.
func (e talkEntry) hasFrom() bool { return e.FromHost != "" }

type talkLog struct {
	mu   sync.Mutex
	seq  uint64
	ring []talkEntry
	wake chan struct{}
}

func newTalkLog() *talkLog { return &talkLog{wake: make(chan struct{})} }

func (l *talkLog) add(e talkEntry) talkEntry {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.seq++
	e.Seq, e.At = l.seq, time.Now().Unix()
	if len(l.ring) == talkRing {
		copy(l.ring, l.ring[1:])
		l.ring = l.ring[:talkRing-1]
	}
	l.ring = append(l.ring, e)
	close(l.wake)
	l.wake = make(chan struct{})
	return e
}

// after works as the event log's: up to limit visible entries past the
// cursor, or the most recent ones without a cursor, and the cursor to
// continue from.
func (l *talkLog) after(cursor uint64, limit int, visible func(talkEntry) bool) ([]talkEntry, uint64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	var out []talkEntry
	if cursor > l.seq {
		for i := len(l.ring) - 1; i >= 0 && len(out) < limit; i-- {
			if visible(l.ring[i]) {
				out = append(out, l.ring[i])
			}
		}
		for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
			out[i], out[j] = out[j], out[i]
		}
		return out, l.seq
	}
	for _, e := range l.ring {
		if e.Seq > cursor && visible(e) {
			out = append(out, e)
			if len(out) == limit {
				return out, e.Seq
			}
		}
	}
	return out, l.seq
}

func (l *talkLog) wait(ctx context.Context, cursor uint64) {
	l.mu.Lock()
	if l.seq > cursor {
		l.mu.Unlock()
		return
	}
	ch := l.wake
	l.mu.Unlock()
	select {
	case <-ch:
	case <-ctx.Done():
	}
}

// recent returns the entries since a moment, oldest first.
func (l *talkLog) recent(since int64) []talkEntry {
	l.mu.Lock()
	defer l.mu.Unlock()
	i := sort.Search(len(l.ring), func(i int) bool { return l.ring[i].At >= since })
	return append([]talkEntry(nil), l.ring[i:]...)
}

// kept is what the feed keeps of a text: its first characters, whole.
func kept(s string) string {
	if utf8.RuneCountInString(s) <= talkChars {
		return s
	}
	n := 0
	for i := range s {
		if n == talkChars {
			return s[:i]
		}
		n++
	}
	return s
}

// origin resolves the pane a write says it came from: a pane the
// principal may read, by its id, on a host that is online. Anything else
// is refused like a pane the principal may not see, and a malformed one
// as bad input.
func (h *Hub) origin(ctx context.Context, t Principal, o *origin) (tmux.Pane, int, string) {
	if !hostName.MatchString(o.Host) || !paneID.MatchString(o.PaneID) {
		return tmux.Pane{}, http.StatusBadRequest, "bad_input"
	}
	if t.canSeeHost(o.Host) {
		if panes, _, err := h.readable(ctx, t, o.Host); err == nil {
			for _, p := range panes {
				if p.PaneID == o.PaneID {
					return p, 0, ""
				}
			}
		}
	}
	return tmux.Pane{}, http.StatusNotFound, "not_found"
}

// said records a write that came from a pane. The feed keeps the text,
// the log only its size.
func (h *Hub) said(t Principal, o *origin, from tmux.Pane, toHost string, to tmux.Pane, kind, text string, size int) {
	h.record(talkEntry{Actor: t.ID, ActorName: t.Name, FromHost: o.Host, From: from,
		ToHost: toHost, To: to, Kind: kind, Bytes: size, Text: kept(text)})
}

// record adds an entry to the feed and logs it without its text.
func (h *Hub) record(e talkEntry) {
	e = h.talk.add(e)
	from := "client"
	if e.hasFrom() {
		from = e.FromHost + "/" + e.From.PaneID
	}
	attrs := []any{"seq", e.Seq, "from", from, "to", e.ToHost + "/" + e.To.PaneID, "token", e.Actor, "kind", e.Kind, "bytes", e.Bytes}
	if e.MailID != 0 {
		attrs = append(attrs, "mail", e.MailID)
	}
	if e.ReplyTo != 0 {
		attrs = append(attrs, "reply_to", e.ReplyTo)
	}
	h.log.Info("talk", attrs...)
}

// TalkPartner is a pane another pane talked with lately, on the listing.
type TalkPartner struct {
	Address string `json:"address"`
	PaneID  string `json:"pane_id"`
	At      int64  `json:"at"`
	Way     string `json:"way"` // to, from or both
}

// withTalk adds to each view the panes it talked with in the window,
// among those the principal may read, at their current addresses.
func (h *Hub) withTalk(ctx context.Context, t Principal, views []PaneView) {
	entries := h.talk.recent(time.Now().Add(-talkWindow).Unix())
	if len(entries) == 0 {
		return
	}
	lists := map[string][]tmux.Pane{}
	current := func(host, id string) (tmux.Pane, bool) {
		panes, seen := lists[host]
		if !seen {
			if t.canSeeHost(host) {
				panes, _, _ = h.readable(ctx, t, host)
			}
			lists[host] = panes
		}
		for _, p := range panes {
			if p.PaneID == id {
				return p, true
			}
		}
		return tmux.Pane{}, false
	}
	for i := range views {
		v := &views[i]
		partners := map[string]*TalkPartner{}
		for _, e := range entries {
			if !e.hasFrom() {
				continue
			}
			var host, id, way string
			switch {
			case e.FromHost == v.Host && e.From.PaneID == v.PaneID:
				host, id, way = e.ToHost, e.To.PaneID, "to"
			case e.ToHost == v.Host && e.To.PaneID == v.PaneID:
				host, id, way = e.FromHost, e.From.PaneID, "from"
			default:
				continue
			}
			key := host + "/" + id
			if tp, ok := partners[key]; ok {
				tp.At = max(tp.At, e.At)
				if tp.Way != way {
					tp.Way = "both"
				}
				continue
			}
			p, ok := current(host, id)
			if !ok {
				continue
			}
			partners[key] = &TalkPartner{Address: host + "/" + p.Address(), PaneID: id, At: e.At, Way: way}
		}
		if len(partners) == 0 {
			continue
		}
		for _, tp := range partners {
			v.Talk = append(v.Talk, *tp)
		}
		sort.Slice(v.Talk, func(a, b int) bool {
			if v.Talk[a].At != v.Talk[b].At {
				return v.Talk[a].At > v.Talk[b].At
			}
			return v.Talk[a].Address < v.Talk[b].Address
		})
	}
}

// TalkEnd is one side of an entry as a client sees it.
type TalkEnd struct {
	Host    string `json:"host"`
	Address string `json:"address"`
	PaneID  string `json:"pane_id"`
	Alias   string `json:"alias,omitempty"`
}

// TalkView is one entry of the feed.
type TalkView struct {
	Seq   uint64   `json:"seq"`
	At    int64    `json:"at"`
	Actor actorID  `json:"actor"`
	From  *TalkEnd `json:"from"`
	To    TalkEnd  `json:"to"`
	Kind  string   `json:"kind"`
	Bytes int      `json:"bytes,omitempty"`
	Text  string   `json:"text"`
	// ID of a mail, and the mail a reply answers.
	ID      uint64 `json:"id,omitempty"`
	ReplyTo uint64 `json:"reply_to,omitempty"`
}

type actorID struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func end(host string, p tmux.Pane) TalkEnd {
	return TalkEnd{Host: host, Address: host + "/" + p.Address(), PaneID: p.PaneID, Alias: p.Alias}
}

// handleTalk is the feed: entries whose both panes the principal may
// read, after a cursor, long-polled like the events.
func (h *Hub) handleTalk(w http.ResponseWriter, r *http.Request, t Principal) {
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
	visible := func(e talkEntry) bool {
		return (!e.hasFrom() || (t.canSeeHost(e.FromHost) && t.canRead(e.FromHost, e.From))) &&
			t.canSeeHost(e.ToHost) && t.canRead(e.ToHost, e.To)
	}
	deadline := time.Now().Add(time.Duration(wait) * time.Second)
	entries, next := h.talk.after(cursor, limit, visible)
	for len(entries) == 0 && time.Now().Before(deadline) && r.Context().Err() == nil {
		ctx, cancel := context.WithDeadline(r.Context(), deadline)
		h.talk.wait(ctx, next)
		cancel()
		entries, next = h.talk.after(next, limit, visible)
	}
	out := []TalkView{}
	for _, e := range entries {
		v := TalkView{Seq: e.Seq, At: e.At, Actor: actorID{e.Actor, e.ActorName},
			To: end(e.ToHost, e.To), Kind: e.Kind, Bytes: e.Bytes, Text: e.Text, ID: e.MailID, ReplyTo: e.ReplyTo}
		if e.hasFrom() {
			f := end(e.FromHost, e.From)
			v.From = &f
		}
		out = append(out, v)
	}
	if wantsText(r) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		for _, v := range out {
			text := strings.NewReplacer("\t", " ", "\n", " ").Replace(v.Text)
			from := ""
			if v.From != nil {
				from = v.From.Address
			}
			fmt.Fprintf(w, "%d\t%d\t%s\t%s\t%s\t%s\n", v.Seq, v.At, from, v.To.Address, v.Kind, text)
		}
		fmt.Fprintf(w, "next\t%d\n", next)
		return
	}
	reply(w, map[string]any{"talk": out, "next": next})
}
