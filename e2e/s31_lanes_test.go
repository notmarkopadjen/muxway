//go:build e2e

package e2e

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

// The agent serves the hub's requests in lanes: a key never waits
// behind a read, at most four captures run at once, a pane that stands
// still is answered from its kept capture, and the hub asks the agent
// once for the clients reading the same pane at the same moment.

// wrappedTmux puts a tmux of the test's own first on the agent's PATH:
// it runs the real one and notes every command's start and end in a
// log, so the test can count captures and tell how many ran at once.
func wrappedTmux(t *testing.T) ([]string, string) {
	t.Helper()
	real, err := exec.LookPath("tmux")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	log := filepath.Join(dir, "tmux.log")
	script := "#!/bin/sh\n" +
		"log=\"$MXW_TMUX_LOG\"\n" +
		"echo \"$3 start\" >> \"$log\"\n" +
		"\"" + real + "\" \"$@\"\n" +
		"rc=$?\n" +
		"echo \"$3 end\" >> \"$log\"\n" +
		"exit $rc\n"
	os.WriteFile(filepath.Join(dir, "tmux"), []byte(script), 0o700)
	return []string{"PATH=" + dir + string(os.PathListSeparator) + os.Getenv("PATH"), "MXW_TMUX_LOG=" + log}, log
}

// tmuxCalls counts a command's runs in the wrapper's log, and the most
// that ran at once.
func tmuxCalls(log, command string) (count, atOnce int) {
	raw, _ := os.ReadFile(log)
	n := 0
	for _, l := range strings.Split(string(raw), "\n") {
		switch l {
		case command + " start":
			count++
			n++
			atOnce = max(atOnce, n)
		case command + " end":
			n--
		}
	}
	return count, atOnce
}

// lanesEnv is a host with three writable panes, each exposed on its
// own: the first at a prompt in its own window, the other two in a
// second window printing a line every few milliseconds (tmux keeps one
// activity time per window, so a printer beside the idle pane would
// move it), behind a tmux that counts.
func lanesEnv(t *testing.T) (*env, *tmuxServer, string) {
	t.Helper()
	e := newEnv(t)
	ts := newTmux(t)
	env, log := wrappedTmux(t)
	e.pairAgentEnv(host, ts, env)
	ts.must("new-window", "-t", "work:1", "-n", "printers", shell())
	ts.title("work:1.0")
	ts.split("work:1.0")
	for _, p := range []string{"work:0.0", "work:1.0", "work:1.1"} {
		e.expose(ts, p, "--write")
	}
	for _, p := range printers {
		ts.must("send-keys", "-t", p, "i=0; while :; do i=$((i+1)); echo \"line $i of "+p+"\"; sleep 0.02; done", "Enter")
	}
	waitFor(t, "the printers printing", func() bool {
		return strings.Contains(ts.capture("work:1.1"), "line 5 of")
	})
	return e, ts, log
}

var printers = []string{"work:1.0", "work:1.1"}

// try is a request from a goroutine: no Fatal, the error comes back.
func (e *env) try(token, path string) (int, string, error) {
	req, err := http.NewRequest("GET", e.url()+path, nil)
	if err != nil {
		return 0, "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	r, err := e.client.Do(req)
	if err != nil {
		return 0, "", err
	}
	defer r.Body.Close()
	raw, _ := io.ReadAll(r.Body)
	return r.StatusCode, string(raw), nil
}

// flood reads the printing panes from sixteen tokens at once until stop
// is closed; it answers how many reads were served.
func (e *env) flood(t *testing.T, stop chan struct{}) (*sync.WaitGroup, *int64) {
	t.Helper()
	var wg sync.WaitGroup
	var mu sync.Mutex
	served := new(int64)
	for i := 0; i < 16; i++ {
		tok := e.token(fmt.Sprintf("reader%d", i), []string{host + "/*"}, nil)
		pane := host + "/work/1.0"
		if i%2 == 1 {
			pane = host + "/work/1.1"
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
				status, _, err := e.try(tok, "/v1/panes/"+pane+"?lines=200")
				if err == nil && status == http.StatusOK {
					mu.Lock()
					*served++
					mu.Unlock()
				}
				if status == http.StatusTooManyRequests {
					time.Sleep(50 * time.Millisecond)
				}
			}
		}()
	}
	return &wg, served
}

