//go:build e2e

package e2e

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/notmarkopadjen/muxway/internal/secure"
	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

// Notifications: muxway notify in a pane, attention on panes, GET /v1/events.

const hookText = "Claude needs your permission to use Bash NOTIFYTEXT7"

func paneIDOf(ts *tmuxServer, target string) string {
	return ts.must("display-message", "-p", "-t", target, "#{pane_id}")
}

func (e *env) notify(a *agentProc, args ...string) (string, error) {
	return e.cli(append([]string{"notify", "--dir", a.dir}, args...)...)
}

type eventsResp struct {
	Events []struct {
		Seq     uint64 `json:"seq"`
		At      int64  `json:"at"`
		Host    string `json:"host"`
		Address string `json:"address"`
		PaneID  string `json:"pane_id"`
		Alias   string `json:"alias"`
		Kind    string `json:"kind"`
		Text    string `json:"text"`
	} `json:"events"`
	Next uint64 `json:"next"`
}

func (e *env) events(tok, query string) eventsResp {
	e.t.Helper()
	r := e.get(tok, "/v1/events"+query)
	expect(e.t, r, http.StatusOK, "events"+query)
	var out eventsResp
	if err := json.Unmarshal([]byte(r.body), &out); err != nil {
		e.t.Fatalf("events: %v: %s", err, r.body)
	}
	return out
}

// attention returns the kind pending on an address in the token's listing.
func (e *env) attention(tok, address string) string {
	e.t.Helper()
	var list struct {
		Panes []struct {
			Address   string          `json:"address"`
			Attention *tmux.Attention `json:"attention"`
		} `json:"panes"`
	}
	r := e.get(tok, "/v1/panes")
	expect(e.t, r, http.StatusOK, "panes")
	json.Unmarshal([]byte(r.body), &list)
	for _, p := range list.Panes {
		if p.Address == address && p.Attention != nil {
			return p.Attention.Kind
		}
	}
	return ""
}

