package hub

import (
	"context"
	"testing"
	"time"

	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

func TestEventLogCursor(t *testing.T) {
	l := newEventLog()
	all := func(event) bool { return true }
	odd := func(e event) bool { return e.Seq%2 == 1 }
	if evs, next := l.after(^uint64(0), 10, all); len(evs) != 0 || next != 0 {
		t.Fatalf("empty log: %v %d", evs, next)
	}
	for i := 0; i < 7; i++ {
		l.add("alice-laptop", wire.Event{Pane: tmux.Pane{PaneID: "%1", Mode: tmux.ModeRead}, Kind: wire.KindDone})
	}
	evs, next := l.after(^uint64(0), 3, all)
	if len(evs) != 3 || evs[0].Seq != 5 || evs[2].Seq != 7 || next != 7 {
		t.Fatalf("recent: %v %d", evs, next)
	}
	evs, next = l.after(2, 2, all)
	if len(evs) != 2 || evs[0].Seq != 3 || next != 4 {
		t.Fatalf("after 2: %v %d", evs, next)
	}
	evs, next = l.after(2, 10, odd)
	if len(evs) != 3 || evs[0].Seq != 3 || evs[2].Seq != 7 || next != 7 {
		t.Fatalf("filtered: %v %d", evs, next)
	}
	if evs, next := l.after(7, 10, all); len(evs) != 0 || next != 7 {
		t.Fatalf("at end: %v %d", evs, next)
	}
	for i := 0; i < eventRing+10; i++ {
		l.add("alice-laptop", wire.Event{Kind: wire.KindIdle})
	}
	evs, _ = l.after(0, 1000, all)
	if len(evs) != eventRing || evs[0].Seq != 7+10+1 {
		t.Fatalf("ring: %d from %d", len(evs), evs[0].Seq)
	}
	done := make(chan struct{})
	go func() { l.wait(context.Background(), l.cursor()); close(done) }()
	time.Sleep(20 * time.Millisecond)
	l.add("alice-laptop", wire.Event{Kind: wire.KindDone})
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("wait did not wake")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	l.wait(ctx, l.cursor())
}
