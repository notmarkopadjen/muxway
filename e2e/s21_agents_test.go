//go:build e2e

package e2e

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Agent orchestration: questions with fixed answers, the inbox, the
// watcher, the command-line client and the MCP server.

// askProc is one muxway ask in flight, with what it printed and how it ended.
type askProc struct {
	cmd  *exec.Cmd
	out  bytes.Buffer
	done chan struct{}
	err  error
}

func (e *env) ask(a *agentProc, pane string, timeout string, text string, choices ...string) *askProc {
	e.t.Helper()
	args := []string{"ask", "--dir", a.dir, "--pane", pane, "--text", text, "--timeout", timeout}
	for _, c := range choices {
		args = append(args, "--choice", c)
	}
	p := &askProc{cmd: exec.Command(bin, args...), done: make(chan struct{})}
	p.cmd.Stdout = &p.out
	p.cmd.Stderr = e.logFile("ask")
	if err := p.cmd.Start(); err != nil {
		e.t.Fatal(err)
	}
	go func() { p.err = p.cmd.Wait(); close(p.done) }()
	return p
}

// wait returns the exit code and stdout once the ask ended, or -1.
func (p *askProc) wait(t *testing.T, within time.Duration) (int, string) {
	t.Helper()
	select {
	case <-p.done:
	case <-time.After(within):
		p.cmd.Process.Kill()
		return -1, p.out.String()
	}
	code := 0
	if p.err != nil {
		if ee, ok := p.err.(*exec.ExitError); ok {
			code = ee.ExitCode()
		} else {
			code = 1
		}
	}
	return code, strings.TrimSpace(p.out.String())
}

func (e *env) answer(tok, address, choice string) resp {
	return e.post(tok, "/v1/panes/"+address+"/answer", fmt.Sprintf(`{"choice":%q}`, choice))
}

type inboxResp struct {
	Inbox []struct {
		Address   string `json:"address"`
		Mode      string `json:"mode"`
		Attention struct {
			Kind    string   `json:"kind"`
			At      int64    `json:"at"`
			Text    string   `json:"text"`
			Choices []string `json:"choices"`
		} `json:"attention"`
	} `json:"inbox"`
	Count int `json:"count"`
}

func (e *env) inbox(tok string) inboxResp {
	e.t.Helper()
	r := e.get(tok, "/v1/inbox")
	expect(e.t, r, http.StatusOK, "inbox")
	var out inboxResp
	if err := json.Unmarshal([]byte(r.body), &out); err != nil {
		e.t.Fatalf("inbox: %v: %s", err, r.body)
	}
	return out
}

