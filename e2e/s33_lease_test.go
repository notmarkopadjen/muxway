//go:build e2e

package e2e

import (
	"net/http"
	"testing"
	"time"
)

// The client touched last wins, host-side. A window is the size the
// client being used is showing it at: a command from a client that is
// not the window's puts the window back to that client's own viewport,
// at once and without asking. A client that has declared no viewport
// moves nothing, however much it reads or types.
// docs/plans/2026-11-25-one-size-per-window.md.

// A pause past the window's one resize a second, so a fit of this test's
// own is never the rate limit's.
func settle() { time.Sleep(1100 * time.Millisecond) }

func TestLease_InputTakesTheWindowBackToTheClientThatTyped(t *testing.T) {
	e, ts, _ := basic(t)
	web := e.token("web", []string{host + "/*"}, []string{host + "/*"})
	phone := e.token("phone", []string{host + "/*"}, []string{host + "/*"})
	expect(t, e.resize(phone, shell0, `{"cols":80,"rows":24,"scope":"window","client":"Pixel 9"}`), http.StatusOK, "the phone's fit")
	settle()
	expect(t, e.resize(web, shell0, `{"cols":160,"rows":40,"scope":"window","client":"Chrome"}`), http.StatusOK, "the web's fit")
	if got := ts.windowSize("work:0"); got != "160x40" {
		t.Fatalf("the last fit sizes the window: %s", got)
	}
	// The person picks up the phone and types: the window becomes the
	// size the phone is showing it at, with no fit from the phone.
	settle()
	expect(t, e.input(phone, shell0, map[string]any{"key": "Escape", "client": "Pixel 9"}), http.StatusNoContent, "the phone types")
	if got := ts.windowSize("work:0"); got != "80x24" {
		t.Fatalf("input did not take the window back: %s", got)
	}
	// The listing says whose it is now.
	h := holderOf(t, e.get(phone, "/v1/panes/"+shell0).body)
	if h == nil || h.Token != "phone" || h.Client != "Pixel 9" {
		t.Fatalf("sized_by is %+v", h)
	}
	// A second command from the same client moves nothing.
	settle()
	expect(t, e.resize(web, shell0, `{"cols":160,"rows":40,"scope":"window","client":"Chrome"}`), http.StatusOK, "the web's fit again")
	settle()
	expect(t, e.input(web, shell0, map[string]any{"key": "Escape", "client": "Chrome"}), http.StatusNoContent, "the web types")
	if got := ts.windowSize("work:0"); got != "160x40" {
		t.Fatalf("the window is the web's: %s", got)
	}
}

func TestLease_AClientThatDeclaredNoViewportMovesNothing(t *testing.T) {
	e, ts, _ := basic(t)
	web := e.token("web", []string{host + "/*"}, []string{host + "/*"})
	reader := e.token("midp", []string{host + "/*"}, []string{host + "/*"})
	expect(t, e.resize(web, shell0, `{"cols":160,"rows":40,"scope":"window","client":"Chrome"}`), http.StatusOK, "the web's fit")
	before := ts.windowSize("work:0")
	// A feature phone reads the pane and types into it, and has asked
	// for no size of its own.
	for i := 0; i < 3; i++ {
		expect(t, e.get(reader, "/v1/panes/"+shell0), http.StatusOK, "a read")
		expect(t, e.input(reader, shell0, map[string]any{"key": "Escape", "client": "midp"}), http.StatusNoContent, "it types")
	}
	if got := ts.windowSize("work:0"); got != before {
		t.Fatalf("a client with no viewport moved the window: %s was %s", got, before)
	}
}

