package agent

import (
	"testing"
	"time"
)

// The lease: what each client asked a window to be, and whose ask the
// window has. A command from another client takes it back to that
// client's own size; a client that never asked moves nothing.

func newLease() *Agent {
	return &Agent{views: map[string][]viewport{}, owner: map[string]string{}}
}

func ask(a *Agent, window, actor, client string, cols, rows int) viewport {
	v := viewport{
		key: viewportKey(actor, client), actor: actor, token: actor, client: client,
		cols: cols, rows: rows, scope: "window", at: time.Now(),
	}
	a.remember(window, v)
	return v
}

func TestLeaseOwnerIsTheLastToAsk(t *testing.T) {
	a := newLease()
	ask(a, "@1", "tok-a", "web", 200, 50)
	ask(a, "@1", "tok-b", "phone", 80, 24)
	if got := a.owner["@1"]; got != viewportKey("tok-b", "phone") {
		t.Fatalf("owner %q", got)
	}
}

func TestLeaseAClientsOwnCommandMovesNothing(t *testing.T) {
	a := newLease()
	ask(a, "@1", "tok-a", "web", 200, 50)
	if _, ok := a.takeWindow("@1", viewportKey("tok-a", "web")); ok {
		t.Fatal("the window is already this client's; nothing to put back")
	}
}

func TestLeaseAnotherClientsCommandTakesItBack(t *testing.T) {
	a := newLease()
	ask(a, "@1", "tok-b", "phone", 80, 24)
	ask(a, "@1", "tok-a", "web", 200, 50)
	v, ok := a.takeWindow("@1", viewportKey("tok-b", "phone"))
	if !ok || v.cols != 80 || v.rows != 24 {
		t.Fatalf("got %v %v", v, ok)
	}
	if a.owner["@1"] != viewportKey("tok-b", "phone") {
		t.Fatal("the client that typed owns the window now")
	}
	// And again from the same client sends nothing.
	if _, ok := a.takeWindow("@1", viewportKey("tok-b", "phone")); ok {
		t.Fatal("twice")
	}
}

func TestLeaseAClientThatNeverAskedMovesNothing(t *testing.T) {
	a := newLease()
	ask(a, "@1", "tok-a", "web", 200, 50)
	// A feature phone reads and types and has declared no viewport.
	if _, ok := a.takeWindow("@1", viewportKey("tok-c", "midp")); ok {
		t.Fatal("a client with no viewport moves nothing")
	}
	if a.owner["@1"] != viewportKey("tok-c", "midp") {
		t.Fatal("it is the owner all the same, so its own next command sends nothing")
	}
}

func TestLeaseTwoClientsOnOneTokenAreTwo(t *testing.T) {
	a := newLease()
	ask(a, "@1", "tok-a", "Chrome", 200, 50)
	ask(a, "@1", "tok-a", "Pixel 9", 80, 24)
	v, ok := a.takeWindow("@1", viewportKey("tok-a", "Chrome"))
	if !ok || v.cols != 200 {
		t.Fatalf("got %v %v", v, ok)
	}
}

func TestLeaseAnEmptyKeyIsNoClient(t *testing.T) {
	a := newLease()
	a.remember("@1", viewport{cols: 80, rows: 24})
	if len(a.views["@1"]) != 0 || a.owner["@1"] != "" {
		t.Fatal("a request with no actor leaves no lease")
	}
	if _, ok := a.takeWindow("@1", ""); ok {
		t.Fatal("and takes nothing")
	}
}

func TestLeaseKeepsTheLastFewClients(t *testing.T) {
	a := newLease()
	for i := 0; i < maxViewports+4; i++ {
		ask(a, "@1", "tok", string(rune('a'+i)), 80+i, 24)
	}
	if len(a.views["@1"]) != maxViewports {
		t.Fatalf("%d viewports kept", len(a.views["@1"]))
	}
	// The first clients are gone, the last are not. The owner is set by
	// every take, so each is asked of a fresh lease.
	kept := map[string]bool{}
	for _, v := range a.views["@1"] {
		kept[v.client] = true
	}
	if kept["a"] {
		t.Fatal("the oldest client should have gone")
	}
	if !kept[string(rune('a'+maxViewports+3))] || !kept[string(rune('a'+maxViewports+2))] {
		t.Fatal("the newest clients are kept")
	}
}

func TestLeaseOneClientAsksTwiceAndIsKeptOnce(t *testing.T) {
	a := newLease()
	ask(a, "@1", "tok", "web", 80, 24)
	ask(a, "@1", "tok", "web", 120, 30)
	if len(a.views["@1"]) != 1 {
		t.Fatalf("%d viewports", len(a.views["@1"]))
	}
	ask(a, "@1", "tok", "phone", 60, 20)
	v, ok := a.takeWindow("@1", viewportKey("tok", "web"))
	if !ok || v.cols != 120 || v.rows != 30 {
		t.Fatalf("the last ask is the one kept: %v %v", v, ok)
	}
}

func TestLeaseWindowsAreApart(t *testing.T) {
	a := newLease()
	ask(a, "@1", "tok", "web", 200, 50)
	ask(a, "@2", "tok", "phone", 80, 24)
	if _, ok := a.takeWindow("@1", viewportKey("tok", "phone")); ok {
		t.Fatal("a viewport of one window is not another's")
	}
}