// 24
func TestSec24_AnswerNeedsAWriteGrantAndAQuestion(t *testing.T) {
	e, ts, a := basic(t)
	// Each split of the first pane lands at index 1 and pushes the rest
	// along, so the marks go on once the panes are all there.
	ts.split("work:0.0")
	ts.split("work:0.0")
	ts.split("work:0.0")
	e.expose(ts, "work:0.2", "--write") // exposed, no question; work:0.1 stays hidden
	e.expose(ts, "work:0.3")            // read-only
	full := e.token("full", []string{"*"}, []string{"*"})
	reader := e.token("reader", []string{"*"}, nil)
	other := e.token("other", []string{host + "/*"}, []string{host + "/work/0.2"})
	start := e.events(full, "").Next

	// A hidden pane and a read-only pane take no question.
	for _, target := range []string{"work:0.1", "work:0.3"} {
		p := e.ask(a, paneIDOf(ts, target), "30s", "hidden?", "yes", "no")
		if code, out := p.wait(t, 10*time.Second); code != 1 || out != "" {
			t.Fatalf("ask on %s: exit %d %q", target, code, out)
		}
	}
	// Bad choices never leave the command.
	for _, cs := range [][]string{{"yes"}, {"a", "b", "c", "d", "e", "f", "g", "h", "i"}, {strings.Repeat("x", 41), "y"}, {"a|b", "c"}, {"a\x1bb", "c"}, {"yes", "yes"}} {
		p := e.ask(a, paneIDOf(ts, "work:0.0"), "30s", "bad?", cs...)
		if code, _ := p.wait(t, 10*time.Second); code != 1 {
			t.Fatalf("ask with %q: exit %d", cs, code)
		}
	}
	if got := e.events(full, fmt.Sprintf("?after=%d", start)); len(got.Events) != 0 {
		t.Fatalf("refused asks made events: %+v", got.Events)
	}

	// A question on the writable pane.
	p := e.ask(a, paneIDOf(ts, "work:0.0"), "60s", "deploy to staging? askcanary7", "yes", "no", "later")
	waitFor(t, "the question in the listing", func() bool { return e.attention(full, shell0) == "question" })
	got := e.events(full, fmt.Sprintf("?after=%d", start))
	if len(got.Events) != 1 || got.Events[0].Kind != "question" || !strings.Contains(e.get(full, "/v1/events?after="+fmt.Sprint(start)).body, `"choices":["yes","no","later"]`) {
		t.Fatalf("question event: %+v", got.Events)
	}
	inbox := e.inbox(full)
	if inbox.Count != 1 || inbox.Inbox[0].Address != shell0 || strings.Join(inbox.Inbox[0].Attention.Choices, ",") != "yes,no,later" {
		t.Fatalf("inbox: %+v", inbox)
	}
	if e.inbox(other).Count != 1 || e.inbox(e.token("none", []string{host + "/work/0.2"}, nil)).Count != 0 {
		t.Fatal("the inbox does not follow read grants")
	}

	// Answers that must not reach the asker.
	expect(t, e.answer(reader, shell0, "yes"), http.StatusForbidden, "read-only token answers")
	expect(t, e.answer(other, shell0, "yes"), http.StatusForbidden, "a write grant elsewhere answers")
	expect(t, e.answer(full, host+"/work/0.3", "yes"), http.StatusForbidden, "answer on a read-only pane")
	expect(t, e.answer(full, host+"/work/0.1", "yes"), http.StatusNotFound, "answer on a hidden pane")
	expect(t, e.answer(full, host+"/work/0.2", "yes"), http.StatusConflict, "answer where nothing waits")
	expect(t, e.answer(full, shell0, "maybe"), http.StatusBadRequest, "a choice not offered")
	expect(t, e.answer(full, shell0, "a|b"), http.StatusBadRequest, "a choice with the separator")
	expect(t, e.answer(full, shell0, strings.Repeat("y", 41)), http.StatusBadRequest, "a long choice")
	expect(t, e.answer(full, shell0, ""), http.StatusBadRequest, "an empty choice")
	expect(t, e.post(full, "/v1/panes/"+shell0+"/answer", `{"choice":"yes","text":"x"}`), http.StatusBadRequest, "an extra field")
	expect(t, e.post(full, "/v1/panes/"+shell0+"/answer", `{"choice":"yes"} junk`), http.StatusBadRequest, "trailing junk")
	select {
	case <-p.done:
		t.Fatalf("the ask ended early: %q", p.out.String())
	default:
	}
	if e.attention(full, shell0) != "question" {
		t.Fatal("a refused answer cleared the question")
	}

	// The right answer, once.
	expect(t, e.answer(full, shell0, "later"), http.StatusNoContent, "answer")
	if code, out := p.wait(t, 10*time.Second); code != 0 || out != "later" {
		t.Fatalf("ask: exit %d %q", code, out)
	}
	waitFor(t, "attention cleared", func() bool { return e.attention(full, shell0) == "" })
	expect(t, e.answer(full, shell0, "later"), http.StatusConflict, "a second answer")

	// The question's text and the token never reach the hub's log; the
	// audit lines carry sizes.
	hubLog, _ := os.ReadFile(filepath.Join(e.logs, "hub.log"))
	agentLog, _ := os.ReadFile(filepath.Join(e.logs, "agent-"+host+".log"))
	for _, l := range [][]byte{hubLog, agentLog} {
		if bytes.Contains(l, []byte("askcanary7")) || bytes.Contains(l, []byte("deploy to staging")) {
			t.Fatal("the question's text is in a log")
		}
	}
	if !bytes.Contains(hubLog, []byte("audit answer")) || !bytes.Contains(hubLog, []byte("choice_bytes=5")) || !bytes.Contains(hubLog, []byte("result=read_only")) {
		t.Fatalf("hub audit:\n%s", hubLog)
	}
	if !bytes.Contains(agentLog, []byte("op=answer")) || !bytes.Contains(agentLog, []byte("result=no_question")) {
		t.Fatalf("agent audit:\n%s", agentLog)
	}
}