func TestLease_TwoClientsOnOneTokenAreTwoClients(t *testing.T) {
	e, ts, _ := basic(t)
	tok := e.token("both", []string{host + "/*"}, []string{host + "/*"})
	expect(t, e.resize(tok, shell0, `{"cols":90,"rows":26,"scope":"window","client":"Pixel 9"}`), http.StatusOK, "the handset's fit")
	settle()
	expect(t, e.resize(tok, shell0, `{"cols":150,"rows":38,"scope":"window","client":"Chrome"}`), http.StatusOK, "the browser's fit")
	settle()
	expect(t, e.input(tok, shell0, map[string]any{"key": "Escape", "client": "Pixel 9"}), http.StatusNoContent, "the handset types")
	if got := ts.windowSize("work:0"); got != "90x26" {
		t.Fatalf("one token, two clients: %s", got)
	}
}

func TestLease_AReleaseForgetsEveryClientsViewport(t *testing.T) {
	e, ts, _ := basic(t)
	web := e.token("web", []string{host + "/*"}, []string{host + "/*"})
	phone := e.token("phone", []string{host + "/*"}, []string{host + "/*"})
	expect(t, e.resize(phone, shell0, `{"cols":80,"rows":24,"scope":"window","client":"Pixel 9"}`), http.StatusOK, "the phone's fit")
	settle()
	expect(t, e.resize(web, shell0, `{"cols":160,"rows":40,"scope":"window","client":"Chrome"}`), http.StatusOK, "the web's fit")
	expect(t, e.resize(web, shell0, `{"fit":"auto"}`), http.StatusOK, "the release")
	after := ts.windowSize("work:0")
	settle()
	// The phone types: nothing is put back, the window stays released.
	expect(t, e.input(phone, shell0, map[string]any{"key": "Escape", "client": "Pixel 9"}), http.StatusNoContent, "the phone types")
	if got := ts.windowSize("work:0"); got != after {
		t.Fatalf("a released window was taken back: %s was %s", got, after)
	}
}

func TestSec229_AReadOnlyClientTakesNoWindow(t *testing.T) {
	e, ts, _ := basic(t)
	web := e.token("web", []string{host + "/*"}, []string{host + "/*"})
	reader := e.token("viewer", []string{host + "/*"}, nil)
	expect(t, e.resize(web, shell0, `{"cols":160,"rows":40,"scope":"window","client":"Chrome"}`), http.StatusOK, "the web's fit")
	before := ts.windowSize("work:0")
	// A reader cannot declare a viewport and cannot type, so it can
	// never be a window's owner, whatever label it sends.
	expect(t, e.resize(reader, shell0, `{"cols":80,"rows":24,"scope":"window","client":"Chrome"}`), http.StatusForbidden, "a reader's fit")
	expect(t, e.input(reader, shell0, map[string]any{"text": "x", "client": "Chrome"}), http.StatusForbidden, "a reader's input")
	if got := ts.windowSize("work:0"); got != before {
		t.Fatalf("a reader moved the window: %s was %s", got, before)
	}
	h := holderOf(t, e.get(web, "/v1/panes/"+shell0).body)
	if h == nil || h.Client != "Chrome" || h.Token != "web" {
		t.Fatalf("the holder changed: %+v", h)
	}
}

func TestSec230_TheInputLabelIsCheckedLikeTheFitsAndSetsNoLease(t *testing.T) {
	e, ts, _ := basic(t)
	web := e.token("web", []string{host + "/*"}, []string{host + "/*"})
	phone := e.token("phone", []string{host + "/*"}, []string{host + "/*"})
	expect(t, e.resize(phone, shell0, `{"cols":80,"rows":24,"scope":"window","client":"Pixel 9"}`), http.StatusOK, "the phone's fit")
	settle()
	expect(t, e.resize(web, shell0, `{"cols":160,"rows":40,"scope":"window","client":"Chrome"}`), http.StatusOK, "the web's fit")
	before := ts.windowSize("work:0")
	for _, bad := range []string{"tab\there", "bell\u0007", " padded", "0123456789012345678901234567890123"} {
		r := e.input(phone, shell0, map[string]any{"key": "Escape", "client": bad})
		if r.status != http.StatusBadRequest {
			t.Fatalf("label %q: %d %s", bad, r.status, r.body)
		}
	}
	if got := ts.windowSize("work:0"); got != before {
		t.Fatalf("a refused label moved the window: %s was %s", got, before)
	}
}
