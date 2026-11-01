package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

// Mail: messages held for the process in a pane, never typed into it.
// The hub puts them here for a writable exposed pane; the process reads
// them over the socket when it chooses, or its hooks hand them over at
// the end of a turn. A mailbox lives in memory, with the pane, for a day.
const (
	mailLifetime = 24 * time.Hour
	replyWait    = 15 * time.Second
)

type mailbox struct {
	items []wire.Mail
	wake  chan struct{} // closed and remade when a mail arrives
}

func (a *Agent) box(paneID string) *mailbox {
	b := a.mail[paneID]
	if b == nil {
		b = &mailbox{wake: make(chan struct{})}
		a.mail[paneID] = b
	}
	return b
}

// unread counts the mails the process has not read, and the newest's time.
func (b *mailbox) unread() (int, int64) {
	n, at := 0, int64(0)
	for _, m := range b.items {
		if m.ReadAt == 0 {
			n++
			at = max(at, m.At)
		}
	}
	return n, at
}

// sweep drops mails older than a day. It reports whether any is left.
func (b *mailbox) sweep(now time.Time) bool {
	keep := b.items[:0]
	for _, m := range b.items {
		if now.Unix()-m.At < int64(mailLifetime/time.Second) {
			keep = append(keep, m)
		}
	}
	b.items = keep
	return len(keep) > 0
}

// storeMail puts the hub's mail into the pane's mailbox and answers the
// unread count.
func (a *Agent) storeMail(ctx context.Context, req wire.Request) (int, string) {
	if req.Text == nil || !wire.ValidMail(*req.Text) || req.MailID == 0 || !wire.ValidEventText(req.Name) ||
		(req.From != "" && !wire.ValidEventText(req.From)) || !wire.ValidEventText(req.Address) {
		return 0, wire.ErrBadInput
	}
	p, code := a.find(ctx, req.Pane)
	if code != "" {
		return 0, code
	}
	if p.Mode != tmux.ModeWrite {
		return 0, wire.ErrReadOnly
	}
	a.mu.Lock()
	b := a.box(p.PaneID)
	b.sweep(time.Now())
	if len(b.items) >= wire.MaxMailbox {
		a.mu.Unlock()
		return 0, wire.ErrMailboxFull
	}
	b.items = append(b.items, wire.Mail{ID: req.MailID, At: time.Now().Unix(), Actor: req.Actor, Name: req.Name,
		From: req.From, Address: req.Address, Text: *req.Text, ReplyTo: req.Reply})
	close(b.wake)
	b.wake = make(chan struct{})
	n, _ := b.unread()
	a.mu.Unlock()
	return n, ""
}