// 25
func TestAskEndsWithTheTimeoutOrTheOwnersTyping(t *testing.T) {
	e, ts, a := basic(t)
	full := e.token("full", []string{"*"}, []string{"*"})
	pane := paneIDOf(ts, "work:0.0")

	// Nobody answers: exit 2, and the question is gone from the listing.
	p := e.ask(a, pane, "2s", "anyone?", "yes", "no")
	waitFor(t, "the question", func() bool { return e.attention(full, shell0) == "question" })
	if code, out := p.wait(t, 10*time.Second); code != 2 || out != "" {
		t.Fatalf("timed-out ask: exit %d %q", code, out)
	}
	waitFor(t, "attention cleared by the timeout", func() bool { return e.attention(full, shell0) == "" })

	// The owner types into the pane instead: exit 3.
	p = e.ask(a, pane, "60s", "typed?", "yes", "no")
	waitFor(t, "the question", func() bool { return e.attention(full, shell0) == "question" })
	expect(t, e.input(full, shell0, map[string]string{"text": "echo answered in the pane"}), http.StatusNoContent, "input")
	if code, _ := p.wait(t, 10*time.Second); code != 3 {
		t.Fatalf("typed-over ask: exit %d", code)
	}
	// The program went on (a working notification): exit 3 as well.
	p = e.ask(a, pane, "60s", "moved on?", "yes", "no")
	waitFor(t, "the question", func() bool { return e.attention(full, shell0) == "question" })
	if _, err := e.notify(a, "--pane", pane, "--kind", "working"); err != nil {
		t.Fatal(err)
	}
	if code, _ := p.wait(t, 10*time.Second); code != 3 {
		t.Fatalf("ask after working: exit %d", code)
	}
	// A second ask on the pane ends the first.
	p1 := e.ask(a, pane, "60s", "first?", "yes", "no")
	waitFor(t, "the first question", func() bool { return e.attention(full, shell0) == "question" })
	p2 := e.ask(a, pane, "60s", "second?", "a", "b")
	if code, _ := p1.wait(t, 10*time.Second); code != 3 {
		t.Fatalf("replaced ask: exit %d", code)
	}
	waitFor(t, "the second question's choices", func() bool {
		in := e.inbox(full)
		return in.Count == 1 && strings.Join(in.Inbox[0].Attention.Choices, ",") == "a,b"
	})
	expect(t, e.answer(full, shell0, "yes"), http.StatusBadRequest, "the first question's choice")
	expect(t, e.answer(full, shell0, "b"), http.StatusNoContent, "the second question's choice")
	if code, out := p2.wait(t, 10*time.Second); code != 0 || out != "b" {
		t.Fatalf("second ask: exit %d %q", code, out)
	}
	// The asker gives up: the question goes with it.
	p = e.ask(a, pane, "60s", "gone?", "yes", "no")
	waitFor(t, "the question", func() bool { return e.attention(full, shell0) == "question" })
	p.cmd.Process.Kill()
	<-p.done
	waitFor(t, "no question after the asker died", func() bool {
		return e.answer(full, shell0, "yes").status == http.StatusConflict
	})
}