// 214
func TestSec214_AKeyDoesNotWaitBehindAFloodOfReads(t *testing.T) {
	e, ts, _ := lanesEnv(t)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	stop := make(chan struct{})
	wg, served := e.flood(t, stop)
	time.Sleep(500 * time.Millisecond)
	var took []time.Duration
	for i := 0; i < 20; i++ {
		text := string(rune('a' + i))
		start := time.Now()
		expect(t, e.input(full, shell0, map[string]any{"text": text}), http.StatusNoContent, "key "+text+" under load")
		took = append(took, time.Since(start))
	}
	close(stop)
	wg.Wait()
	sort.Slice(took, func(i, j int) bool { return took[i] < took[j] })
	median, worst := took[len(took)/2], took[len(took)-1]
	t.Logf("input round trip under %d reads: median %v, worst %v", *served, median.Round(time.Millisecond), worst.Round(time.Millisecond))
	if median > 250*time.Millisecond || worst > 2*time.Second {
		t.Fatalf("a key waited: median %v, worst %v", median, worst)
	}
	if *served < 100 {
		t.Fatalf("the flood served only %d reads: no load", *served)
	}
	// The keys reached the pane in the order sent, and the audit log has them so.
	if !strings.Contains(ts.capture("work:0.0"), "abcdefghijklmnopqrst") {
		t.Fatalf("the pane shows: %q", ts.capture("work:0.0"))
	}
	var inputs int
	for _, l := range strings.Split(e.agentLog(host), "\n") {
		if strings.Contains(l, "op=input") && strings.Contains(l, "text_bytes=1") {
			inputs++
		}
	}
	if inputs != 20 {
		t.Fatalf("%d input audit lines", inputs)
	}
}

// 215
func TestSec215_AtMostFourCapturesRunAtOnce(t *testing.T) {
	e, _, log := lanesEnv(t)
	stop := make(chan struct{})
	wg, served := e.flood(t, stop)
	time.Sleep(2 * time.Second)
	close(stop)
	wg.Wait()
	count, atOnce := tmuxCalls(log, "capture-pane")
	t.Logf("%d reads served, %d captures, %d at once at most", *served, count, atOnce)
	if atOnce > 4 {
		t.Fatalf("%d captures ran at once", atOnce)
	}
	if count < 20 {
		t.Fatalf("%d captures: no load", count)
	}
}

// 216
func TestSec216_APaneUnexposedBetweenTwoKeysRefusesTheSecond(t *testing.T) {
	e, ts, _ := lanesEnv(t)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	stop := make(chan struct{})
	wg, _ := e.flood(t, stop)
	defer func() { close(stop); wg.Wait() }()
	time.Sleep(300 * time.Millisecond)
	expect(t, e.input(full, shell0, map[string]any{"text": "1"}), http.StatusNoContent, "the first key")
	e.mustCLI("unexpose", "--tmux-name", ts.name, "-t", "work:0.0")
	r := e.input(full, shell0, map[string]any{"text": "2"})
	if r.status == http.StatusNoContent {
		t.Fatal("the second key was typed into an unexposed pane")
	}
	if strings.Contains(ts.capture("work:0.0"), "12") {
		t.Fatalf("the key reached the pane: %q", ts.capture("work:0.0"))
	}
}

// 217
func TestSec217_AKeptCaptureIsNeverServedAcrossPanesOrGrants(t *testing.T) {
	e, ts, _ := lanesEnv(t)
	one := e.token("one", []string{host + "/work/1.0"}, nil)
	two := e.token("two", []string{host + "/work/1.1"}, nil)
	var wg sync.WaitGroup
	for _, c := range []struct{ tok, pane, own, other string }{
		{one, host + "/work/1.0", "of work:1.0", "of work:1.1"},
		{two, host + "/work/1.1", "of work:1.1", "of work:1.0"},
	} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 30; i++ {
				status, body, err := e.try(c.tok, "/v1/panes/"+c.pane)
				if err != nil || status != http.StatusOK {
					t.Errorf("%s: %d %v", c.pane, status, err)
					return
				}
				if !strings.Contains(body, c.own) || strings.Contains(body, c.other) {
					t.Errorf("%s: another pane's content", c.pane)
					return
				}
				time.Sleep(20 * time.Millisecond)
			}
			// The other pane is outside the grant, kept capture or not.
			if status, _, _ := e.try(c.tok, "/v1/panes/"+strings.NewReplacer("1.0", "1.1", "1.1", "1.0").Replace(c.pane)); status != http.StatusNotFound {
				t.Errorf("%s: the other pane answered %d", c.pane, status)
			}
		}()
	}
	wg.Wait()
	_ = ts
}

// 218
func TestFlow218_TwoInputsBackToBackArriveInOrderUnderLoad(t *testing.T) {
	e, ts, _ := lanesEnv(t)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	stop := make(chan struct{})
	wg, _ := e.flood(t, stop)
	time.Sleep(300 * time.Millisecond)
	var want strings.Builder
	for i := 0; i < 60; i++ {
		a, b := string(rune('a'+i%26)), string(rune('A'+i%26))
		expect(t, e.input(full, shell0, map[string]any{"text": a}), http.StatusNoContent, "first of the pair")
		expect(t, e.input(full, shell0, map[string]any{"text": b}), http.StatusNoContent, "second of the pair")
		want.WriteString(a + b)
	}
	close(stop)
	wg.Wait()
	// The line wraps at the pane's width: the typed text is read across rows.
	got := strings.ReplaceAll(strings.ReplaceAll(ts.capture("work:0.0"), "\n", ""), "$ ", "")
	if !strings.Contains(got, want.String()) {
		t.Fatalf("the pane shows %q, want %q in it", got, want.String())
	}
}

