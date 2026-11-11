package hub

import (
	"testing"
	"time"

	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

// A listing asked before a forget (a split, a new session, a pane event
// while the agent was asked) may be from before it: it is not kept, so
// the next read asks again and never serves the old pane under the new
// pane's address.
func TestListingAskedBeforeAForgetIsNotKept(t *testing.T) {
	a := &agentConn{pending: map[uint64]chan wire.Response{}}
	if _, _, ok := a.cached(); ok {
		t.Fatal("a cache from nothing")
	}
	_, gen, _ := a.cached()
	a.forget()
	a.keep(gen, wire.Response{Panes: []tmux.Pane{{PaneID: "%17", PaneIndex: 2}}, Sessions: true})
	if _, _, ok := a.cached(); ok {
		t.Fatal("a listing asked before the forget was kept")
	}
	if !a.starts {
		t.Fatal("the agent's flags are kept either way")
	}
	// Asked after the forget, it is kept, for a second.
	_, gen, _ = a.cached()
	a.keep(gen, wire.Response{Panes: []tmux.Pane{{PaneID: "%18", PaneIndex: 2}}})
	list, _, ok := a.cached()
	if !ok || len(list) != 1 || list[0].PaneID != "%18" {
		t.Fatalf("the fresh listing is not the cache: %v %v", ok, list)
	}
	a.listAt = time.Now().Add(-2 * time.Second)
	if _, _, ok := a.cached(); ok {
		t.Fatal("a listing older than a second served")
	}
}

// Without a forget in between, a listing is cached as before.
func TestListingIsCachedForASecond(t *testing.T) {
	a := &agentConn{pending: map[uint64]chan wire.Response{}}
	_, gen, _ := a.cached()
	a.keep(gen, wire.Response{Panes: []tmux.Pane{{PaneID: "%1"}}})
	if _, _, ok := a.cached(); !ok {
		t.Fatal("not cached")
	}
	a.forget()
	if _, _, ok := a.cached(); ok {
		t.Fatal("cached after a forget")
	}
}
