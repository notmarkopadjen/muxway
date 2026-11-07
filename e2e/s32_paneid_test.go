//go:build e2e

package e2e

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"testing"
)

// paneIDAt is a pane's id as the JSON listing gives it for the address.
func (e *env) paneIDAt(tok, address string) string {
	e.t.Helper()
	r := e.get(tok, "/v1/panes")
	expect(e.t, r, http.StatusOK, "panes")
	var list struct {
		Panes []struct {
			Address string `json:"address"`
			PaneID  string `json:"pane_id"`
		} `json:"panes"`
	}
	json.Unmarshal([]byte(r.body), &list)
	for _, p := range list.Panes {
		if p.Address == address {
			return p.PaneID
		}
	}
	e.t.Fatalf("no pane at %s in %s", address, r.body)
	return ""
}

var paneIDCol = regexp.MustCompile(`^%[0-9]+$`)

// lastColumns is the last column of every row of a text listing.
func lastColumns(body string) []string {
	var out []string
	for _, line := range strings.Split(strings.TrimSuffix(body, "\n"), "\n") {
		f := strings.Split(line, "\t")
		out = append(out, f[len(f)-1])
	}
	return out
}

// 223: the id column names the token's own panes and no other host's.
func TestSec223_TextRowsEndInTheIdOfAPaneTheTokenReads(t *testing.T) {
	e, ts, a := basic(t)
	ts.split("work:0.0")
	e.expose(ts, "work:0.1", "--write")
	ts2 := newTmux(t)
	b := e.pairAgent("bob-desktop", ts2)
	e.expose(ts2, "work:0.0", "--write")
	alice := e.token("alice", []string{host + "/*"}, nil)
	full := e.token("full", []string{"*"}, []string{"*"})
	e.notify(a, "--pane", paneIDOf(ts, "work:0.0"), "--kind", "done", "--text", "alice done")
	e.notify(b, "--pane", paneIDOf(ts2, "work:0.0"), "--kind", "done", "--text", "bob done")
	waitFor(t, "both in the inbox", func() bool { return e.inbox(full).Count == 2 })
	bobID := paneIDOf(ts2, "work:0.0")
	for _, path := range []string{"/v1/panes", "/v1/inbox"} {
		r := e.getText(alice, path)
		expect(t, r, http.StatusOK, path)
		cols := lastColumns(r.body)
		if (path == "/v1/panes" && len(cols) != 2) || (path == "/v1/inbox" && len(cols) != 1) {
			t.Fatalf("%s for alice: %q", path, r.body)
		}
		for _, c := range cols {
			if !paneIDCol.MatchString(c) {
				t.Fatalf("%s: a row ends in %q, not a pane id: %q", path, c, r.body)
			}
		}
		// Bob's pane is a stranger to alice: its row is not there. Its id may coincide with one of
		// alice's own (each tmux server numbers from %0), so the check is on the host name.
		if strings.Contains(r.body, "bob-desktop") {
			t.Fatalf("%s for alice names bob's pane: %q", path, r.body)
		}
	}
	// The full token sees bob's row, with bob's id.
	r := e.getText(full, "/v1/panes")
	if !strings.Contains(r.body, "bob-desktop/work/0.0\t") || !strings.Contains(r.body, "\t"+bobID+"\n") {
		t.Fatalf("full listing: %q", r.body)
	}
	for _, c := range lastColumns(r.body) {
		if !paneIDCol.MatchString(c) {
			t.Fatalf("full listing: a row ends in %q: %q", c, r.body)
		}
	}
	r = e.getText(full, "/v1/inbox")
	if cols := lastColumns(r.body); len(cols) != 2 || !paneIDCol.MatchString(cols[0]) || !paneIDCol.MatchString(cols[1]) {
		t.Fatalf("full inbox: %q", r.body)
	}
}

// 224: a read that is refused carries no pane id, so addresses cannot be probed for ids.
func TestSec224_ARefusedReadCarriesNoPaneId(t *testing.T) {
	e, ts, a := basic(t)
	ts.split("work:0.0")
	e.expose(ts, "work:0.1", "--write")
	narrow := e.token("narrow", []string{shell0}, nil)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	for _, c := range []struct {
		tok, path, what string
		status          int
	}{
		{narrow, "/v1/panes/" + host + "/work/0.1", "outside the grant", http.StatusNotFound},
		{full, "/v1/panes/" + host + "/work/7.0", "no such pane", http.StatusNotFound},
		{"", "/v1/panes/" + shell0, "no token", http.StatusUnauthorized},
	} {
		for _, accept := range []string{"text/plain", ""} {
			r := e.do("GET", c.tok, c.path, accept, "")
			expect(t, r, c.status, c.what)
			if r.header.Get("Muxway-Pane") != "" {
				t.Fatalf("%s (%q): Muxway-Pane %q on a %d", c.what, accept, r.header.Get("Muxway-Pane"), r.status)
			}
		}
	}
	// A read the token may make carries it, in both modes, and the narrow token gets its own pane's.
	id0 := paneIDOf(ts, "work:0.0")
	for _, accept := range []string{"text/plain", ""} {
		r := e.do("GET", narrow, "/v1/panes/"+shell0, accept, "")
		expect(t, r, http.StatusOK, "own pane")
		if r.header.Get("Muxway-Pane") != id0 {
			t.Fatalf("own pane (%q): Muxway-Pane %q, want %s", accept, r.header.Get("Muxway-Pane"), id0)
		}
	}
	// An offline host: 503 and no id.
	a.cmd.Process.Kill()
	e.waitOnline(host, false)
	r := e.getText(full, "/v1/panes/"+shell0)
	expect(t, r, http.StatusServiceUnavailable, "offline")
	if r.header.Get("Muxway-Pane") != "" {
		t.Fatalf("offline: Muxway-Pane %q", r.header.Get("Muxway-Pane"))
	}
}