// mailList answers a pane's mailbox for a reader, read mail included.
func (a *Agent) mailList(ctx context.Context, req wire.Request) ([]wire.Mail, string) {
	p, code := a.find(ctx, req.Pane)
	if code != "" {
		return nil, code
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	b := a.mail[p.PaneID]
	if b == nil {
		return []wire.Mail{}, ""
	}
	return append([]wire.Mail{}, b.items...), ""
}

// takeMail hands the process in a pane its unread mail and marks it read;
// with all, everything held, marked the same. how says which way it went,
// for the log.
func (a *Agent) takeMail(ctx context.Context, paneID, how string, all bool) ([]wire.Mail, string) {
	p, code := a.find(ctx, paneID)
	if code != "" {
		return nil, code
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	b := a.mail[p.PaneID]
	if b == nil {
		return []wire.Mail{}, ""
	}
	now := time.Now().Unix()
	out := []wire.Mail{}
	read := 0
	for i := range b.items {
		m := &b.items[i]
		if m.ReadAt == 0 {
			m.ReadAt = now
			read++
		} else if !all {
			continue
		}
		out = append(out, *m)
	}
	if read > 0 {
		a.log.Info("mail read", "pane", p.PaneID, "count", read, "how", how)
	}
	return out, ""
}

// peekMail lists without marking anything read.
func (a *Agent) peekMail(ctx context.Context, paneID string) ([]wire.Mail, string) {
	return a.mailList(ctx, wire.Request{Pane: paneID})
}

// waitMail blocks until the pane holds unread mail, then takes it; nil
// and "" when the time runs out.
func (a *Agent) waitMail(ctx context.Context, paneID string, timeout time.Duration) ([]wire.Mail, string) {
	deadline := time.Now().Add(timeout)
	for {
		p, code := a.find(ctx, paneID)
		if code != "" {
			return nil, code
		}
		a.mu.Lock()
		b := a.box(p.PaneID)
		n, _ := b.unread()
		wake := b.wake
		a.mu.Unlock()
		if n > 0 {
			return a.takeMail(ctx, paneID, "wait", false)
		}
		left := time.Until(deadline)
		if left <= 0 {
			return nil, ""
		}
		select {
		case <-wake:
		case <-time.After(left):
			return nil, ""
		case <-ctx.Done():
			return nil, ""
		}
	}
}

// replyMail sends the hub a pane's answer to a mail it holds and waits
// for the hub's word. The hub checks the mail was really sent to this
// pane; the agent only knows what it holds.
func (a *Agent) replyMail(ctx context.Context, paneID string, mailID uint64, text string) string {
	if !wire.ValidMail(text) {
		return wire.ErrBadInput
	}
	p, code := a.find(ctx, paneID)
	if code != "" {
		return code
	}
	a.mu.Lock()
	b := a.mail[p.PaneID]
	var m *wire.Mail
	if b != nil {
		for i := range b.items {
			if b.items[i].ID == mailID {
				m = &b.items[i]
			}
		}
	}
	switch {
	case m == nil:
		a.mu.Unlock()
		return wire.ErrNoMail
	case m.From == "":
		a.mu.Unlock()
		return wire.ErrNoOrigin
	case m.Replied:
		a.mu.Unlock()
		return wire.ErrReplied
	}
	sess := a.sess
	a.nextReply++
	id := a.nextReply
	ch := make(chan string, 1)
	a.replies[id] = ch
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		delete(a.replies, id)
		a.mu.Unlock()
	}()
	if sess == nil {
		return "host_offline"
	}
	raw, _ := json.Marshal(wire.Notice{Reply: &wire.Reply{ID: id, Pane: p.PaneID, MailID: mailID, Text: text}})
	if err := sess.Write(ctx, raw); err != nil {
		return "host_offline"
	}
	var result string
	select {
	case result = <-ch:
	case <-time.After(replyWait):
		result = "host_offline"
	case <-ctx.Done():
		return "host_offline"
	}
	if result == "" {
		a.mu.Lock()
		if b := a.mail[p.PaneID]; b != nil {
			for i := range b.items {
				if b.items[i].ID == mailID {
					b.items[i].Replied = true
				}
			}
		}
		a.mu.Unlock()
	}
	a.log.Info("mail reply", "pane", p.PaneID, "mail", mailID, "bytes", len(text), "result", resultWord(result))
	return result
}

func resultWord(code string) string {
	if code == "" {
		return "ok"
	}
	return code
}

// replied takes the hub's word on a reply and wakes the process waiting.
func (a *Agent) replied(req wire.Request) {
	a.mu.Lock()
	ch := a.replies[req.Reply]
	a.mu.Unlock()
	if ch != nil {
		select {
		case ch <- req.Result:
		default:
		}
	}
}

// FormatMail prints mail as a process reads it: a header line with the
// id, the time, where it came from and who sent it, then the text.
func FormatMail(mails []wire.Mail) string {
	var b strings.Builder
	for _, m := range mails {
		from := m.Address
		if from == "" {
			from = m.From
		}
		if from == "" {
			from = "a client"
		}
		fmt.Fprintf(&b, "--- %d  %s  from %s  (%s)", m.ID, time.Unix(m.At, 0).UTC().Format("2006-01-02 15:04:05"), from, m.Name)
		if m.ReplyTo != 0 {
			fmt.Fprintf(&b, "  reply to %d", m.ReplyTo)
		}
		b.WriteString("\n")
		b.WriteString(m.Text)
		b.WriteString("\n\n")
	}
	return b.String()
}
