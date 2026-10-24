//go:build e2e

package e2e

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// New panes and sessions from a client: a split where the token may type,
// a session where the agent allows it, nothing anywhere else.

func (e *env) split(tok, session, window, body string) resp {
	return e.post(tok, "/v1/windows/"+host+"/"+session+"/"+window+"/panes", body)
}

func (e *env) newSession(tok, body string) resp {
	return e.post(tok, "/v1/hosts/"+host+"/sessions", body)
}

func (ts *tmuxServer) paneCount(window string) int {
	out := ts.must("list-panes", "-t", window, "-F", "#{pane_id}")
	return len(strings.Fields(out))
}

func (ts *tmuxServer) sessions() string {
	out, _ := ts.run("list-sessions", "-F", "#{session_name}")
	return out
}

type madePane struct {
	Pane struct {
		Address string `json:"address"`
		PaneID  string `json:"pane_id"`
		Mode    string `json:"mode"`
		Session string `json:"session"`
	} `json:"pane"`
}

func made(t *testing.T, r resp) madePane {
	t.Helper()
	var v madePane
	if err := json.Unmarshal([]byte(r.body), &v); err != nil || v.Pane.PaneID == "" {
		t.Fatalf("no pane in the answer: %s", r.body)
	}
	return v
}

// 93
func TestSec93_ReadOnlyTokenMakesNothing(t *testing.T) {
	e, ts, _ := basicSessions(t)
	e.expose(ts, "work", "--write")
	// A refusal costs the creation slot like a success, so each try has a token.
	reader := func() string { return e.token("reader", []string{host + "/*"}, nil) }
	expect(t, e.split(reader(), "work", "0", `{"direction":"v"}`), http.StatusForbidden, "read-only split")
	expect(t, e.newSession(reader(), `{"name":"scratch"}`), http.StatusForbidden, "read-only session")
	// A write grant on another session does not reach this one.
	elsewhere := func() string { return e.token("elsewhere", []string{host + "/*"}, []string{host + "/other/*"}) }
	expect(t, e.newSession(elsewhere(), `{"name":"scratch"}`), http.StatusForbidden, "session outside the write grant")
	expect(t, e.split(elsewhere(), "work", "0", `{"direction":"v"}`), http.StatusForbidden, "split outside the write grant")
	time.Sleep(200 * time.Millisecond)
	if n := ts.paneCount("work:0"); n != 1 {
		t.Fatalf("panes in window 0: %d", n)
	}
	if s := ts.sessions(); s != "work" {
		t.Fatalf("sessions: %q", s)
	}
	for _, r := range []resp{e.split(reader(), "work", "0", `{"direction":"v"}`), e.newSession(reader(), `{"name":"scratch"}`)} {
		if strings.Contains(r.body, "%") || strings.Contains(r.body, "pane_id") {
			t.Fatalf("a refusal says more than its code: %s", r.body)
		}
	}
}

// 94
func TestSec94_OnePaneGrantGetsNoSibling(t *testing.T) {
	e, ts, _ := basic(t)
	e.expose(ts, "work", "--write")
	one := e.token("one", []string{host + "/work/0.0"}, []string{host + "/work/0.0"})
	expect(t, e.split(one, "work", "0", `{"direction":"h"}`), http.StatusForbidden, "sibling outside the grant")
	waitFor(t, "the undo", func() bool { return ts.paneCount("work:0") == 1 })
	logs, _ := os.ReadFile(filepath.Join(e.logs, "hub.log"))
	if !strings.Contains(string(logs), "audit split") || !strings.Contains(string(logs), "undone=true") {
		t.Fatalf("hub audit:\n%s", logs)
	}
	agentLog, _ := os.ReadFile(filepath.Join(e.logs, "agent-"+host+".log"))
	if !strings.Contains(string(agentLog), "op=kill-pane") || !strings.Contains(string(agentLog), "result=ok") {
		t.Fatalf("agent audit:\n%s", agentLog)
	}
	// The kill is the hub's undo alone; a client has nothing that closes a pane.
	for _, path := range []string{"/v1/panes/" + shell0, "/v1/windows/" + host + "/work/0/panes", "/v1/hosts/" + host + "/sessions/work"} {
		if r := e.do("DELETE", one, path, "", ""); r.status < 400 {
			t.Fatalf("DELETE %s: %d", path, r.status)
		}
	}
	if n := ts.paneCount("work:0"); n != 1 {
		t.Fatalf("panes in window 0: %d", n)
	}
}