// 21
func TestSec21_EventsFollowReadGrants(t *testing.T) {
	e, ts, a := basic(t)
	ts.split("work:0.0")
	e.expose(ts, "work:0.1")
	ts2 := newTmux(t)
	b := e.pairAgent("bob-desktop", ts2)
	e.expose(ts2, "work:0.0")
	onePane := e.token("one-pane", []string{host + "/work/0.0"}, nil)
	aliceOnly := e.token("alice", []string{host + "/*"}, nil)
	all := e.token("all", []string{"*"}, nil)
	start := e.events(all, "").Next

	if _, err := e.notify(a, "--pane", paneIDOf(ts, "work:0.0"), "--kind", "question", "--text", "first pane"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.notify(a, "--pane", paneIDOf(ts, "work:0.1"), "--kind", "done", "--text", "second pane"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.notify(b, "--pane", paneIDOf(ts2, "work:0.0"), "--kind", "idle", "--text", "bob pane"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "three events", func() bool { return len(e.events(all, fmt.Sprintf("?after=%d", start)).Events) == 3 })

	got := e.events(onePane, fmt.Sprintf("?after=%d", start))
	if len(got.Events) != 1 || got.Events[0].Address != shell0 || got.Events[0].Text != "first pane" {
		t.Fatalf("one-pane token sees: %+v", got.Events)
	}
	if got.Next != start+3 {
		t.Fatalf("cursor did not advance past hidden events: %d, want %d", got.Next, start+3)
	}
	got = e.events(aliceOnly, fmt.Sprintf("?after=%d", start))
	if len(got.Events) != 2 {
		t.Fatalf("alice token sees: %+v", got.Events)
	}
	for _, ev := range got.Events {
		if ev.Host != host || strings.Contains(ev.Text, "bob") {
			t.Fatalf("alice token sees another host: %+v", ev)
		}
	}
	if e.attention(onePane, shell0) != "question" || e.attention(aliceOnly, host+"/work/0.1") != "done" {
		t.Fatal("attention missing from listings")
	}
	if strings.Contains(e.get(onePane, "/v1/panes").body, "second pane") {
		t.Fatal("attention text of a hidden pane leaked")
	}
	remember(hookText)
}

// 22
func TestSec22_NotifyForHiddenOrGonePaneStaysOnTheHost(t *testing.T) {
	e, ts, a := basic(t)
	ts.split("work:0.0") // work:0.1, not exposed
	tok := e.token("all", []string{"*"}, []string{"*"})
	start := e.events(tok, "").Next
	hidden := paneIDOf(ts, "work:0.1")
	ts.must("split-window", "-t", "work:0.0", shell())
	doomed := paneIDOf(ts, "work:0.2")
	e.expose(ts, "work:0.2")
	expect(t, e.get(tok, "/v1/panes/"+host+"/work/0.2"), http.StatusOK, "doomed readable")
	ts.must("kill-pane", "-t", doomed)
	for _, pane := range []string{hidden, doomed, "%999", "%0garbage", "0"} {
		out, err := e.notify(a, "--pane", pane, "--kind", "question", "--text", "should not leave")
		if err == nil {
			t.Fatalf("notify for %s accepted: %s", pane, out)
		}
	}
	time.Sleep(300 * time.Millisecond)
	if got := e.events(tok, fmt.Sprintf("?after=%d", start)); len(got.Events) != 0 {
		t.Fatalf("events leaked: %+v", got.Events)
	}
	if strings.Contains(e.get(tok, "/v1/panes").body, "attention") {
		t.Fatal("attention on a pane that should have none")
	}
	logs, _ := os.ReadFile(filepath.Join(e.logs, "agent-"+host+".log"))
	if strings.Count(string(logs), "notify refused") < 5 || strings.Contains(string(logs), "should not leave") {
		t.Fatalf("agent log:\n%s", logs)
	}
}

// 23
func TestSec23_HubValidatesAndRateLimitsAgentEvents(t *testing.T) {
	e, ts, a := basic(t)
	const mallory = "mallory-box"
	priv, hubPub := pairKey(t, e, mallory)
	c := dialAgent(t, e)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	sess, err := secure.AgentHandshake(ctx, wire.WS{C: c}, priv, mallory, hubPub)
	if err != nil {
		t.Fatal(err)
	}
	e.waitOnline(mallory, true)
	tok := e.token("mallory-reader", []string{mallory + "/*"}, nil)
	alice := e.token("alice-reader", []string{host + "/*"}, nil)
	start := e.events(tok, "").Next
	send := func(ev wire.Event) {
		raw, _ := json.Marshal(wire.Notice{Event: &ev})
		if err := sess.Write(ctx, raw); err != nil {
			t.Fatal(err)
		}
	}
	good := tmux.Pane{SessionName: "work", WindowIndex: 0, WindowName: "shell", PaneID: "%1", Mode: tmux.ModeRead,
		Title: "test-pane", Command: "bash"}
	bad := []wire.Event{
		{Pane: good, Kind: "exec", Text: "x"},
		{Pane: good, Kind: wire.KindDone, Text: "a\x1bb"},
		{Pane: good, Kind: wire.KindDone, Text: strings.Repeat("a", 10<<10)},
		{Pane: good, Kind: wire.KindDone, Text: " leading"},
		{Kind: wire.KindDone},
	}
	for _, p := range []func(*tmux.Pane){
		func(p *tmux.Pane) { p.PaneID = "abc" },
		func(p *tmux.Pane) { p.PaneID = "%1; rm" },
		func(p *tmux.Pane) { p.Mode = "" },
		func(p *tmux.Pane) { p.Mode = tmux.ModeDeny },
		func(p *tmux.Pane) { p.SessionName = "wo\x07rk" },
		func(p *tmux.Pane) { p.WindowName = "s\tplit" },
		func(p *tmux.Pane) { p.Alias = "Bad Alias" },
		func(p *tmux.Pane) { p.PaneIndex = -1 },
	} {
		ev := wire.Event{Pane: good, Kind: wire.KindDone, Text: "ok"}
		p(&ev.Pane)
		bad = append(bad, ev)
	}
	for _, ev := range bad {
		send(ev)
	}
	send(wire.Event{Pane: good, Kind: wire.KindQuestion, Text: "the one valid event"})
	waitFor(t, "valid event", func() bool { return len(e.events(tok, fmt.Sprintf("?after=%d", start)).Events) >= 1 })
	got := e.events(tok, fmt.Sprintf("?after=%d", start))
	if len(got.Events) != 1 || got.Events[0].Text != "the one valid event" || got.Events[0].Host != mallory {
		t.Fatalf("after %d invalid events the hub kept: %+v", len(bad), got.Events)
	}
	// A flood: the burst gets through, the rest is dropped, the hub stays up.
	for i := 0; i < 300; i++ {
		send(wire.Event{Pane: good, Kind: wire.KindDone, Text: fmt.Sprintf("flood %d", i)})
	}
	send(wire.Event{Pane: good, Kind: wire.KindIdle, Text: "after the flood"})
	time.Sleep(500 * time.Millisecond)
	got = e.events(tok, fmt.Sprintf("?after=%d&limit=100", start))
	if n := len(got.Events); n < 20 || n > 40 {
		t.Fatalf("flood: %d events kept, want about the burst size", n)
	}
	for _, ev := range got.Events {
		if ev.Text == "after the flood" {
			t.Fatal("event after the flood was not rate limited")
		}
	}
	// Other hosts are unaffected.
	if _, err := e.notify(a, "--pane", paneIDOf(ts, "work:0.0"), "--kind", "done", "--text", "alice fine"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "alice event", func() bool {
		evs := e.events(alice, fmt.Sprintf("?after=%d", start)).Events
		return len(evs) == 1 && evs[0].Text == "alice fine"
	})
	logs, _ := os.ReadFile(filepath.Join(e.logs, "hub.log"))
	if strings.Count(string(logs), "event refused") != len(bad) || !strings.Contains(string(logs), "over the rate limit") ||
		strings.Contains(string(logs), "the one valid event") {
		t.Fatalf("hub log:\n%s", logs)
	}
}

// 24
func TestSec24_EventParametersAreChecked(t *testing.T) {
	e, _, _ := basic(t)
	tok := e.token("reader", []string{host + "/*"}, nil)
	for _, q := range []string{"?after=-1", "?after=abc", "?after=99999999999999999999", "?wait=31", "?wait=-1",
		"?wait=x", "?limit=0", "?limit=101", "?limit=abc"} {
		r := e.get(tok, "/v1/events"+q)
		if r.status != http.StatusBadRequest || !strings.Contains(r.body, "bad_parameter") {
			t.Fatalf("%s: %d %s", q, r.status, r.body)
		}
	}
	for _, q := range []string{"", "?after=0", "?after=18446744073709551615", "?wait=0&limit=1"} {
		expect(t, e.get(tok, "/v1/events"+q), http.StatusOK, q)
	}
}

// 25
func TestSec25_NotifyRefusesBadKindsAndSanitisesText(t *testing.T) {
	e, ts, a := basic(t)
	tok := e.token("reader", []string{host + "/*"}, nil)
	pane := paneIDOf(ts, "work:0.0")
	for _, args := range [][]string{
		{"--pane", pane, "--kind", "exec"},
		{"--pane", pane, "--kind", "Question"},
		{"--pane", pane},
		{"--pane", pane, "--kind", "done", "--from", "slack"},
	} {
		if out, err := e.notify(a, args...); err == nil {
			t.Fatalf("notify %v accepted: %s", args, out)
		}
	}
	cmd := exec.Command(bin, "notify", "--dir", a.dir, "--kind", "done")
	cmd.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + e.dir}
	if out, err := cmd.CombinedOutput(); err == nil || !strings.Contains(string(out), "not inside tmux") {
		t.Fatalf("no pane: %v %s", err, out)
	}
	start := e.events(tok, "").Next
	long := strings.Repeat("x", 500)
	if _, err := e.notify(a, "--pane", pane, "--kind", "done", "--text", "a\x1b[2Jb\tc\r\n  d "+long); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "event", func() bool { return len(e.events(tok, fmt.Sprintf("?after=%d", start)).Events) == 1 })
	text := e.events(tok, fmt.Sprintf("?after=%d", start)).Events[0].Text
	if !strings.HasPrefix(text, "a [2Jb c d xxx") || len([]rune(text)) != wire.MaxEventText {
		t.Fatalf("text not sanitised: %q", text)
	}
	for _, r := range text {
		if r < 0x20 || r == 0x7f {
			t.Fatalf("control character survived: %q", text)
		}
	}
	line := e.getText(tok, fmt.Sprintf("/v1/events?after=%d", start)).body
	if strings.Count(line, "\n") != 2 {
		t.Fatalf("text mode broken by the text: %q", line)
	}
}

