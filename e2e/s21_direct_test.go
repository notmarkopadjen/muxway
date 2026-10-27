//go:build e2e

package e2e

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A key with a count: direct typing's held key as one request. The count
// goes with a key only, 1 to 50, and the audit line names it.

// 167
func TestSec167_ACountGoesWithAKeyOnlyWithinBounds(t *testing.T) {
	e, ts, _ := basic(t)
	out := keyEcho(t, ts)
	ts.split("work:0.0")
	e.expose(ts, "work:0.1")
	tok := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	reader := e.token("reader", []string{host + "/*"}, nil)
	for _, body := range []string{
		`{"key":"Down","count":0}`, `{"key":"Down","count":51}`, `{"key":"Down","count":-1}`,
		`{"key":"Down","count":2.5}`, `{"key":"Down","count":"5"}`,
		`{"text":"a","count":2}`, `{"text":"a","count":1}`, `{"mouse":{"button":"left","x":1,"y":1},"count":2}`,
		`{"count":2}`, `{"key":"C-;","count":2}`,
	} {
		r := e.post(tok, "/v1/panes/"+shell0+"/input", body)
		if r.status != http.StatusBadRequest {
			t.Fatalf("%s: %d %s", body, r.status, r.body)
		}
	}
	expect(t, e.input(reader, shell0, map[string]any{"key": "Down", "count": 2}), http.StatusForbidden, "read-only token")
	expect(t, e.input(tok, host+"/work/0.1", map[string]any{"key": "Down", "count": 2}), http.StatusForbidden, "read-only pane")
	if got := readKeys(out); got != "" {
		t.Fatalf("a refused key reached the pane: %q", got)
	}
}

// 168
func TestFlow168_ACountedKeyIsTypedThatManyTimesAndAudited(t *testing.T) {
	e, ts, _ := basic(t)
	out := keyEcho(t, ts)
	tok := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	for _, c := range []struct {
		count int
		want  string
	}{{1, `\x1b[B`}, {5, strings.Repeat(`\x1b[B`, 5)}, {50, strings.Repeat(`\x1b[B`, 50)}} {
		before := len(readKeys(out))
		expect(t, e.input(tok, shell0, map[string]any{"key": "Down", "count": c.count}), http.StatusNoContent, "counted")
		waitFor(t, "the keys", func() bool { return len(readKeys(out)) >= before+len(c.want) })
		if got := readKeys(out)[before:]; got != c.want {
			t.Fatalf("count %d reached the pane as %q", c.count, got)
		}
	}
	var hosts struct {
		Hosts []struct {
			Name   string `json:"name"`
			Keys   int    `json:"keys"`
			Repeat bool   `json:"repeat"`
		} `json:"hosts"`
	}
	r := e.get(tok, "/v1/hosts")
	if err := json.Unmarshal([]byte(r.body), &hosts); err != nil || len(hosts.Hosts) == 0 || !hosts.Hosts[0].Repeat || hosts.Hosts[0].Keys != 2 {
		t.Fatalf("hosts do not say repeat with keys 2: %v %s", err, r.body)
	}
	for _, f := range []string{"hub.log", "agent-" + host + ".log"} {
		raw, _ := os.ReadFile(filepath.Join(e.logs, f))
		if !strings.Contains(string(raw), "key=Down count=50") {
			t.Fatalf("%s has no audit line with the count", f)
		}
		if strings.Contains(string(raw), "count=1 ") {
			t.Fatalf("%s audits a count of one", f)
		}
	}
}
