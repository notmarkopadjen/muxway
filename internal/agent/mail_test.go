package agent

import (
	"strings"
	"testing"
	"time"

	"github.com/notmarkopadjen/muxway/internal/wire"
)

func TestMailboxCountsSweepsAndFormats(t *testing.T) {
	b := &mailbox{wake: make(chan struct{})}
	now := time.Now()
	b.items = append(b.items,
		wire.Mail{ID: 1, At: now.Add(-25 * time.Hour).Unix(), Text: "old"},
		wire.Mail{ID: 2, At: now.Add(-time.Hour).Unix(), Text: "read", ReadAt: now.Unix()},
		wire.Mail{ID: 3, At: now.Unix(), Text: "new", Name: "reviewer", Address: "alice-laptop/work/1.0", From: "alice-laptop/%3"},
	)
	if n, at := b.unread(); n != 2 || at != now.Unix() {
		t.Fatalf("unread before the sweep: %d at %d", n, at)
	}
	if !b.sweep(now) || len(b.items) != 2 || b.items[0].ID != 2 {
		t.Fatalf("sweep: %+v", b.items)
	}
	if n, _ := b.unread(); n != 1 {
		t.Fatalf("unread after the sweep: %d", n)
	}
	out := FormatMail(b.items[1:])
	if !strings.HasPrefix(out, "--- 3  ") || !strings.Contains(out, "from alice-laptop/work/1.0  (reviewer)\nnew\n\n") {
		t.Fatalf("format:\n%s", out)
	}
	if got := FormatMail([]wire.Mail{{ID: 4, Name: "phone", Text: "hi", ReplyTo: 3}}); !strings.Contains(got, "from a client  (phone)  reply to 3\n") {
		t.Fatalf("a client's mail with a reply:\n%s", got)
	}
	empty := &mailbox{}
	if empty.sweep(now) {
		t.Fatal("an empty box is kept")
	}
	if !strings.Contains(MailReason(b.items[1:]), "not from the person who runs you") {
		t.Fatal("the reason does not say it is mail")
	}
}

func TestValidMail(t *testing.T) {
	ok := []string{"a", "two\nlines", "tab\there", strings.Repeat("x", wire.MaxMailChars), "ünïcode ✓"}
	bad := []string{"", strings.Repeat("x", wire.MaxMailChars+1), "esc\x1b[2J", "del\x7f", "c1\u0085", "bad�"}
	for _, s := range ok {
		if !wire.ValidMail(s) {
			t.Errorf("refused: %q", s)
		}
	}
	for _, s := range bad {
		if wire.ValidMail(s) {
			t.Errorf("accepted: %q", s)
		}
	}
}
