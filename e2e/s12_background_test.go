//go:build e2e

package e2e

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Claude Code ends a turn with Stop even while work it started runs on in
// the background; the pane is still at work then, not done.

func (e *env) hook(a *agentProc, pane, payload string) {
	e.t.Helper()
	cmd := exec.Command(bin, "notify", "--from", "claude-code", "--dir", a.dir, "--pane", pane)
	cmd.Stdin = strings.NewReader(payload)
	if out, err := cmd.CombinedOutput(); err != nil {
		e.t.Fatalf("notify: %v %s", err, out)
	}
}

// 110
func TestFlow110_StopWithBackgroundWorkIsWorkingAndIdleWaits(t *testing.T) {
	e, ts, a := basic(t)
	tok := e.token("phone", []string{host + "/*"}, nil)
	pane := paneIDOf(ts, "work:0.0")
	last := func() (string, string) {
		ev := e.events(tok, "?limit=1").Events
		if len(ev) == 0 {
			return "", ""
		}
		return ev[0].Kind, ev[0].Text
	}
	steps := []struct {
		payload    string
		kind, text string
	}{
		{`{"hook_event_name":"UserPromptSubmit","prompt":"run the suite"}`, "working", ""},
		{`{"hook_event_name":"Stop","background_tasks":[{"id":"b1","type":"shell","status":"running","description":"e2e","command":"make e2e"}],"session_crons":[]}`,
			"working", "1 shell still running"},
		// Claude Code's idle notice while the shell runs is dropped: the last event stays.
		{`{"hook_event_name":"Notification","notification_type":"idle_prompt","message":"Claude is waiting for your input"}`,
			"working", "1 shell still running"},
		{`{"hook_event_name":"Stop","background_tasks":[],"session_crons":[]}`, "done", ""},
		{`{"hook_event_name":"Notification","notification_type":"idle_prompt","message":"Claude is waiting for your input"}`,
			"idle", "Claude is waiting for your input"},
		{`{"hook_event_name":"Stop","session_crons":[{"id":"c1","schedule":"*/5 * * * *","recurring":true,"prompt":"look again"}]}`,
			"done", "next wake scheduled"},
	}
	for i, s := range steps {
		e.hook(a, pane, s.payload)
		waitFor(t, fmt.Sprintf("event after step %d", i+1), func() bool {
			k, x := last()
			return k == s.kind && x == s.text
		})
	}
	var list struct {
		Panes []struct {
			Attention *struct{ Kind, Text string } `json:"attention"`
		} `json:"panes"`
	}
	r := e.get(tok, "/v1/panes")
	expect(t, r, 200, "panes")
	if err := json.Unmarshal([]byte(r.body), &list); err != nil {
		t.Fatal(err)
	}
	if a := list.Panes[0].Attention; a == nil || a.Kind != "done" || a.Text != "next wake scheduled" {
		t.Fatalf("attention: %+v", a)
	}
}

// 111
func TestSec111_BackgroundTaskDetailsNeverLeaveThePane(t *testing.T) {
	e, ts, a := basic(t)
	tok := e.token("phone", []string{host + "/*"}, nil)
	pane := paneIDOf(ts, "work:0.0")
	secret := "mxt_" + strings.Repeat("Q7", 20)
	remember(secret, "look-at-the-secret-plans")
	e.hook(a, pane, `{"hook_event_name":"Stop","background_tasks":[{"id":"b1","type":"shell","status":"running",`+
		`"description":"look-at-the-secret-plans","command":"TOKEN=`+secret+` make deploy"},`+
		`{"id":"b2","type":"\u001b]0;evil\u0007","status":"running","description":"x"}],`+
		`"session_crons":[{"id":"c1","schedule":"* * * * *","prompt":"look-at-the-secret-plans"}]}`)
	waitFor(t, "the working event", func() bool {
		ev := e.events(tok, "?limit=1").Events
		return len(ev) == 1 && ev[0].Kind == "working"
	})
	body := e.get(tok, "/v1/events").body + e.get(tok, "/v1/panes").body
	if !strings.Contains(body, "1 shell, 1 task still running") {
		t.Fatalf("text: %s", body)
	}
	for _, s := range []string{secret, "look-at-the-secret-plans", "make deploy", "evil"} {
		if strings.Contains(body, s) {
			t.Fatalf("%q reached a client", s)
		}
	}
	for _, f := range []string{filepath.Join(e.logs, "hub.log"), filepath.Join(e.logs, "agent-"+host+".log")} {
		raw, _ := os.ReadFile(f)
		if strings.Contains(string(raw), secret) || strings.Contains(string(raw), "look-at-the-secret-plans") {
			t.Fatalf("%s holds a task's details", f)
		}
	}
}
