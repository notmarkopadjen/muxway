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
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Talk: a write that names the pane it came from, the feed of such
// writes, and the partners on the listing.

type talkResp struct {
	Talk []struct {
		Seq   uint64 `json:"seq"`
		At    int64  `json:"at"`
		Actor struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"actor"`
		From  talkEnd `json:"from"`
		To    talkEnd `json:"to"`
		Kind  string  `json:"kind"`
		Bytes int     `json:"bytes"`
		Text  string  `json:"text"`
	} `json:"talk"`
	Next uint64 `json:"next"`
}

type talkEnd struct {
	Host    string `json:"host"`
	Address string `json:"address"`
	PaneID  string `json:"pane_id"`
}

type talkPartner struct {
	Address string `json:"address"`
	PaneID  string `json:"pane_id"`
	At      int64  `json:"at"`
	Way     string `json:"way"`
}

func (e *env) talk(tok, query string) talkResp {
	e.t.Helper()
	r := e.get(tok, "/v1/talk"+query)
	expect(e.t, r, http.StatusOK, "talk"+query)
	var out talkResp
	if err := json.Unmarshal([]byte(r.body), &out); err != nil {
		e.t.Fatalf("talk: %v: %s", err, r.body)
	}
	return out
}

// partners returns the talk field of one pane of the token's listing.
func (e *env) partners(tok, address string) []talkPartner {
	e.t.Helper()
	var list struct {
		Panes []struct {
			Address string        `json:"address"`
			Talk    []talkPartner `json:"talk"`
		} `json:"panes"`
	}
	r := e.get(tok, "/v1/panes")
	expect(e.t, r, http.StatusOK, "panes")
	json.Unmarshal([]byte(r.body), &list)
	for _, p := range list.Panes {
		if p.Address == address {
			return p.Talk
		}
	}
	return nil
}

func from(host, id string) map[string]string { return map[string]string{"host": host, "pane_id": id} }

// 100
func TestSec100_AnOriginIsAPaneTheTokenReads(t *testing.T) {
	e, ts, a := basic(t)
	ts.split("work:0.0")
	ts.split("work:0.0")
	ts.split("work:0.0")
	// Marks go on once the panes are all there: a split lands at index 1.
	e.expose(ts, "work:0.1", "--write")
	e.expose(ts, "work:0.2") // read-only
	// work:0.3 stays hidden.
	shell1 := host + "/work/0.1"
	id0, id1, id2, id3 := paneIDOf(ts, "work:0.0"), paneIDOf(ts, "work:0.1"), paneIDOf(ts, "work:0.2"), paneIDOf(ts, "work:0.3")
	full := e.token("full", []string{"*"}, []string{"*"})
	reader := e.token("reader", []string{"*"}, nil)
	narrow := e.token("narrow", []string{host + "/work/0.0"}, []string{host + "/work/0.0"})

	// Origins that are refused, and nothing is typed for them.
	refused := []struct {
		what   string
		tok    string
		body   any
		status int
	}{
		{"an origin the token may not read", narrow, map[string]any{"text": "echo nope1", "from": from(host, id1)}, http.StatusNotFound},
		{"a hidden origin", full, map[string]any{"text": "echo nope2", "from": from(host, id3)}, http.StatusNotFound},
		{"an origin on a host that is not there", full, map[string]any{"text": "echo nope3", "from": from("bob-desktop", id1)}, http.StatusNotFound},
		{"a bad host name", full, map[string]any{"text": "echo nope4", "from": from("Bad Host", id1)}, http.StatusBadRequest},
		{"a bad pane id", full, map[string]any{"text": "echo nope5", "from": from(host, "3")}, http.StatusBadRequest},
		{"an empty origin", full, map[string]any{"text": "echo nope6", "from": map[string]string{}}, http.StatusBadRequest},
		{"a click from a pane", full, map[string]any{"mouse": map[string]any{"button": "left", "x": 1, "y": 1}, "from": from(host, id1)}, http.StatusBadRequest},
		{"an unknown field in the origin", full, map[string]any{"text": "echo nope7", "from": map[string]string{"host": host, "pane_id": id1, "x": "y"}}, http.StatusBadRequest},
		{"an origin with an answer where nothing waits", full, nil, 0},
	}
	for _, c := range refused {
		if c.body == nil {
			continue
		}
		expect(t, e.input(c.tok, shell0, c.body), c.status, c.what)
	}
	expect(t, e.post(full, "/v1/panes/"+shell0+"/answer", fmt.Sprintf(`{"choice":"yes","from":{"host":%q,"pane_id":%q}}`, host, id3)), http.StatusNotFound, "an answer from a hidden origin")
	time.Sleep(300 * time.Millisecond)
	if out := ts.capture("work:0.0"); strings.Contains(out, "nope") {
		t.Fatalf("a refused origin typed:\n%s", out)
	}
	if got := e.talk(full, ""); len(got.Talk) != 0 {
		t.Fatalf("refused writes made entries: %+v", got.Talk)
	}
	if e.partners(full, shell0) != nil {
		t.Fatal("refused writes made partners")
	}

	// A read-only origin is fine: speaking as a pane needs only to see it.
	expect(t, e.input(full, shell0, map[string]any{"text": "echo from-readonly-9", "from": from(host, id2)}), http.StatusNoContent, "from a read-only pane")
	waitFor(t, "the text in the pane", func() bool { return strings.Contains(ts.capture("work:0.0"), "from-readonly-9") })

	// The real thing: 0.1 talks to 0.0, 0.0 answers with a key.
	expect(t, e.input(full, shell0, map[string]any{"text": "echo talkcanary1", "from": from(host, id1)}), http.StatusNoContent, "text from 0.1")
	expect(t, e.input(full, shell1, map[string]any{"key": "Enter", "count": 2, "from": from(host, id0)}), http.StatusNoContent, "a key from 0.0")
	got := e.talk(full, "")
	if len(got.Talk) != 3 {
		t.Fatalf("entries: %+v", got.Talk)
	}
	e1, e2 := got.Talk[1], got.Talk[2]
	if e1.From.Address != shell1 || e1.From.PaneID != id1 || e1.To.Address != shell0 || e1.To.PaneID != id0 ||
		e1.Kind != "text" || e1.Text != "echo talkcanary1" || e1.Bytes != 16 || e1.Actor.Name != "full" || e1.Actor.ID == "" || e1.At == 0 {
		t.Fatalf("the text entry: %+v", e1)
	}
	if e2.From.Address != shell0 || e2.To.Address != shell1 || e2.Kind != "key" || e2.Text != "Enter ×2" || e2.Bytes != 0 {
		t.Fatalf("the key entry: %+v", e2)
	}
	if got.Next != e2.Seq {
		t.Fatalf("next %d, last seq %d", got.Next, e2.Seq)
	}
	if after := e.talk(full, fmt.Sprintf("?after=%d", e1.Seq)); len(after.Talk) != 1 || after.Talk[0].Seq != e2.Seq {
		t.Fatalf("after: %+v", after.Talk)
	}
	// The partners on the listing: 0.0 heard from 0.2 and talked both ways with 0.1.
	p0 := e.partners(full, shell0)
	if len(p0) != 2 || p0[0].Address != shell1 || p0[0].PaneID != id1 || p0[0].Way != "both" || p0[1].PaneID != id2 || p0[1].Way != "from" {
		t.Fatalf("partners of 0.0: %+v", p0)
	}
	if p1 := e.partners(full, shell1); len(p1) != 1 || p1[0].Address != shell0 || p1[0].Way != "both" {
		t.Fatalf("partners of 0.1: %+v", p1)
	}
	if p2 := e.partners(full, host+"/work/0.2"); len(p2) != 1 || p2[0].Address != shell0 || p2[0].Way != "to" {
		t.Fatalf("partners of 0.2: %+v", p2)
	}
	// A pane read carries them too, and the tree.
	if r := e.get(full, "/v1/panes/"+shell0); !strings.Contains(r.body, `"talk":[{"address":"`+shell1+`"`) {
		t.Fatalf("read without partners: %s", r.body)
	}
	if r := e.get(full, "/v1/hosts/"+host+"/tree"); !strings.Contains(r.body, `"way":"both"`) {
		t.Fatalf("tree without partners: %s", r.body)
	}

	// Who sees what: both panes must be readable.
	if got := e.talk(narrow, ""); len(got.Talk) != 0 {
		t.Fatalf("the feed for a token that reads one side: %+v", got.Talk)
	}
	if e.partners(narrow, shell0) != nil {
		t.Fatal("partners the token may not see")
	}
	if got := e.talk(reader, ""); len(got.Talk) != 3 {
		t.Fatalf("the feed for a reader of both: %+v", got.Talk)
	}
	if r := e.get(narrow, "/v1/panes"); strings.Contains(r.body, "talk") || strings.Contains(r.body, "0.1") {
		t.Fatalf("the narrow listing leaks: %s", r.body)
	}

	// Text mode, and the cursor line.
	r := e.getText(full, "/v1/talk?after="+fmt.Sprint(e1.Seq))
	expect(t, r, http.StatusOK, "talk text")
	if r.body != fmt.Sprintf("%d\t%d\t%s\t%s\tkey\tEnter ×2\nnext\t%d\n", e2.Seq, e2.At, shell0, shell1, e2.Seq) {
		t.Fatalf("text mode:\n%s", r.body)
	}
	expect(t, e.get(full, "/v1/talk?after=x"), http.StatusBadRequest, "bad cursor")
	expect(t, e.get(full, "/v1/talk?wait=31"), http.StatusBadRequest, "long wait")
	expect(t, e.get("", "/v1/talk"), http.StatusUnauthorized, "no token")

	// An answer from a pane.
	p := e.ask(a, id0, "60s", "merge?", "yes", "no")
	waitFor(t, "the question", func() bool { return e.attention(full, shell0) == "question" })
	expect(t, e.post(full, "/v1/panes/"+shell0+"/answer", fmt.Sprintf(`{"choice":"yes","from":{"host":%q,"pane_id":%q}}`, host, id1)), http.StatusNoContent, "answer from 0.1")
	if code, out := p.wait(t, 10*time.Second); code != 0 || out != "yes" {
		t.Fatalf("ask: %d %q", code, out)
	}
	if got := e.talk(full, "?after="+fmt.Sprint(e2.Seq)); len(got.Talk) != 1 || got.Talk[0].Kind != "answer" || got.Talk[0].Text != "yes" {
		t.Fatalf("the answer entry: %+v", got.Talk)
	}

	// The feed waits for an entry.
	done := make(chan talkResp, 1)
	go func() { done <- e.talk(full, fmt.Sprintf("?after=%d&wait=10", e2.Seq+1)) }()
	time.Sleep(500 * time.Millisecond)
	expect(t, e.input(full, shell0, map[string]any{"text": "echo later", "from": from(host, id1)}), http.StatusNoContent, "a later write")
	select {
	case got := <-done:
		if len(got.Talk) != 1 || got.Talk[0].Text != "echo later" {
			t.Fatalf("waited: %+v", got.Talk)
		}
	case <-time.After(8 * time.Second):
		t.Fatal("the wait did not wake")
	}

	// A text is kept to its first characters; a long one lands whole.
	long := strings.Repeat("x", 300)
	expect(t, e.input(full, shell0, map[string]any{"text": "echo " + long, "from": from(host, id1)}), http.StatusNoContent, "a long text")
	last := e.talk(full, "")
	if l := last.Talk[len(last.Talk)-1]; l.Bytes != 305 || len(l.Text) != 200 {
		t.Fatalf("a long text in the feed: bytes %d, kept %d", l.Bytes, len(l.Text))
	}

	// The partner follows its pane: a split before 0.1 moves it to 0.2.
	ts.split("work:0.0")
	waitFor(t, "the partner at its new address", func() bool {
		ps := e.partners(full, shell0)
		return len(ps) > 0 && ps[0].PaneID == id1 && ps[0].Address == host+"/work/0.2"
	})

	// The logs: the origin and sizes, never the text, never a token.
	hubLog, _ := os.ReadFile(filepath.Join(e.logs, "hub.log"))
	agentLog, _ := os.ReadFile(filepath.Join(e.logs, "agent-"+host+".log"))
	for _, l := range [][]byte{hubLog, agentLog} {
		if bytes.Contains(l, []byte("talkcanary1")) || bytes.Contains(l, []byte("from-readonly-9")) {
			t.Fatal("a text is in a log")
		}
	}
	for _, want := range []string{"msg=talk ", "from=" + host + "/" + id1, "to=" + host + "/" + id0, "kind=text bytes=16", "result=bad_origin"} {
		if !bytes.Contains(hubLog, []byte(want)) {
			t.Fatalf("hub log lacks %q:\n%s", want, hubLog)
		}
	}
	if !bytes.Contains(agentLog, []byte("from="+host+"/"+id1)) {
		t.Fatalf("agent audit lacks the origin:\n%s", agentLog)
	}
}

// 101
func TestSec101_TalkStaysUnderTheRateLimit(t *testing.T) {
	e, ts, _ := basic(t)
	ts.split("work:0.0")
	e.expose(ts, "work:0.1", "--write")
	id1 := paneIDOf(ts, "work:0.1")
	full := e.token("full", []string{"*"}, []string{"*"})
	// The writes go out at once: one after the other, a slow second would
	// refill the bucket under them.
	var ok, limited atomic.Int32
	var wg sync.WaitGroup
	odd := make(chan string, 60)
	for i := 0; i < 60; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			switch r := e.input(full, shell0, map[string]any{"text": fmt.Sprintf("echo burst%d", i), "from": from(host, id1)}); r.status {
			case http.StatusNoContent:
				ok.Add(1)
			case http.StatusTooManyRequests:
				limited.Add(1)
			default:
				odd <- fmt.Sprintf("write %d: %d %s", i, r.status, r.body)
			}
		}(i)
	}
	wg.Wait()
	close(odd)
	for msg := range odd {
		t.Fatal(msg)
	}
	if limited.Load() == 0 {
		t.Fatal("60 writes in a burst were all taken")
	}
	// The feed is under the same limit: a moment, and it answers.
	time.Sleep(1100 * time.Millisecond)
	if got := e.talk(full, "?limit=100"); len(got.Talk) != int(ok.Load()) {
		t.Fatalf("%d writes taken, %d entries", ok.Load(), len(got.Talk))
	}
}

// 102
func TestClientAndMCPSpeakFromTheirPane(t *testing.T) {
	e, ts, a := basic(t)
	ts.split("work:0.0")
	e.expose(ts, "work:0.1", "--write")
	shell1 := host + "/work/0.1"
	id0, id1 := paneIDOf(ts, "work:0.0"), paneIDOf(ts, "work:0.1")
	full := e.token("full", []string{"*"}, []string{"*"})
	env := e.clientEnv(full)
	inPane := func(id string) []string { return append(append([]string{}, env...), "TMUX_PANE="+id) }
	outside := append(append([]string{}, env...), "TMUX_PANE=")

	// Inside a pane, with the agent directory here: the origin is found.
	if out, errs, code := e.runClient(inPane(id1), "send", shell0, "echo cli-talk-1", "--enter", "--agent-dir", a.dir); code != 0 {
		t.Fatalf("send: %d %q %q", code, out, errs)
	}
	waitFor(t, "the text in the pane", func() bool { return strings.Contains(ts.capture("work:0.0"), "cli-talk-1") })
	got := e.talk(full, "")
	if len(got.Talk) != 2 || got.Talk[0].From.PaneID != id1 || got.Talk[0].To.Address != shell0 || got.Talk[0].Text != "echo cli-talk-1" || got.Talk[1].Kind != "key" {
		t.Fatalf("entries from the client: %+v", got.Talk)
	}
	// Outside tmux, or with --from none: nobody.
	if _, errs, code := e.runClient(outside, "send", shell0, "echo cli-nobody-1", "--agent-dir", a.dir); code != 0 {
		t.Fatalf("send outside: %d %q", code, errs)
	}
	if _, errs, code := e.runClient(inPane(id1), "send", shell0, "echo cli-nobody-2", "--from", "none", "--agent-dir", a.dir); code != 0 {
		t.Fatalf("send from none: %d %q", code, errs)
	}
	// Without an agent directory to name the host: nobody too.
	if _, errs, code := e.runClient(inPane(id1), "send", shell0, "echo cli-nobody-3", "--agent-dir", t.TempDir()); code != 0 {
		t.Fatalf("send without an agent directory: %d %q", code, errs)
	}
	if got := e.talk(full, ""); len(got.Talk) != 2 {
		t.Fatalf("writes from nobody made entries: %+v", got.Talk)
	}
	// --from and MUXWAY_FROM name the pane outright.
	if _, errs, code := e.runClient(outside, "key", shell1, "C-l", "--from", host+"/"+id0); code != 0 {
		t.Fatalf("key with --from: %d %q", code, errs)
	}
	if _, errs, code := e.runClient(append(outside, "MUXWAY_FROM="+host+"/"+id0), "send", shell1, "echo env-from"); code != 0 {
		t.Fatalf("send with MUXWAY_FROM: %d %q", code, errs)
	}
	if _, errs, code := e.runClient(outside, "send", shell1, "echo bad-from", "--from", "nonsense"); code == 0 || !strings.Contains(errs, "origin") {
		t.Fatalf("a bad --from is taken: %d %q", code, errs)
	}
	got = e.talk(full, "")
	if len(got.Talk) != 4 || got.Talk[2].Kind != "key" || got.Talk[2].From.PaneID != id0 || got.Talk[3].Text != "echo env-from" {
		t.Fatalf("entries with --from: %+v", got.Talk)
	}
	// The feed from the command line, and following it.
	out, errs, code := e.runClient(env, "talk")
	if code != 0 || !strings.Contains(out, "\t"+shell1+"\t"+shell0+"\ttext\techo cli-talk-1\n") || strings.Contains(out, "next") {
		t.Fatalf("client talk: %d %q %q", code, out, errs)
	}
	if out, _, _ := e.runClient(env, "talk", "--json"); !strings.Contains(out, `"kind":"text"`) {
		t.Fatalf("client talk --json: %q", out)
	}
	follow := exec.Command(bin, "client", "talk", "--follow")
	follow.Env = env
	fout, _ := follow.StdoutPipe()
	follow.Stderr = e.logFile("talk-follow")
	if err := follow.Start(); err != nil {
		t.Fatal(err)
	}
	defer follow.Process.Kill()
	rd := bufio.NewReader(fout)
	for i := 0; i < 4; i++ {
		if _, err := rd.ReadString('\n'); err != nil {
			t.Fatal(err)
		}
	}
	expect(t, e.input(full, shell0, map[string]any{"text": "echo followed", "from": from(host, id1)}), http.StatusNoContent, "a write while following")
	lineCh := make(chan string, 1)
	go func() { l, _ := rd.ReadString('\n'); lineCh <- l }()
	select {
	case l := <-lineCh:
		if !strings.HasSuffix(l, "\ttext\techo followed\n") {
			t.Fatalf("followed line: %q", l)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("--follow printed nothing")
	}

	// The MCP server in a pane: its writes come from it, and talk lists them.
	cmd := exec.Command(bin, "mcp", "--agent-dir", a.dir)
	cmd.Env = inPane(id1)
	stdin, _ := cmd.StdinPipe()
	stdout, _ := cmd.StdoutPipe()
	cmd.Stderr = e.logFile("mcp")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer cmd.Process.Kill()
	mrd := bufio.NewReader(stdout)
	send := func(line string) map[string]any {
		t.Helper()
		io.WriteString(stdin, line+"\n")
		raw, err := mrd.ReadString('\n')
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
	send(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}`)
	io.WriteString(stdin, `{"jsonrpc":"2.0","method":"notifications/initialized"}`+"\n")
	list := send(`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)
	if r, _ := list["result"].(map[string]any); r == nil || len(r["tools"].([]any)) != 11 {
		t.Fatalf("tools/list: %v", list)
	}
	if sent := send(`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"send_text","arguments":{"address":"` + shell0 + `","text":"echo via-mcp-talk"}}}`); text(sent) != "sent" {
		t.Fatalf("send_text: %v", sent)
	}
	got = e.talk(full, "")
	if l := got.Talk[len(got.Talk)-1]; l.From.PaneID != id1 || l.Text != "echo via-mcp-talk" {
		t.Fatalf("the MCP entry: %+v", l)
	}
	talk := send(`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"talk","arguments":{}}}`)
	if !strings.Contains(text(talk), shell1+" → "+shell0+"\ttext\techo via-mcp-talk") {
		t.Fatalf("talk tool: %v", talk)
	}
	stdin.Close()
	cmd.Wait()
}
