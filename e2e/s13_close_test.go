//go:build e2e

package e2e

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Closing a pane on its host: a write grant, a writable mark, and an
// agent run with --allow-close. Whatever runs in the pane ends.

func closeEnv(t *testing.T, agentArgs ...string) (*env, *tmuxServer) {
	e := newEnv(t)
	ts := newTmux(t)
	e.pairAgent(host, ts, agentArgs...)
	ts.split("work:0.0")
	ts.split("work:0.0")
	e.expose(ts, "work:0.0", "--write")
	e.expose(ts, "work:0.1", "--write")
	e.expose(ts, "work:0.2")
	return e, ts
}

func panesIn(ts *tmuxServer, window string) int {
	return len(strings.Fields(ts.must("list-panes", "-t", window, "-F", "#{pane_id}")))
}

// 112
func TestSec112_ClosingNeedsTheFlagAWriteGrantAndAWritablePane(t *testing.T) {
	e, ts := closeEnv(t)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	reader := e.token("reader", []string{host + "/*"}, nil)
	expect(t, e.post("", "/v1/panes/"+host+"/work/0.1/close", ""), http.StatusUnauthorized, "no token")
	expect(t, e.post(reader, "/v1/panes/"+host+"/work/0.1/close", ""), http.StatusForbidden, "read-only token")
	expect(t, e.post(full, "/v1/panes/"+host+"/work/0.2/close", ""), http.StatusForbidden, "read-only pane")
	expect(t, e.post(full, "/v1/panes/"+host+"/work/0.1/close", ""), http.StatusNotFound, "agent without --allow-close")
	expect(t, e.post(full, "/v1/panes/"+host+"/work/9.0/close", ""), http.StatusNotFound, "no such pane")
	expect(t, e.post(full, "/v1/panes/"+host+"/work/0.1/close", `{"force":true}`), http.StatusBadRequest, "a body")
	if n := panesIn(ts, "work:0"); n != 3 {
		t.Fatalf("%d panes left, want 3", n)
	}
	if r := e.get(full, "/v1/hosts"); strings.Contains(r.body, `"close"`) {
		t.Fatalf("hosts say close without the flag: %s", r.body)
	}
}

// 113
func TestFlow113_CloseAPaneOnItsHost(t *testing.T) {
	e, ts := closeEnv(t, "--allow-close")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	other := e.token("other", []string{host + "/*"}, []string{host + "/*"})
	if r := e.get(full, "/v1/hosts"); !strings.Contains(r.body, `"close":true`) {
		t.Fatalf("hosts: %s", r.body)
	}
	expect(t, e.post(full, "/v1/panes/"+host+"/work/0.2/close", ""), http.StatusForbidden, "read-only pane, flag or not")
	id := paneIDOf(ts, "work:0.1")
	expect(t, e.post(full, "/v1/panes/"+host+"/work/0.1/close", ""), http.StatusNoContent, "close")
	waitFor(t, "the pane gone", func() bool { return panesIn(ts, "work:0") == 2 })
	if strings.Contains(ts.must("list-panes", "-t", "work:0", "-F", "#{pane_id}"), id) {
		t.Fatal("the closed pane lives")
	}
	// One close per two seconds per principal; another principal has its own.
	ts.split("work:0.0")
	ts.split("work:0.0")
	e.expose(ts, "work", "--write")
	expect(t, e.post(full, "/v1/panes/"+host+"/work/0.1/close", ""), http.StatusTooManyRequests, "too soon")
	expect(t, e.post(other, "/v1/panes/"+host+"/work/0.1/close", ""), http.StatusNoContent, "another principal")
	for _, f := range []string{"hub.log", "agent-" + host + ".log"} {
		raw, _ := os.ReadFile(filepath.Join(e.logs, f))
		if !strings.Contains(string(raw), "close") || !strings.Contains(string(raw), id) {
			t.Fatalf("%s has no audit line for the close", f)
		}
	}
}