// 95
func TestSec95_SessionsNeedTheAgentFlag(t *testing.T) {
	e, ts, _ := basic(t)
	tok := e.token("all", []string{"*"}, []string{"*"})
	r := e.get(tok, "/v1/hosts")
	expect(t, r, http.StatusOK, "hosts")
	if strings.Contains(r.body, "sessions") {
		t.Fatalf("a host without the flag says it starts sessions: %s", r.body)
	}
	expect(t, e.newSession(tok, `{"name":"scratch"}`), http.StatusNotFound, "no sessions without the flag")
	time.Sleep(200 * time.Millisecond)
	if s := ts.sessions(); s != "work" {
		t.Fatalf("sessions: %q", s)
	}
}

// 96
func TestSec96_SessionNamesAreNarrow(t *testing.T) {
	e, ts, _ := basicSessions(t)
	tok := e.token("all", []string{"*"}, []string{"*"})
	for _, body := range []string{`{"name":"a;b"}`, `{"name":"../x"}`, `{"name":"` + strings.Repeat("a", 33) + `"}`,
		`{"name":"Work"}`, `{"name":""}`, `{"name":"a b"}`, `{"name":"=work"}`, `{"name":"$1"}`, `{}`, `{"name":"ok","x":1}`, `nope`,
		`{"name":"a\u0000b"}`, `{"name":"ünï"}`} {
		r := e.newSession(tok, body)
		if r.status != http.StatusBadRequest {
			t.Fatalf("%s: %d %s", body, r.status, r.body)
		}
	}
	expect(t, e.newSession(tok, `{"name":"work"}`), http.StatusConflict, "an existing name")
	for _, body := range []string{`{"direction":"x"}`, `{}`, `{"direction":"h","n":1}`, `{"direction":1}`} {
		r := e.split(tok, "work", "0", body)
		if r.status != http.StatusBadRequest {
			t.Fatalf("split %s: %d %s", body, r.status, r.body)
		}
	}
	// Each refusal below costs the token's one creation per two seconds.
	expect(t, e.split(e.token("w", []string{"*"}, []string{"*"}), "work", "9", `{"direction":"h"}`), http.StatusNotFound, "no such window")
	expect(t, e.split(e.token("s", []string{"*"}, []string{"*"}), "nope", "0", `{"direction":"h"}`), http.StatusNotFound, "no such session")
	time.Sleep(200 * time.Millisecond)
	if s := ts.sessions(); s != "work" {
		t.Fatalf("sessions: %q", s)
	}
	if n := ts.paneCount("work:0"); n != 1 {
		t.Fatalf("panes in window 0: %d", n)
	}
}

// 97
func TestSec97_CapsAndRate(t *testing.T) {
	e, ts, _ := basicSessions(t)
	e.expose(ts, "work", "--write")
	// Room for eight panes: every split halves the window's active pane.
	ts.must("resize-window", "-t", "work:0", "-x", "200", "-y", "120")
	tok := e.token("all", []string{"*"}, []string{"*"})
	expect(t, e.split(tok, "work", "0", `{"direction":"v"}`), http.StatusCreated, "first split")
	expect(t, e.split(tok, "work", "0", `{"direction":"v"}`), http.StatusTooManyRequests, "a second within the second")
	expect(t, e.newSession(tok, `{"name":"scratch"}`), http.StatusTooManyRequests, "a session counts in the same rate")
	// The creation rate is per principal: the caps are reached with a token each.
	for i := 2; i <= 8; i++ {
		dir := []string{"h", "v"}[i%2]
		r := e.split(e.token(fmt.Sprintf("s%d", i), []string{"*"}, []string{"*"}), "work", "0", `{"direction":"`+dir+`"}`)
		if i == 8 {
			expect(t, r, http.StatusConflict, "the ninth pane")
			if !strings.Contains(r.body, "too_many") {
				t.Fatalf("ninth pane: %s", r.body)
			}
		} else {
			expect(t, r, http.StatusCreated, fmt.Sprintf("split %d", i))
		}
	}
	if n := ts.paneCount("work:0"); n != 8 {
		t.Fatalf("panes in window 0: %d", n)
	}
	for i := 1; i <= 33; i++ {
		r := e.newSession(e.token(fmt.Sprintf("n%d", i), []string{"*"}, []string{"*"}), fmt.Sprintf(`{"name":"s%d"}`, i))
		if i == 33 {
			expect(t, r, http.StatusConflict, "the 33rd session")
			if !strings.Contains(r.body, "too_many") {
				t.Fatalf("33rd session: %s", r.body)
			}
		} else {
			expect(t, r, http.StatusCreated, fmt.Sprintf("session %d", i))
		}
	}
	if n := len(strings.Fields(ts.sessions())); n != 33 {
		t.Fatalf("sessions: %d", n)
	}
	// Audited on both sides: who and what, never a pane's content.
	logs, _ := os.ReadFile(filepath.Join(e.logs, "hub.log"))
	for _, want := range []string{"audit split", "audit session", "name=s1 ", "result=ok", "result=too_many", "made=%"} {
		if !strings.Contains(string(logs), want) {
			t.Fatalf("hub audit lacks %q:\n%s", want, logs)
		}
	}
	agentLog, _ := os.ReadFile(filepath.Join(e.logs, "agent-"+host+".log"))
	for _, want := range []string{"op=split", "op=new-session", "direction=v", "name=s1 ", "made=%", "result=too_many"} {
		if !strings.Contains(string(agentLog), want) {
			t.Fatalf("agent audit lacks %q:\n%s", want, agentLog)
		}
	}
}

