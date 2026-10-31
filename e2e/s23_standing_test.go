//go:build e2e

package e2e

import (
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

// Standing marks: --expose <session>=<mode> on the agent marks a session of
// that name whenever it exists, once per session, in the open. And the
// listing says which pane is the last of its session.

func standingEnv(t *testing.T, args ...string) (*env, *tmuxServer, *agentProc) {
	e := newEnv(t)
	ts := newTmux(t)
	a := e.pairAgent(host, ts, args...)
	return e, ts, a
}

func (ts *tmuxServer) newSession(name string) {
	ts.must("new-session", "-d", "-s", name, shell())
	ts.title(name + ":0.0")
}

func (ts *tmuxServer) sessionMark(name string) string {
	out, _ := ts.run("show-options", "-t", name, "-qv", "@muxway-mode")
	return out
}

// listed waits until the token's listing names the pane, or stops naming it.
func (e *env) listed(tok, address string, want bool) resp {
	e.t.Helper()
	var r resp
	waitFor(e.t, address+" listed", func() bool {
		r = e.get(tok, "/v1/panes")
		return strings.Contains(r.body, `"address":"`+address+`"`) == want
	})
	return r
}

// 174
func TestSec174_BadStandingMarksRefuseToStart(t *testing.T) {
	e, ts, a := standingEnv(t)
	for _, v := range []string{"a;b=write", "work=admin", "work", strings.Repeat("a", 33) + "=write", "../x=read", "work=deny"} {
		_, err := e.cli("agent", "run", "--dir", a.dir, "--tmux-name", ts.name, "--expose", v)
		if err == nil || !strings.Contains(err.Error(), "--expose") {
			t.Fatalf("--expose %q: %v", v, err)
		}
	}
	if m := ts.sessionMark("work"); m != "" {
		t.Fatalf("work marked by a refused agent: %q", m)
	}
}

// 175
func TestSec175_OnlyTheNamedSessionGetsTheMark(t *testing.T) {
	e, ts, _ := standingEnv(t, "--expose", "work=write")
	ts.newSession("scratch")
	ts.newSession("work2")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	r := e.listed(full, host+"/work/0.0", true)
	for _, other := range []string{"scratch", "work2"} {
		if strings.Contains(r.body, `"session":"`+other+`"`) {
			t.Fatalf("%s listed without a mark: %s", other, r.body)
		}
		if m := ts.sessionMark(other); m != "" {
			t.Fatalf("%s marked: %q", other, m)
		}
	}
}

// 176
func TestSec176_TheMarkExposesTheGrantStillDecides(t *testing.T) {
	e, _, _ := standingEnv(t, "--expose", "work=write")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	e.listed(full, host+"/work/0.0", true)
	elsewhere := e.token("elsewhere", []string{host + "/other/*"}, []string{host + "/other/*"})
	if r := e.get(elsewhere, "/v1/panes"); strings.Contains(r.body, "work") {
		t.Fatalf("a grant on another session sees work: %s", r.body)
	}
	expect(t, e.input(elsewhere, host+"/work/0.0", map[string]any{"text": "echo hi"}), http.StatusNotFound, "write outside the grant")
	reader := e.token("reader", []string{host + "/*"}, nil)
	if r := e.listed(reader, host+"/work/0.0", true); !strings.Contains(r.body, `"mode":"read"`) {
		t.Fatalf("a reader sees the standing mark as writable: %s", r.body)
	}
	expect(t, e.input(reader, host+"/work/0.0", map[string]any{"text": "echo hi"}), http.StatusForbidden, "read-only token")
}

// 177
func TestSec177_StandingMarksAreAudited(t *testing.T) {
	e, ts, _ := standingEnv(t, "--expose", "work=write")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	ts.must("send-keys", "-t", "work:0.0", "echo standing-secret-on-screen", "Enter")
	e.listed(full, host+"/work/0.0", true)
	raw, _ := os.ReadFile(filepath.Join(e.logs, "agent-"+host+".log"))
	log := string(raw)
	line := regexp.MustCompile(`(?m)^.*standing mark set.*$`).FindString(log)
	if line == "" {
		t.Fatalf("no audit line for the standing mark:\n%s", log)
	}
	for _, want := range []string{"session=work", "session_id=$", "mode=write"} {
		if !strings.Contains(line, want) {
			t.Fatalf("audit line lacks %s: %s", want, line)
		}
	}
	if strings.Contains(log, "standing-secret-on-screen") {
		t.Fatal("the agent log carries pane content")
	}
}

// 178
func TestFlow178_ASessionStartedAfterTheAgentIsMarked(t *testing.T) {
	e, ts, _ := standingEnv(t, "--expose", "later=write")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	if r := e.get(full, "/v1/panes"); strings.Contains(r.body, "later") {
		t.Fatalf("later listed before it exists: %s", r.body)
	}
	ts.newSession("later")
	if r := e.listed(full, host+"/later/0.0", true); !strings.Contains(r.body, `"mode":"write"`) {
		t.Fatalf("later not writable: %s", r.body)
	}
	if m := ts.sessionMark("later"); m != "write" {
		t.Fatalf("mark on later: %q", m)
	}
	out := e.mustCLI("exposed", "--tmux-name", ts.name)
	if !regexp.MustCompile(`later/0\.0\s+write`).MatchString(out) {
		t.Fatalf("exposed does not list later: %s", out)
	}
	expect(t, e.input(full, host+"/later/0.0", map[string]string{"text": "echo marked"}), http.StatusNoContent, "typing into later")
}

// 179
func TestFlow179_ASessionStartedAgainIsMarkedAgain(t *testing.T) {
	e, ts, _ := standingEnv(t, "--expose", "work=write")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	sessionID := func(body string) string {
		m := regexp.MustCompile(`"session_id":"(\$\d+)"`).FindStringSubmatch(body)
		if m == nil {
			t.Fatalf("no session id: %s", body)
		}
		return m[1]
	}
	first := sessionID(e.listed(full, host+"/work/0.0", true).body)
	// The server lives on through another session: the new work has a new
	// id. The hub keeps a listing for a second, so the new one takes a moment.
	ts.newSession("keep")
	ts.must("kill-session", "-t", "work")
	ts.newSession("work")
	waitFor(t, "work listed anew", func() bool {
		body := e.get(full, "/v1/panes").body
		return strings.Contains(body, "work/0.0") && !strings.Contains(body, `"session_id":"`+first+`"`)
	})
	if m := ts.sessionMark("work"); m != "write" {
		t.Fatalf("mark on the new work: %q", m)
	}
	// The whole server restarts and hands out the same ids again.
	ts.must("kill-server")
	e.listed(full, host+"/work/0.0", false)
	ts.must("-f", "/dev/null", "new-session", "-d", "-s", "work", "-x", "100", "-y", "30", shell())
	ts.title("work:0.0")
	if id := sessionID(e.listed(full, host+"/work/0.0", true).body); id != first {
		t.Logf("the restarted server gave work %s, not %s", id, first)
	}
	if m := ts.sessionMark("work"); m != "write" {
		t.Fatalf("mark on work after the server restart: %q", m)
	}
}

// 180
func TestFlow180_UnexposeHoldsWhileTheSessionLives(t *testing.T) {
	e, ts, _ := standingEnv(t, "--expose", "work=write")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	e.listed(full, host+"/work/0.0", true)
	e.mustCLI("unexpose", "--tmux-name", ts.name, "-t", "work")
	e.listed(full, host+"/work/0.0", false)
	// Several more listings: the agent marks a session once.
	for i := 0; i < 3; i++ {
		time.Sleep(200 * time.Millisecond)
		if r := e.get(full, "/v1/panes"); strings.Contains(r.body, "work") {
			t.Fatalf("work marked again after unexpose: %s", r.body)
		}
	}
	if m := ts.sessionMark("work"); m != "" {
		t.Fatalf("mark after unexpose: %q", m)
	}
	ts.must("kill-session", "-t", "work")
	ts.newSession("work")
	e.listed(full, host+"/work/0.0", true)
}

// 181
func TestFlow181_ADenyInsideAStandingSessionWins(t *testing.T) {
	e, ts, _ := standingEnv(t, "--expose", "work=write")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	ts.split("work:0.0")
	e.expose(ts, "work:0.1", "--deny")
	r := e.listed(full, host+"/work/0.0", true)
	if strings.Contains(r.body, `"address":"`+host+`/work/0.1"`) {
		t.Fatalf("a denied pane listed: %s", r.body)
	}
	expect(t, e.input(full, host+"/work/0.1", map[string]any{"text": "x"}), http.StatusNotFound, "typing into a denied pane")
}

// 182
func TestFlow182_AStandingMarkCanBeReadOnly(t *testing.T) {
	e, ts, _ := standingEnv(t, "--expose", "work=read")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	if r := e.listed(full, host+"/work/0.0", true); !strings.Contains(r.body, `"mode":"read"`) {
		t.Fatalf("work not read-only: %s", r.body)
	}
	if m := ts.sessionMark("work"); m != "read" {
		t.Fatalf("mark on work: %q", m)
	}
	expect(t, e.input(full, host+"/work/0.0", map[string]any{"text": "x"}), http.StatusForbidden, "typing into a read-only mark")
}

// 183
func TestFlow183_TheLastPaneOfASessionSaysSo(t *testing.T) {
	e, ts, _ := standingEnv(t)
	e.expose(ts, "work:0.0", "--write")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	r := e.listed(full, host+"/work/0.0", true)
	if !strings.Contains(r.body, `"last":true`) {
		t.Fatalf("the only pane does not say last: %s", r.body)
	}
	// A second pane, unexposed, is still a pane of the session.
	ts.split("work:0.0")
	waitFor(t, "last gone", func() bool {
		r = e.get(full, "/v1/panes")
		return !strings.Contains(r.body, `"last"`)
	})
	if strings.Contains(r.body, "work/0.1") {
		t.Fatalf("the unexposed pane is listed: %s", r.body)
	}
	e.expose(ts, "work:0.1", "--write")
	if r = e.listed(full, host+"/work/0.1", true); strings.Contains(r.body, `"last"`) {
		t.Fatalf("two panes, one says last: %s", r.body)
	}
	if r = e.get(full, "/v1/hosts/"+host+"/tree"); strings.Contains(r.body, `"last"`) {
		t.Fatalf("the tree says last with two panes: %s", r.body)
	}
	ts.must("kill-pane", "-t", "work:0.1")
	waitFor(t, "last back", func() bool {
		return strings.Contains(e.get(full, "/v1/hosts/"+host+"/tree").body, `"last":true`)
	})
}
