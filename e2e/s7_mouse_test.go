//go:build e2e

package e2e

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Mouse input: a click at a cell for a program that asked for the mouse.

// 80
func TestSec80_MouseNeedsWriteAndMouseMode(t *testing.T) {
	e, ts, _ := basic(t)
	ts.must("new-window", "-t", "work:1", "-n", "ro", shell())
	ts.title("work:1.0")
	e.expose(ts, "work:1.0") // read-only
	reader := e.token("reader", []string{host + "/*"}, nil)
	writer := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	click := map[string]any{"mouse": map[string]any{"button": "left", "x": 5, "y": 3}}
	before := ts.capture("work:0.0")
	expect(t, e.input(reader, shell0, click), http.StatusForbidden, "read-only token")
	expect(t, e.input(writer, host+"/work/1.0", click), http.StatusForbidden, "read-only pane")
	// A shell did not ask for the mouse: refused, nothing typed.
	expect(t, e.input(writer, shell0, click), http.StatusBadRequest, "no mouse mode")
	for _, body := range []map[string]any{
		{"mouse": map[string]any{"button": "left", "x": 0, "y": 3}},
		{"mouse": map[string]any{"button": "left", "x": 5, "y": 999}},
		{"mouse": map[string]any{"button": "double", "x": 5, "y": 3}},
		{"mouse": map[string]any{"button": "left"}},
		{"mouse": map[string]any{"button": "left", "x": 5, "y": 3}, "key": "Enter"},
		{"mouse": "left"},
	} {
		expect(t, e.input(writer, shell0, body), http.StatusBadRequest, "bad mouse body")
	}
	time.Sleep(300 * time.Millisecond)
	if after := ts.capture("work:0.0"); after != before {
		t.Fatalf("pane changed:\n%s", after)
	}
	logs, _ := os.ReadFile(filepath.Join(e.logs, "agent-"+host+".log"))
	if !strings.Contains(string(logs), "mouse=left result=bad_input") {
		t.Fatalf("agent audit:\n%s", logs)
	}
}

// 81
func TestFlow81_ClickReachesAProgramWithTheMouse(t *testing.T) {
	e, ts, _ := basic(t)
	tok := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	// cat -v shows what it reads; the printf before it asks for the mouse in SGR.
	ts.must("send-keys", "-t", "work:0.0", "-l", `printf '\033[?1000h\033[?1006h'; cat -v`)
	ts.must("send-keys", "-t", "work:0.0", "Enter")
	waitFor(t, "cat running", func() bool {
		return ts.must("display-message", "-p", "-t", "work:0.0", "#{pane_current_command}") == "cat"
	})
	r := e.get(tok, "/v1/panes/"+shell0)
	if !strings.Contains(r.body, `"mouse":true`) {
		t.Fatalf("pane not listed with the mouse: %s", r.body)
	}
	expect(t, e.input(tok, shell0, map[string]any{"mouse": map[string]any{"button": "left", "x": 5, "y": 3}}), http.StatusNoContent, "click")
	waitFor(t, "click shown", func() bool { return strings.Contains(ts.capture("work:0.0"), "^[[<0;5;3M^[[<0;5;3m") })
	expect(t, e.input(tok, shell0, map[string]any{"mouse": map[string]any{"button": "wheeldown", "x": 1, "y": 1}}), http.StatusNoContent, "wheel")
	waitFor(t, "wheel shown", func() bool { return strings.Contains(ts.capture("work:0.0"), "^[[<65;1;1M") })
	// The old encoding, for a program without SGR.
	ts.must("send-keys", "-t", "work:0.0", "C-c")
	ts.must("send-keys", "-t", "work:0.0", "-l", `printf '\033[?1006l\033[?1000h'; cat -v`)
	ts.must("send-keys", "-t", "work:0.0", "Enter")
	time.Sleep(300 * time.Millisecond)
	expect(t, e.input(tok, shell0, map[string]any{"mouse": map[string]any{"button": "right", "x": 2, "y": 4}}), http.StatusNoContent, "old click")
	waitFor(t, "old click shown", func() bool { return strings.Contains(ts.capture("work:0.0"), "^[[M\"\"$^[[M#\"$") })
	logs, _ := os.ReadFile(filepath.Join(e.logs, "hub.log"))
	if !strings.Contains(string(logs), "mouse=left result=ok") {
		t.Fatalf("hub audit:\n%s", logs)
	}
}