// 26
func TestInboxListsWhatWaitsOldestFirst(t *testing.T) {
	e, ts, a := basic(t)
	ts.split("work:0.0")
	e.expose(ts, "work:0.1")
	ts2 := newTmux(t)
	b := e.pairAgent("bob-desktop", ts2)
	e.expose(ts2, "work:0.0", "--write")
	full := e.token("full", []string{"*"}, []string{"*"})
	alice := e.token("alice", []string{host + "/*"}, nil)
	if e.inbox(full).Count != 0 {
		t.Fatal("an empty inbox is not empty")
	}
	if r := e.get(full, "/v1/inbox"); !strings.Contains(r.body, `"inbox":[]`) {
		t.Fatalf("empty inbox body: %s", r.body)
	}
	e.notify(b, "--pane", paneIDOf(ts2, "work:0.0"), "--kind", "done", "--text", "bob done")
	time.Sleep(1100 * time.Millisecond)
	e.notify(a, "--pane", paneIDOf(ts, "work:0.1"), "--kind", "idle", "--text", "idle one")
	time.Sleep(1100 * time.Millisecond)
	e.notify(a, "--pane", paneIDOf(ts, "work:0.0"), "--kind", "permission", "--text", "run it?")
	waitFor(t, "three in the inbox", func() bool { return e.inbox(full).Count == 3 })
	in := e.inbox(full)
	order := []string{in.Inbox[0].Address, in.Inbox[1].Address, in.Inbox[2].Address}
	if strings.Join(order, " ") != "bob-desktop/work/0.0 "+host+"/work/0.1 "+shell0 {
		t.Fatalf("order: %v", order)
	}
	if in.Inbox[0].Attention.At > in.Inbox[1].Attention.At || in.Inbox[1].Attention.At > in.Inbox[2].Attention.At {
		t.Fatalf("not oldest first: %+v", in.Inbox)
	}
	if in.Inbox[2].Mode != "write" || in.Inbox[1].Mode != "read" {
		t.Fatalf("modes: %+v", in.Inbox)
	}
	a2 := e.inbox(alice)
	if a2.Count != 2 || strings.Contains(e.get(alice, "/v1/inbox").body, "bob") {
		t.Fatalf("alice's inbox: %+v", a2)
	}
	// Text mode: five columns, the choices last.
	r := e.getText(full, "/v1/inbox")
	expect(t, r, http.StatusOK, "inbox text")
	lines := strings.Split(strings.TrimRight(r.body, "\n"), "\n")
	if len(lines) != 3 || !strings.HasPrefix(lines[0], "bob-desktop/work/0.0\tdone\t") || !strings.HasSuffix(lines[2], "\tpermission\t"+fmt.Sprint(in.Inbox[2].Attention.At)+"\trun it?\t") {
		t.Fatalf("text mode:\n%s", r.body)
	}
	p := e.ask(a, paneIDOf(ts, "work:0.0"), "30s", "which?", "one", "two")
	waitFor(t, "the question", func() bool { return e.attention(full, shell0) == "question" })
	r = e.getText(full, "/v1/inbox")
	if !strings.Contains(r.body, "\tquestion\t") || !strings.HasSuffix(strings.TrimRight(r.body, "\n"), "\twhich?\tone|two") {
		t.Fatalf("text mode with choices:\n%s", r.body)
	}
	expect(t, e.getText(full, "/v1/inbox?charset=ascii"), http.StatusOK, "ascii")
	expect(t, e.get(full, "/v1/inbox?charset=nope"), http.StatusBadRequest, "bad charset")
	expect(t, e.answer(full, shell0, "two"), http.StatusNoContent, "answer")
	p.wait(t, 10*time.Second)
	expect(t, e.get("", "/v1/inbox"), http.StatusUnauthorized, "no token")
}

// The stand-in harness: a script a pane runs under the name of a real
// one, which prints for a while, draws a permission prompt and waits for
// a line, then prints and sits at its prompt.
const fakeHarness = `#!/bin/bash
printf '\033[2J\033[H'
for i in $(seq 1 14); do echo "step $i: working on it"; sleep 0.5; done
echo
echo "Do you want to proceed?"
echo " ❯ 1. Yes"
echo "   2. No"
echo "  Esc to cancel"
read -r answer
printf '\033[2J\033[H'
echo "● Done. The answer was $answer."
echo
echo "❯ "
sleep 300
`

func writeFakeHarness(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "fake.sh")
	if err := os.WriteFile(path, []byte(fakeHarness), 0o700); err != nil {
		t.Fatal(err)
	}
	return path
}

// runAs runs the script in a pane under the given program name, so
// tmux's pane_current_command names the harness.
func (ts *tmuxServer) runAs(target, name, script string) {
	ts.must("send-keys", "-t", target, "-l", "exec -a "+name+" bash "+script)
	ts.must("send-keys", "-t", target, "Enter")
}