// 219
func TestFlow219_AnIdlePaneCostsOneCapture(t *testing.T) {
	e, ts, log := lanesEnv(t)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	// The prompt's own second must pass before a capture can be kept.
	time.Sleep(1500 * time.Millisecond)
	before, _ := tmuxCalls(log, "capture-pane")
	var first string
	for i := 0; i < 30; i++ {
		r := e.get(full, "/v1/panes/"+shell0)
		expect(t, r, http.StatusOK, "an idle read")
		if first == "" {
			first = r.body
		} else if r.body != first {
			t.Fatalf("read %d differs:\n%s\n%s", i, first, r.body)
		}
		time.Sleep(100 * time.Millisecond)
	}
	after, _ := tmuxCalls(log, "capture-pane")
	if after-before != 1 {
		t.Fatalf("%d captures for thirty reads of an idle pane", after-before)
	}
	// A key typed into it is seen by the next read.
	expect(t, e.input(full, shell0, map[string]any{"text": "typed"}), http.StatusNoContent, "a key")
	waitFor(t, "the key echoed", func() bool { return strings.Contains(ts.capture("work:0.0"), "typed") })
	r := e.get(full, "/v1/panes/"+shell0)
	expect(t, r, http.StatusOK, "after the key")
	if !strings.Contains(r.body, "typed") {
		t.Fatalf("the read after the key shows: %s", r.body)
	}
}

// 220
func TestFlow220_OutputWithinTheCapturesSecondIsNotMissed(t *testing.T) {
	e, _, _ := lanesEnv(t)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	e.get(full, "/v1/panes/"+shell0)
	for i := 0; i < 5; i++ {
		first, second := fmt.Sprintf("first-%d", i), fmt.Sprintf("second-%d", i)
		expect(t, e.input(full, shell0, map[string]any{"text": "echo " + first + "; sleep 0.3; echo " + second, "key": ""}), http.StatusNoContent, "the command")
		expect(t, e.input(full, shell0, map[string]any{"key": "Enter"}), http.StatusNoContent, "Enter")
		time.Sleep(120 * time.Millisecond)
		r := e.get(full, "/v1/panes/"+shell0)
		expect(t, r, http.StatusOK, "the read between the two lines")
		if !strings.Contains(r.body, first) {
			t.Fatalf("round %d: the first line is not shown: %s", i, r.body)
		}
		time.Sleep(400 * time.Millisecond)
		r = e.get(full, "/v1/panes/"+shell0)
		expect(t, r, http.StatusOK, "the read after the second line")
		if !strings.Contains(r.body, second) {
			t.Fatalf("round %d: the second line is missed: %s", i, r.body)
		}
		time.Sleep(700 * time.Millisecond)
	}
}

// 221
func TestFlow221_AResizeInvalidatesTheKeptCapture(t *testing.T) {
	e, ts, log := lanesEnv(t)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	time.Sleep(1500 * time.Millisecond)
	expect(t, e.get(full, "/v1/panes/"+shell0), http.StatusOK, "the first read")
	expect(t, e.get(full, "/v1/panes/"+shell0), http.StatusOK, "the second read")
	before, _ := tmuxCalls(log, "capture-pane")
	expect(t, e.get(full, "/v1/panes/"+shell0), http.StatusOK, "a read of the still pane")
	if n, _ := tmuxCalls(log, "capture-pane"); n != before {
		t.Fatalf("a still pane captured again")
	}
	ts.must("resize-window", "-t", "work:0", "-x", "90", "-y", "28")
	// The listing's view of the size is shared for half a second.
	time.Sleep(600 * time.Millisecond)
	expect(t, e.get(full, "/v1/panes/"+shell0), http.StatusOK, "a read after the resize")
	if n, _ := tmuxCalls(log, "capture-pane"); n != before+1 {
		t.Fatalf("%d captures after the resize, want %d", n, before+1)
	}
}

// 222
func TestFlow222_TheHubAsksTheAgentOnceForClientsReadingTogether(t *testing.T) {
	e, _, log := lanesEnv(t)
	writer := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	reader := e.token("reader", []string{host + "/*"}, nil)
	pane := host + "/work/1.0"
	before, _ := tmuxCalls(log, "capture-pane")
	var wg sync.WaitGroup
	bodies := make([][]string, 2)
	for i, tok := range []string{writer, reader} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for n := 0; n < 30; n++ {
				status, body, err := e.try(tok, "/v1/panes/"+pane)
				if err != nil || status != http.StatusOK {
					t.Errorf("%d: %d %v", i, status, err)
					return
				}
				bodies[i] = append(bodies[i], body)
				time.Sleep(40 * time.Millisecond)
			}
		}()
	}
	wg.Wait()
	after, _ := tmuxCalls(log, "capture-pane")
	t.Logf("%d captures for sixty reads of a printing pane by two clients", after-before)
	if after-before > 45 {
		t.Fatalf("%d captures for sixty reads together: the hub asked twice", after-before)
	}
	// Each answer wears its own grant.
	for _, b := range bodies[0] {
		if !strings.Contains(b, `"mode":"write"`) {
			t.Fatal("the writer's view lost its mode")
		}
	}
	for _, b := range bodies[1] {
		if !strings.Contains(b, `"mode":"read"`) {
			t.Fatal("the reader's view gained write")
		}
	}
}