// 98
func TestCreate98_SplitInAWritableWindow(t *testing.T) {
	e, ts, _ := basicSessions(t)
	ts.must("set-option", "-u", "-p", "-t", "work:0.0", "@muxway-mode")
	e.expose(ts, "work:0", "--write")
	tok := e.token("all", []string{"*"}, []string{"*"})
	r := e.split(tok, "work", "0", `{"direction":"h"}`)
	expect(t, r, http.StatusCreated, "split")
	p := made(t, r)
	if p.Pane.Address != host+"/work/0.1" || p.Pane.Mode != "write" {
		t.Fatalf("new pane: %+v", p.Pane)
	}
	expect(t, e.get(tok, "/v1/panes/"+p.Pane.Address), http.StatusOK, "read the new pane")
	expect(t, e.input(tok, p.Pane.Address, map[string]string{"text": "echo made-here"}), http.StatusNoContent, "type into it")
	expect(t, e.input(tok, p.Pane.Address, map[string]string{"key": "Enter"}), http.StatusNoContent, "enter")
	waitFor(t, "the echo", func() bool { return strings.Contains(ts.capture(p.Pane.PaneID), "made-here") })
	// Beside: two panes side by side in a 100-column window.
	if w := ts.must("display-message", "-p", "-t", p.Pane.PaneID, "#{pane_width}"); w != "49" && w != "50" {
		t.Fatalf("the new pane is not beside the old: width %s", w)
	}
	// The window's focus at the host stays where it was.
	if active := ts.must("display-message", "-p", "-t", "work:0", "#{pane_id}"); active == p.Pane.PaneID {
		t.Fatalf("the split took the host's focus")
	}
	// A session: its pane is writable, listed, and marked in the open.
	r = e.newSession(e.token("two", []string{"*"}, []string{"*"}), `{"name":"scratch"}`)
	expect(t, r, http.StatusCreated, "session")
	s := made(t, r)
	if s.Pane.Session != "scratch" || s.Pane.Mode != "write" || s.Pane.Address != host+"/scratch/0.0" {
		t.Fatalf("session pane: %+v", s.Pane)
	}
	if exposed := e.mustCLI("exposed", "--tmux-name", ts.name); !listed(exposed, "scratch/0.0", "write") {
		t.Fatalf("exposed:\n%s", exposed)
	}
	waitFor(t, "the shell prompt", func() bool { return strings.Contains(ts.capture(s.Pane.PaneID), "$") })
}

// 99
func TestCreate99_SplitCarriesAPaneMark(t *testing.T) {
	e, ts, _ := basic(t) // the only mark is on the pane work:0.0
	tok := e.token("all", []string{"*"}, []string{"*"})
	r := e.split(tok, "work", "0", `{"direction":"v"}`)
	expect(t, r, http.StatusCreated, "split")
	p := made(t, r)
	if p.Pane.Mode != "write" {
		t.Fatalf("new pane: %+v", p.Pane)
	}
	if exposed := e.mustCLI("exposed", "--tmux-name", ts.name); !listed(exposed, "work/0.0", "write") || !listed(exposed, "work/0.1", "write") {
		t.Fatalf("exposed:\n%s", exposed)
	}
	if mark := ts.must("show-options", "-p", "-q", "-v", "-t", p.Pane.PaneID, "@muxway-mode"); mark != "write" {
		t.Fatalf("mark on the new pane: %q", mark)
	}
	// A read-only pane mark makes a read-only sibling, which a client may not split.
	ts.must("new-window", "-t", "work:1", shell())
	ts.title("work:1.0")
	e.expose(ts, "work:1.0")
	expect(t, e.split(e.token("b", []string{"*"}, []string{"*"}), "work", "1", `{"direction":"v"}`), http.StatusForbidden, "read-only pane")
}

// listed reports whether muxway exposed shows an address with a mode.
func listed(out, address, mode string) bool {
	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) >= 2 && f[0] == address && f[1] == mode {
			return true
		}
	}
	return false
}

// basicSessions is basic with an agent that starts sessions for clients.
func basicSessions(t *testing.T) (*env, *tmuxServer, *agentProc) {
	e := newEnv(t)
	ts := newTmux(t)
	a := e.pairAgent(host, ts, "--allow-sessions")
	e.expose(ts, "work:0.0", "--write")
	return e, ts, a
}