// 27
func TestWatcherReportsAHarnessWithoutHooks(t *testing.T) {
	e := newEnv(t)
	ts := newTmux(t)
	a := e.pairAgent(host, ts)
	ts.split("work:0.0")
	ts.split("work:0.0")
	e.expose(ts, "work:0.0", "--write")
	e.expose(ts, "work:0.1", "--write")
	e.expose(ts, "work:0.2", "--write")
	full := e.token("full", []string{"*"}, []string{"*"})
	script := writeFakeHarness(t)
	// The second pane spoke for itself: its hooks are trusted, the watcher
	// leaves it alone whatever its screen does.
	e.notify(a, "--pane", paneIDOf(ts, "work:0.1"), "--kind", "working")
	start := e.events(full, "").Next
	// The third runs a plain shell with a prompt that looks like a question:
	// not a harness, never watched.
	ts.must("send-keys", "-t", "work:0.2", "-l", "echo 'Do you want to proceed?'; echo ' 1. Yes'; echo ' 2. No'")
	ts.must("send-keys", "-t", "work:0.2", "Enter")

	ts.runAs("work:0.0", "claude", script)
	ts.runAs("work:0.1", "claude", script)
	waitFor(t, "the command is claude", func() bool {
		return ts.must("display-message", "-p", "-t", "work:0.0", "#{pane_current_command}") == "claude"
	})

	kinds := func() []string {
		var out []string
		for _, ev := range e.events(full, fmt.Sprintf("?after=%d&limit=100", start)).Events {
			if ev.Address == shell0 {
				out = append(out, ev.Kind+":"+ev.Text)
			}
		}
		return out
	}
	waitFor(t, "working", func() bool { k := kinds(); return len(k) >= 1 && k[0] == "working:" })
	waitFor(t, "the permission prompt", func() bool { k := kinds(); return len(k) >= 2 && k[1] == "permission:asks for a permission" })
	if e.attention(full, shell0) != "permission" {
		t.Fatal("no attention on the waiting pane")
	}
	// Answer it on the host: the screen moves (working), then sits at the
	// prompt long enough to be done.
	ts.must("send-keys", "-t", "work:0.0", "-l", "1")
	ts.must("send-keys", "-t", "work:0.0", "Enter")
	waitFor(t, "working again", func() bool { k := kinds(); return len(k) >= 3 && k[2] == "working:" })
	deadline := time.Now().Add(25 * time.Second)
	for time.Now().Before(deadline) {
		if k := kinds(); len(k) >= 4 {
			if k[3] != "done:finished" {
				t.Fatalf("after working: %v", k)
			}
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	if k := kinds(); len(k) != 4 {
		t.Fatalf("events: %v", k)
	}
	if e.attention(full, shell0) != "done" {
		t.Fatal("no done attention")
	}
	// The hooked pane: no working, no done from the watcher, but the prompt
	// its hooks said nothing about is raised, and taken back once it is
	// answered on the host. Nothing from the plain shell, and no screen
	// text anywhere.
	hooked := func() []string {
		var out []string
		for _, ev := range e.events(full, fmt.Sprintf("?after=%d&limit=100", start)).Events {
			if ev.Address == host+"/work/0.1" {
				out = append(out, ev.Kind+":"+ev.Text)
			}
		}
		return out
	}
	waitFor(t, "the hooked pane's prompt", func() bool { k := hooked(); return len(k) == 1 && k[0] == "permission:asks for a permission" })
	ts.must("send-keys", "-t", "work:0.1", "-l", "1")
	ts.must("send-keys", "-t", "work:0.1", "Enter")
	waitFor(t, "the hooked pane's prompt cleared", func() bool { k := hooked(); return len(k) == 2 && k[1] == "working:" })
	time.Sleep(10 * time.Second)
	if k := hooked(); len(k) != 2 {
		t.Fatalf("the watcher spoke for a hooked pane beyond its prompt: %v", k)
	}
	for _, ev := range e.events(full, fmt.Sprintf("?after=%d&limit=100", start)).Events {
		if ev.Address != shell0 && ev.Address != host+"/work/0.1" {
			t.Fatalf("an event for %s: %+v", ev.Address, ev)
		}
		if strings.Contains(ev.Text, "step") || strings.Contains(ev.Text, "proceed") {
			t.Fatalf("screen text travelled: %+v", ev)
		}
	}
	// A watched pane that gets a hook notification is handed over: the
	// screen moves (typing echoes while the script sleeps) and the watcher
	// says nothing.
	e.notify(a, "--pane", paneIDOf(ts, "work:0.0"), "--kind", "question", "--text", "from a hook")
	ts.must("send-keys", "-t", "work:0.0", "-l", "typed on the host")
	time.Sleep(5 * time.Second)
	if e.attention(full, shell0) != "question" {
		t.Fatal("the watcher overrode a hook's notification")
	}
	// An agent with the watcher off reports nothing for a harness.
	stop(a.cmd)
	e.waitOnline(host, false)
	a.args = []string{"--watch=false"}
	e.runAgent(a, ts)
	e.waitOnline(host, true)
	start = e.events(full, "").Next
	ts.must("respawn-pane", "-k", "-t", "work:0.2", shell())
	e.expose(ts, "work:0.2", "--write")
	ts.runAs("work:0.2", "codex", script)
	time.Sleep(6 * time.Second)
	if got := e.events(full, fmt.Sprintf("?after=%d", start)); len(got.Events) != 0 {
		t.Fatalf("events with the watcher off: %+v", got.Events)
	}
}

// clientEnv is the environment the command-line client reads.
func (e *env) clientEnv(tok string) []string {
	return append(os.Environ(), "MUXWAY_HUB="+e.url(), "MUXWAY_TOKEN="+tok, "MUXWAY_CA="+filepath.Join(e.dir, "ca.pem"), "MUXWAY_DIR=")
}

func (e *env) runClient(environ []string, args ...string) (string, string, int) {
	cmd := exec.Command(bin, append([]string{"client"}, args...)...)
	cmd.Env = environ
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	err := cmd.Run()
	code := 0
	if ee, ok := err.(*exec.ExitError); ok {
		code = ee.ExitCode()
	} else if err != nil {
		code = 1
	}
	return out.String(), errb.String(), code
}

// 28
func TestClientDrivesAHubFromTheCommandLine(t *testing.T) {
	e, ts, a := basic(t)
	ts.split("work:0.0")
	e.expose(ts, "work:0.1")
	full := e.token("full", []string{"*"}, []string{"*"})
	reader := e.token("reader", []string{"*"}, nil)
	env := e.clientEnv(full)

	out, errs, code := e.runClient(env, "panes")
	if code != 0 || !strings.Contains(out, shell0+"\twrite\t") || !strings.Contains(out, host+"/work/0.1\tread\t") {
		t.Fatalf("panes: %d %q %q", code, out, errs)
	}
	out, _, code = e.runClient(env, "panes", "--json")
	if code != 0 || !strings.Contains(out, `"panes":[`) {
		t.Fatalf("panes --json: %q", out)
	}
	out, _, code = e.runClient(env, "inbox")
	if code != 0 || strings.TrimSpace(out) != "" {
		t.Fatalf("empty inbox: %d %q", code, out)
	}
	if _, _, code = e.runClient(env, "send", shell0, "echo client-typed-7", "--enter"); code != 0 {
		t.Fatalf("send: %d", code)
	}
	waitFor(t, "the text in the pane", func() bool { return strings.Contains(ts.capture("work:0.0"), "client-typed-7") })
	out, _, code = e.runClient(env, "read", shell0, "--lines", "20")
	if code != 0 || !strings.Contains(out, "client-typed-7") {
		t.Fatalf("read: %d %q", code, out)
	}
	if _, _, code = e.runClient(env, "key", shell0, "C-l"); code != 0 {
		t.Fatalf("key: %d", code)
	}
	if _, errs, code = e.runClient(env, "key", shell0, "C-;"); code == 0 || !strings.Contains(errs, "bad_input") {
		t.Fatalf("a bad key: %d %q", code, errs)
	}
	// A read-only token is refused on every write, and the token stays out of the output.
	ro := e.clientEnv(reader)
	for _, args := range [][]string{{"send", shell0, "x"}, {"key", shell0, "Enter"}, {"answer", shell0, "yes"}} {
		out, errs, code := e.runClient(ro, args...)
		if code == 0 || !strings.Contains(errs, "read_only") || strings.Contains(out+errs, reader) {
			t.Fatalf("%v with a read-only token: %d %q %q", args, code, out, errs)
		}
	}
	// wait: a question appears, wait prints it with its choices; answer resolves it.
	p := e.ask(a, paneIDOf(ts, "work:0.0"), "60s", "ship it?", "yes", "no")
	out, errs, code = e.runClient(env, "wait", shell0, "--timeout", "20s")
	if code != 0 || strings.TrimSpace(out) != shell0+"\tquestion\tship it?\tyes|no" {
		t.Fatalf("wait: %d %q %q", code, out, errs)
	}
	out, _, code = e.runClient(env, "wait", "--json")
	if code != 0 || !strings.Contains(out, `"choices":["yes","no"]`) {
		t.Fatalf("wait --json: %q", out)
	}
	out, _, code = e.runClient(env, "inbox")
	if code != 0 || !strings.HasPrefix(out, shell0+"\tquestion\t") || !strings.HasSuffix(strings.TrimSpace(out), "\tship it?\tyes|no") {
		t.Fatalf("inbox: %q", out)
	}
	if _, errs, code = e.runClient(env, "answer", shell0, "maybe"); code == 0 || !strings.Contains(errs, "bad_input") {
		t.Fatalf("a wrong answer: %d %q", code, errs)
	}
	if _, errs, code = e.runClient(env, "answer", shell0, "no"); code != 0 {
		t.Fatalf("answer: %d %q", code, errs)
	}
	if code, ans := p.wait(t, 10*time.Second); code != 0 || ans != "no" {
		t.Fatalf("ask got %d %q", code, ans)
	}
	// wait with nothing coming times out with exit 2.
	_, errs, code = e.runClient(env, "wait", host+"/work/0.1", "--timeout", "2s")
	if code != 2 {
		t.Fatalf("wait timeout: %d %q", code, errs)
	}
	// events: the question and its answer's clearing are in the feed.
	out, _, code = e.runClient(env, "events")
	if code != 0 || !strings.Contains(out, "\tquestion\tship it?\tyes|no") {
		t.Fatalf("events: %q", out)
	}
	// connect keeps the hub and the token in a directory, mode 600, and
	// the commands then need no environment.
	dir := filepath.Join(t.TempDir(), "client")
	tokFile := filepath.Join(t.TempDir(), "tok")
	os.WriteFile(tokFile, []byte(full+"\n"), 0o600)
	bare := append(os.Environ(), "MUXWAY_DIR=", "MUXWAY_HUB=", "MUXWAY_TOKEN=", "MUXWAY_CA=")
	out, errs, code = e.runClient(bare, "connect", "--dir", dir, "--hub", e.url(), "--token-file", tokFile, "--ca", filepath.Join(e.dir, "ca.pem"))
	if code != 0 || !strings.Contains(out, "connected") {
		t.Fatalf("connect: %d %q %q", code, out, errs)
	}
	if st, err := os.Stat(filepath.Join(dir, "token")); err != nil || st.Mode().Perm() != 0o600 {
		t.Fatalf("token file: %v %v", st, err)
	}
	out, errs, code = e.runClient(bare, "panes", "--dir", dir)
	if code != 0 || !strings.Contains(out, shell0) {
		t.Fatalf("panes after connect: %d %q %q", code, out, errs)
	}
	badTok := filepath.Join(t.TempDir(), "bad")
	os.WriteFile(badTok, []byte("mxt_nope\n"), 0o600)
	if _, errs, code = e.runClient(bare, "connect", "--dir", dir, "--hub", e.url(), "--token-file", badTok, "--ca", filepath.Join(e.dir, "ca.pem")); code == 0 || !strings.Contains(errs, "refused") {
		t.Fatalf("connect with a bad token: %d %q", code, errs)
	}
	if _, errs, code = e.runClient(bare, "panes", "--dir", filepath.Join(t.TempDir(), "none")); code == 0 || !strings.Contains(errs, "no hub or token") {
		t.Fatalf("panes without a hub: %d %q", code, errs)
	}
	// The skill is printed whole.
	skill := e.mustCLI("skill")
	if !strings.HasPrefix(skill, "---\nname: muxway") || !strings.Contains(skill, "muxway ask --text") {
		t.Fatalf("skill: %q", skill[:60])
	}
	// Hooks are printed for every harness, with the agent directory in the command.
	for _, h := range []string{"claude-code", "codex", "gemini", "copilot", "opencode"} {
		out := e.mustCLI("hooks", h, "--dir", a.dir)
		if !strings.Contains(out, "notify") || !strings.Contains(out, a.dir) {
			t.Fatalf("hooks %s: %q", h, out)
		}
	}
	if _, err := e.cli("hooks", "vim"); err == nil {
		t.Fatal("hooks for an unknown harness")
	}
	// notify --from reads each harness's payload.
	cmd := exec.Command(bin, "notify", "--from", "codex", "--dir", a.dir, "--pane", paneIDOf(ts, "work:0.0"))
	cmd.Stdin = strings.NewReader(`{"hook_event_name":"PermissionRequest","tool_name":"shell","tool_input":{"command":"rm -rf /"}}`)
	if err := cmd.Run(); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the codex permission", func() bool { return e.attention(full, shell0) == "permission" })
	if !strings.Contains(e.get(full, "/v1/panes").body, "Codex wants to use shell") || strings.Contains(e.get(full, "/v1/panes").body, "rm -rf") {
		t.Fatal("the codex hook's text")
	}
	cmd = exec.Command(bin, "notify", "--from", "gemini", "--dir", a.dir, "--pane", paneIDOf(ts, "work:0.0"))
	cmd.Stdin = strings.NewReader(`{"hook_event_name":"AfterAgent","prompt":"p","prompt_response":"secret answer"}`)
	if err := cmd.Run(); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "gemini done", func() bool { return e.attention(full, shell0) == "done" })
	if strings.Contains(e.get(full, "/v1/events").body, "secret answer") {
		t.Fatal("a model answer travelled")
	}
}

// 29
func TestMCPServerSpeaksOverStdio(t *testing.T) {
	e, ts, a := basic(t)
	full := e.token("full", []string{"*"}, []string{"*"})
	cmd := exec.Command(bin, "mcp")
	cmd.Env = e.clientEnv(full)
	stdin, _ := cmd.StdinPipe()
	stdout, _ := cmd.StdoutPipe()
	cmd.Stderr = e.logFile("mcp")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer cmd.Process.Kill()
	rd := bufio.NewReader(stdout)
	send := func(line string) map[string]any {
		t.Helper()
		io.WriteString(stdin, line+"\n")
		raw, err := rd.ReadString('\n')
		if err != nil {
			t.Fatalf("read: %v", err)
		}
		var v map[string]any
		if err := json.Unmarshal([]byte(raw), &v); err != nil {
			t.Fatalf("not JSON: %q", raw)
		}
		return v
	}
	text := func(v map[string]any) string {
		r, _ := v["result"].(map[string]any)
		cs, _ := r["content"].([]any)
		if len(cs) == 0 {
			return ""
		}
		c, _ := cs[0].(map[string]any)
		s, _ := c["text"].(string)
		return s
	}
	init := send(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}`)
	if r, _ := init["result"].(map[string]any); r == nil || r["protocolVersion"] != "2025-06-18" {
		t.Fatalf("initialize: %v", init)
	}
	io.WriteString(stdin, `{"jsonrpc":"2.0","method":"notifications/initialized"}`+"\n")
	list := send(`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)
	if r, _ := list["result"].(map[string]any); r == nil || len(r["tools"].([]any)) != 7 {
		t.Fatalf("tools/list: %v", list)
	}
	panes := send(`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_panes","arguments":{}}}`)
	if !strings.Contains(text(panes), shell0+"\twrite") {
		t.Fatalf("list_panes: %v", panes)
	}
	sent := send(`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"send_text","arguments":{"address":"` + shell0 + `","text":"echo via-mcp-9","enter":true}}}`)
	if text(sent) != "sent" {
		t.Fatalf("send_text: %v", sent)
	}
	waitFor(t, "the text in the pane", func() bool { return strings.Contains(ts.capture("work:0.0"), "via-mcp-9") })
	read := send(`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"read_pane","arguments":{"address":"` + shell0 + `"}}}`)
	if !strings.Contains(text(read), "via-mcp-9") {
		t.Fatalf("read_pane: %v", read)
	}
	p := e.ask(a, paneIDOf(ts, "work:0.0"), "60s", "merge?", "yes", "no")
	waitFor(t, "the question", func() bool { return e.attention(full, shell0) == "question" })
	inbox := send(`{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"inbox"}}`)
	if !strings.Contains(text(inbox), shell0+"\tquestion\tmerge?\tchoices: yes | no") {
		t.Fatalf("inbox: %v", inbox)
	}
	bad := send(`{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"answer","arguments":{"address":"` + shell0 + `","choice":"maybe"}}}`)
	if r, _ := bad["result"].(map[string]any); r == nil || r["isError"] != true || !strings.Contains(text(bad), "bad_input") {
		t.Fatalf("a wrong choice is a tool error: %v", bad)
	}
	ok := send(`{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"answer","arguments":{"address":"` + shell0 + `","choice":"yes"}}}`)
	if text(ok) != "answered" {
		t.Fatalf("answer: %v", ok)
	}
	if code, ans := p.wait(t, 10*time.Second); code != 0 || ans != "yes" {
		t.Fatalf("ask: %d %q", code, ans)
	}
	missing := send(`{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"read_pane","arguments":{"address":"` + host + `/work/9.9"}}}`)
	if r, _ := missing["result"].(map[string]any); r == nil || r["isError"] != true {
		t.Fatalf("a missing pane is a tool error: %v", missing)
	}
	unknown := send(`{"jsonrpc":"2.0","id":10,"method":"prompts/list"}`)
	if unknown["error"] == nil {
		t.Fatalf("an unknown method: %v", unknown)
	}
	stdin.Close()
	if err := cmd.Wait(); err != nil {
		t.Fatalf("mcp exit: %v", err)
	}
	// A read-only token through the same server: the write is a tool error.
	reader := e.token("reader", []string{"*"}, nil)
	cmd = exec.Command(bin, "mcp")
	cmd.Env = e.clientEnv(reader)
	stdin, _ = cmd.StdinPipe()
	stdout, _ = cmd.StdoutPipe()
	cmd.Stderr = e.logFile("mcp-ro")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer cmd.Process.Kill()
	rd = bufio.NewReader(stdout)
	refused := send(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"send_key","arguments":{"address":"` + shell0 + `","key":"Enter"}}}`)
	if r, _ := refused["result"].(map[string]any); r == nil || r["isError"] != true || !strings.Contains(text(refused), "read_only") || strings.Contains(fmt.Sprint(refused), reader) {
		t.Fatalf("read-only through mcp: %v", refused)
	}
	stdin.Close()
	cmd.Wait()
}