// --- flows ----------------------------------------------------------------------

// shellKeepingPane is shell() with TMUX_PANE kept, as a real pane has it.
func shellKeepingPane() string {
	return strings.Replace(shell(), "env -i ", "env -i TMUX_PANE=\"$TMUX_PANE\" ", 1)
}

// 26
func TestFlow26_ClaudeCodeHooksTypedInThePane(t *testing.T) {
	e, ts, a := basic(t)
	ts.must("new-window", "-t", "work:1", "-n", "claude", shellKeepingPane())
	ts.title("work:1.0")
	e.expose(ts, "work:1.0", "--write", "--name", "claude")
	tok := e.token("phone", []string{host + "/*"}, []string{host + "/*"})
	start := e.events(tok, "").Next
	addr := host + "/work/1.0"
	hook := func(payload string) {
		ts.must("send-keys", "-t", "work:1.0", "-l", "printf '%s' '"+payload+"' | "+bin+" notify --from claude-code --dir "+a.dir)
		ts.must("send-keys", "-t", "work:1.0", "Enter")
	}
	hook(`{"session_id":"test","cwd":"/tmp/project","hook_event_name":"Notification","notification_type":"permission_prompt","message":"` + hookText + `"}`)
	waitFor(t, "permission event", func() bool { return len(e.events(tok, fmt.Sprintf("?after=%d", start)).Events) == 1 })
	got := e.events(tok, fmt.Sprintf("?after=%d", start))
	ev := got.Events[0]
	if ev.Kind != "permission" || ev.Address != addr || ev.Alias != "claude" || ev.Text != hookText || ev.Host != host || ev.At == 0 {
		t.Fatalf("event: %+v", ev)
	}
	if e.attention(tok, addr) != "permission" {
		t.Fatal("no attention on the pane")
	}
	text := e.getText(tok, "/v1/panes").body
	if !strings.Contains(text, addr+"\twrite\tbash\ttest-pane\tpermission\n") {
		t.Fatalf("text listing: %q", text)
	}
	hook(`{"session_id":"test","cwd":"/tmp/project","hook_event_name":"Notification","notification_type":"auth_success","message":"ignored"}`)
	hook(`{"session_id":"test","cwd":"/tmp/project","hook_event_name":"Stop","stop_hook_active":false}`)
	waitFor(t, "done", func() bool { return e.attention(tok, addr) == "done" })
	hook(`{"session_id":"test","cwd":"/tmp/project","hook_event_name":"UserPromptSubmit","prompt":"go on"}`)
	waitFor(t, "cleared", func() bool { return e.attention(tok, addr) == "" })
	got = e.events(tok, fmt.Sprintf("?after=%d", start))
	var kinds []string
	for _, ev := range got.Events {
		kinds = append(kinds, ev.Kind)
	}
	if strings.Join(kinds, ",") != "permission,done,working" {
		t.Fatalf("kinds: %v", kinds)
	}
	// A hook for an unknown pane, or with the agent away, exits 0 and says why on stderr.
	cmd := exec.Command(bin, "notify", "--from", "claude-code", "--dir", filepath.Join(e.dir, "nowhere"))
	cmd.Stdin = strings.NewReader(`{"hook_event_name":"Stop"}`)
	cmd.Env = []string{"PATH=" + os.Getenv("PATH"), "TMUX_PANE=%1"}
	if out, err := cmd.CombinedOutput(); err != nil || !strings.Contains(string(out), "no agent running") {
		t.Fatalf("hook without agent: %v %s", err, out)
	}
	snippet := e.mustCLI("hooks", "claude-code")
	if !strings.Contains(snippet, `"Notification"`) || !strings.Contains(snippet, "notify --from claude-code") {
		t.Fatalf("hooks snippet: %s", snippet)
	}
}