// 225: a page on another origin may read the header; the sign-in and agent endpoints expose nothing.
func TestSec225_MuxwayPaneIsExposedToOtherOrigins(t *testing.T) {
	e, ts, _ := basic(t)
	tok := e.token("glasses", []string{host + "/*"}, nil)
	r := e.do("GET", tok, "/v1/panes/"+shell0, "text/plain", "", "Origin", "null")
	expect(t, r, http.StatusOK, "read from another origin")
	if r.header.Get("Access-Control-Expose-Headers") != "ETag, Muxway-File, Muxway-Pane" || r.header.Get("Muxway-Pane") != paneIDOf(ts, "work:0.0") {
		t.Fatalf("exposed %q, pane %q", r.header.Get("Access-Control-Expose-Headers"), r.header.Get("Muxway-Pane"))
	}
	r = e.do("OPTIONS", "", "/v1/panes/"+shell0, "", "", "Origin", "null", "Access-Control-Request-Method", "GET")
	expect(t, r, http.StatusNoContent, "preflight")
	if r.header.Get("Access-Control-Expose-Headers") != "ETag, Muxway-File, Muxway-Pane" {
		t.Fatalf("preflight exposed %q", r.header.Get("Access-Control-Expose-Headers"))
	}
	for _, path := range []string{"/v1/auth/token", "/v1/agent"} {
		r = e.do("GET", "", path, "", "", "Origin", "null")
		if r.header.Get("Access-Control-Expose-Headers") != "" || r.header.Get("Access-Control-Allow-Origin") != "" {
			t.Fatalf("%s: CORS headers %q %q", path, r.header.Get("Access-Control-Expose-Headers"), r.header.Get("Access-Control-Allow-Origin"))
		}
	}
}

// 226: after a renumber the row and the read name the pane, not the position.
func TestFlow226_TheIdFollowsThePaneWhenTheHostRenumbers(t *testing.T) {
	e, ts, _ := basic(t)
	ts.split("work:0.0")
	ts.split("work:0.1")
	e.expose(ts, "work:0.1", "--write")
	e.expose(ts, "work:0.2", "--write")
	tok := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	id0, id1, id2 := paneIDOf(ts, "work:0.0"), paneIDOf(ts, "work:0.1"), paneIDOf(ts, "work:0.2")
	if id0 == id1 || id1 == id2 {
		t.Fatalf("ids %s %s %s", id0, id1, id2)
	}
	p1 := host + "/work/0.1"
	waitFor(t, "three panes listed", func() bool { return strings.Count(e.getText(tok, "/v1/panes").body, "\n") == 3 })
	if f := e.textRow(tok, p1); f[10] != id1 {
		t.Fatalf("row of work/0.1: %q, want %s last", f, id1)
	}
	// A read in each mode, and a cheap poll, say whose rows these are.
	r := e.getText(tok, "/v1/panes/"+p1)
	expect(t, r, http.StatusOK, "text read")
	if r.header.Get("Muxway-Pane") != id1 {
		t.Fatalf("text read: Muxway-Pane %q, want %s", r.header.Get("Muxway-Pane"), id1)
	}
	etag := r.header.Get("ETag")
	r = e.do("GET", tok, "/v1/panes/"+p1, "text/plain", "", "If-None-Match", etag)
	expect(t, r, http.StatusNotModified, "poll")
	if r.header.Get("Muxway-Pane") != id1 {
		t.Fatalf("304: Muxway-Pane %q, want %s", r.header.Get("Muxway-Pane"), id1)
	}
	if r = e.get(tok, "/v1/panes/"+p1); r.header.Get("Muxway-Pane") != id1 {
		t.Fatalf("JSON read: Muxway-Pane %q, want %s", r.header.Get("Muxway-Pane"), id1)
	}
	// The first pane closes: the host renumbers, and work/0.1 is now the pane that was work/0.2.
	ts.must("kill-pane", "-t", "work:0.0")
	waitFor(t, "two panes listed", func() bool { return strings.Count(e.getText(tok, "/v1/panes").body, "\n") == 2 })
	if f := e.textRow(tok, shell0); f[10] != id1 {
		t.Fatalf("row of work/0.0 after the renumber: %q, want %s last", f, id1)
	}
	if f := e.textRow(tok, p1); f[10] != id2 {
		t.Fatalf("row of work/0.1 after the renumber: %q, want %s last", f, id2)
	}
	// A client still polling the old address learns, on its next poll, that another pane answers.
	r = e.do("GET", tok, "/v1/panes/"+p1, "text/plain", "", "If-None-Match", etag)
	if r.status != http.StatusOK && r.status != http.StatusNotModified {
		t.Fatalf("poll after the renumber: %d %s", r.status, r.body)
	}
	if r.header.Get("Muxway-Pane") != id2 {
		t.Fatalf("poll after the renumber: Muxway-Pane %q, want %s", r.header.Get("Muxway-Pane"), id2)
	}
	if r = e.getText(tok, "/v1/panes/"+shell0); r.header.Get("Muxway-Pane") != id1 {
		t.Fatalf("the pane at its new address: Muxway-Pane %q, want %s", r.header.Get("Muxway-Pane"), id1)
	}
}
