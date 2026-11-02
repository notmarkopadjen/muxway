package hub

import (
	"strings"
	"testing"

	"github.com/notmarkopadjen/muxway/internal/tmux"
)

func TestTalkLogKeepsARingAndACursor(t *testing.T) {
	l := newTalkLog()
	all := func(talkEntry) bool { return true }
	if got, next := l.after(^uint64(0), 10, all); len(got) != 0 || next != 0 {
		t.Fatalf("empty: %v %d", got, next)
	}
	for i := 0; i < talkRing+5; i++ {
		l.add(talkEntry{Kind: "text", Text: "m"})
	}
	got, next := l.after(^uint64(0), 3, all)
	if len(got) != 3 || got[0].Seq != uint64(talkRing+3) || got[2].Seq != uint64(talkRing+5) || next != uint64(talkRing+5) {
		t.Fatalf("most recent: %+v next %d", got, next)
	}
	got, next = l.after(2, 100, all)
	if len(got) != 100 || got[0].Seq != 6 || next != 105 {
		t.Fatalf("after the ring's start: first %d, n %d, next %d", got[0].Seq, len(got), next)
	}
	got, next = l.after(uint64(talkRing+4), 100, all)
	if len(got) != 1 || got[0].Seq != uint64(talkRing+5) || next != uint64(talkRing+5) {
		t.Fatalf("the last one: %+v %d", got, next)
	}
	only := func(e talkEntry) bool { return e.Seq%2 == 0 }
	if got, _ := l.after(uint64(talkRing), 100, only); len(got) != 2 {
		t.Fatalf("filtered: %d", len(got))
	}
}

func TestTalkKeepsTheFirstCharacters(t *testing.T) {
	short := "run the tests"
	if kept(short) != short {
		t.Fatal("a short text is cut")
	}
	long := strings.Repeat("é", talkChars+10)
	if got := kept(long); got != strings.Repeat("é", talkChars) {
		t.Fatalf("cut at %d characters, got %d", talkChars, len([]rune(got)))
	}
}

func TestTalkPartnersMergeTheWays(t *testing.T) {
	h := &Hub{talk: newTalkLog()}
	a := tmux.Pane{SessionName: "work", PaneID: "%1", Mode: tmux.ModeWrite}
	b := tmux.Pane{SessionName: "work", PaneIndex: 1, PaneID: "%2", Mode: tmux.ModeWrite}
	h.talk.add(talkEntry{FromHost: "alice-laptop", From: a, ToHost: "alice-laptop", To: b, Kind: "text"})
	h.talk.add(talkEntry{FromHost: "alice-laptop", From: b, ToHost: "alice-laptop", To: a, Kind: "key"})
	// No agent is attached, so no partner resolves to a current pane: the
	// views stay bare rather than naming a pane the hub cannot see.
	views := []PaneView{{Host: "alice-laptop", Address: "alice-laptop/work/0.0", Pane: a}}
	h.withTalk(t.Context(), Principal{Read: []string{"*"}}, views)
	if views[0].Talk != nil {
		t.Fatalf("a partner without a listing: %+v", views[0].Talk)
	}
	entries := h.talk.recent(0)
	if len(entries) != 2 || entries[0].Kind != "text" {
		t.Fatalf("recent: %+v", entries)
	}
}