// 27
func TestFlow27_LongPollAndTextMode(t *testing.T) {
	e, ts, a := basic(t)
	tok := e.token("phone", []string{host + "/*"}, nil)
	pane := paneIDOf(ts, "work:0.0")
	if _, err := e.notify(a, "--pane", pane, "--kind", "done", "--text", "older"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "older event", func() bool { return len(e.events(tok, "").Events) == 1 })
	cursor := e.events(tok, "").Next
	type outcome struct {
		got  eventsResp
		took time.Duration
	}
	ch := make(chan outcome, 1)
	go func() {
		start := time.Now()
		got := e.events(tok, fmt.Sprintf("?after=%d&wait=10", cursor))
		ch <- outcome{got, time.Since(start)}
	}()
	time.Sleep(time.Second)
	if _, err := e.notify(a, "--pane", pane, "--kind", "question", "--text", "newer"); err != nil {
		t.Fatal(err)
	}
	select {
	case o := <-ch:
		if len(o.got.Events) != 1 || o.got.Events[0].Text != "newer" || o.took > 3*time.Second || o.took < 900*time.Millisecond {
			t.Fatalf("long poll: %+v after %s", o.got, o.took)
		}
		t.Logf("long poll answered after %s", o.took.Round(time.Millisecond))
	case <-time.After(12 * time.Second):
		t.Fatal("long poll never answered")
	}
	start := time.Now()
	empty := e.events(tok, fmt.Sprintf("?after=%d&wait=1", cursor+1))
	if len(empty.Events) != 0 || empty.Next != cursor+1 || time.Since(start) < 900*time.Millisecond {
		t.Fatalf("empty wait: %+v after %s", empty, time.Since(start))
	}
	text := e.getText(tok, "/v1/events").body
	lines := strings.Split(strings.TrimRight(text, "\n"), "\n")
	if len(lines) != 3 || !strings.HasSuffix(lines[0], "\t"+shell0+"\tdone\tolder") ||
		!strings.HasSuffix(lines[1], "\t"+shell0+"\tquestion\tnewer") || lines[2] != fmt.Sprintf("next\t%d", cursor+1) {
		t.Fatalf("text mode:\n%s", text)
	}
	if one := e.events(tok, "?limit=1"); len(one.Events) != 1 || one.Events[0].Text != "newer" {
		t.Fatalf("limit without cursor: %+v", one)
	}
}

// 28
func TestFlow28_InputClearsAttentionAndNewestKindWins(t *testing.T) {
	e, ts, a := basic(t)
	tok := e.token("phone", []string{host + "/*"}, []string{host + "/*"})
	pane := paneIDOf(ts, "work:0.0")
	if _, err := e.notify(a, "--pane", pane, "--kind", "question"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "question", func() bool { return e.attention(tok, shell0) == "question" })
	expect(t, e.input(tok, shell0, map[string]string{"text": "y"}), http.StatusNoContent, "answer")
	if e.attention(tok, shell0) != "" {
		t.Fatal("input did not clear attention")
	}
	if _, err := e.notify(a, "--pane", pane, "--kind", "permission"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.notify(a, "--pane", pane, "--kind", "done"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "done", func() bool { return e.attention(tok, shell0) == "done" })
	r := e.get(tok, "/v1/panes/"+shell0)
	if !strings.Contains(r.body, `"attention":{"kind":"done"`) {
		t.Fatalf("read does not carry attention: %s", r.body)
	}
}

// 29
func TestFlow29_AttentionSurvivesHubRestartAndDiesWithThePane(t *testing.T) {
	e, ts, a := basic(t)
	e.expose(ts, "work", "--write")
	ts.split("work:0.0")
	tok := e.token("phone", []string{host + "/*"}, nil)
	first, second := paneIDOf(ts, "work:0.0"), paneIDOf(ts, "work:0.1")
	for _, p := range []string{first, second} {
		if _, err := e.notify(a, "--pane", p, "--kind", "idle"); err != nil {
			t.Fatal(err)
		}
	}
	waitFor(t, "both idle", func() bool {
		return e.attention(tok, shell0) == "idle" && e.attention(tok, host+"/work/0.1") == "idle"
	})
	e.stopHub()
	e.startHub()
	e.waitOnline(host, true)
	if e.attention(tok, shell0) != "idle" || e.attention(tok, host+"/work/0.1") != "idle" {
		t.Fatal("attention lost over a hub restart")
	}
	ts.must("kill-pane", "-t", second)
	waitFor(t, "pane gone", func() bool { return !strings.Contains(e.get(tok, "/v1/panes").body, "work/0.1") })
	if e.attention(tok, shell0) != "idle" {
		t.Fatal("attention on the surviving pane lost")
	}
	logs, _ := os.ReadFile(filepath.Join(e.logs, "agent-"+host+".log"))
	if !strings.Contains(string(logs), "notify") {
		t.Fatal("notifications missing from the agent log")
	}
}
