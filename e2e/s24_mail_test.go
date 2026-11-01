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

// Mail: a message held for a pane's process, never typed; read over the
// agent's socket, handed over by the Claude Code hooks, answered to the
// pane it came from.

type mailView struct {
	ID    uint64 `json:"id"`
	At    int64  `json:"at"`
	Actor struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"actor"`
	From    *talkEnd `json:"from"`
	Text    string   `json:"text"`
	ReadAt  int64    `json:"read_at"`
	ReplyTo uint64   `json:"reply_to"`
	Replied bool     `json:"replied"`
}

type feedView struct {
	Talk []struct {
		Seq     uint64   `json:"seq"`
		From    *talkEnd `json:"from"`
		To      talkEnd  `json:"to"`
		Kind    string   `json:"kind"`
		Text    string   `json:"text"`
		ID      uint64   `json:"id"`
		ReplyTo uint64   `json:"reply_to"`
		Actor   struct {
			Name string `json:"name"`
		} `json:"actor"`
	} `json:"talk"`
}

func (e *env) mail(tok, address, text string, from map[string]string) resp {
	body := map[string]any{"text": text}
	if from != nil {
		body["from"] = from
	}
	raw, _ := json.Marshal(body)
	return e.post(tok, "/v1/panes/"+address+"/mail", string(raw))
}

func (e *env) mailbox(tok, address string) []mailView {
	e.t.Helper()
	r := e.get(tok, "/v1/panes/"+address+"/mail")
	expect(e.t, r, http.StatusOK, "mailbox "+address)
	var v struct {
		Mail []mailView `json:"mail"`
	}
	json.Unmarshal([]byte(r.body), &v)
	return v.Mail
}

func (e *env) feed(tok string) feedView {
	e.t.Helper()
	r := e.get(tok, "/v1/talk?limit=100")
	expect(e.t, r, http.StatusOK, "talk")
	var v feedView
	json.Unmarshal([]byte(r.body), &v)
	return v
}

// unread is the listing's mail count for a pane, 0 without one.
func (e *env) unread(tok, address string) int {
	e.t.Helper()
	var list struct {
		Panes []struct {
			Address string `json:"address"`
			Mail    *struct {
				Unread int `json:"unread"`
			} `json:"mail"`
		} `json:"panes"`
	}
	r := e.get(tok, "/v1/panes")
	expect(e.t, r, http.StatusOK, "panes")
	json.Unmarshal([]byte(r.body), &list)
	for _, p := range list.Panes {
		if p.Address == address && p.Mail != nil {
			return p.Mail.Unread
		}
	}
	return 0
}

// readMail runs muxway mail for a pane through the agent's socket.
func (e *env) readMail(a *agentProc, pane string, args ...string) (string, string, int) {
	// The verb leads, the flags follow: muxway mail reply ID TEXT --dir ...
	cmd := exec.Command(bin, append(append([]string{"mail"}, args...), "--dir", a.dir, "--pane", pane)...)
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

// hookOut runs a Claude Code hook payload through notify and returns its stdout.
func (e *env) hookOut(a *agentProc, pane, payload string) string {
	e.t.Helper()
	cmd := exec.Command(bin, "notify", "--from", "claude-code", "--dir", a.dir, "--pane", pane)
	cmd.Stdin = strings.NewReader(payload)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = e.logFile("hook")
	if err := cmd.Run(); err != nil {
		e.t.Fatalf("hook: %v", err)
	}
	return out.String()
}

// 110
func TestSec110_MailNeedsTheWriteGrantAndIsNeverTyped(t *testing.T) {
	e, ts, a := basic(t)
	ts.split("work:0.0")
	ts.split("work:0.0")
	ts.split("work:0.0")
	e.expose(ts, "work:0.1") // read-only
	e.expose(ts, "work:0.2", "--write")
	// work:0.3 stays hidden.
	shell2 := host + "/work/0.2"
	id0, id1, id3 := paneIDOf(ts, "work:0.0"), paneIDOf(ts, "work:0.1"), paneIDOf(ts, "work:0.3")
	full := e.token("full", []string{"*"}, []string{"*"})
	reader := e.token("reader", []string{"*"}, nil)
	narrow := e.token("narrow", []string{shell0}, []string{shell0})

	expect(t, e.mail(reader, shell0, "mailcanary1", nil), http.StatusForbidden, "mail without the write grant")
	expect(t, e.mail(full, host+"/work/0.1", "mailcanary2", nil), http.StatusForbidden, "mail to a read-only pane")
	expect(t, e.mail(narrow, shell2, "mailcanary3", nil), http.StatusNotFound, "mail to a pane the token may not see")
	expect(t, e.mail(full, host+"/work/0.3", "mailcanary4", nil), http.StatusNotFound, "mail to a hidden pane")
	expect(t, e.mail("", shell0, "mailcanary5", nil), http.StatusUnauthorized, "no token")
	bad := []struct {
		what string
		body string
	}{
		{"control characters", `{"text":"a\u001b[2Jb"}`},
		{"too long", `{"text":"` + strings.Repeat("x", 4001) + `"}`},
		{"empty", `{"text":""}`},
		{"no text", `{}`},
		{"an unknown field", `{"text":"x","typed":true}`},
		{"a bad origin", `{"text":"x","from":{"host":"Bad Host","pane_id":"%1"}}`},
		{"not json", `x`},
	}
	for _, c := range bad {
		expect(t, e.post(full, "/v1/panes/"+shell0+"/mail", c.body), http.StatusBadRequest, c.what)
	}
	expect(t, e.mail(full, shell0, "mailcanary6", from(host, id3)), http.StatusNotFound, "an origin the token may not see")
	expect(t, e.mail(narrow, shell0, "mailcanary7", from(host, id1)), http.StatusNotFound, "an origin the narrow token may not see")
	if n := e.unread(full, shell0); n != 0 {
		t.Fatalf("refused mail counted: %d", n)
	}
	if f := e.feed(full); len(f.Talk) != 0 {
		t.Fatalf("refused mail made entries: %+v", f.Talk)
	}

	// Taken: from a read-only origin is fine, nothing is typed, the count shows.
	r := e.mail(full, shell0, "mailcanary8 first", from(host, id1))
	expect(t, r, http.StatusCreated, "mail from a read-only pane")
	var made struct {
		Mail struct {
			ID uint64 `json:"id"`
			At int64  `json:"at"`
		} `json:"mail"`
	}
	json.Unmarshal([]byte(r.body), &made)
	if made.Mail.ID == 0 || made.Mail.At == 0 {
		t.Fatalf("created: %s", r.body)
	}
	time.Sleep(300 * time.Millisecond)
	if out := ts.capture("work:0.0"); strings.Contains(out, "mailcanary") {
		t.Fatalf("mail was typed:\n%s", out)
	}
	if n := e.unread(full, shell0); n != 1 {
		t.Fatalf("unread: %d", n)
	}
	// Who sees the mailbox: a reader of the pane; the origin only where readable.
	expect(t, e.get(narrow, "/v1/panes/"+shell2+"/mail"), http.StatusNotFound, "a mailbox the token may not read")
	if box := e.mailbox(narrow, shell0); len(box) != 1 || box[0].From != nil || box[0].Text != "mailcanary8 first" || box[0].ReadAt != 0 {
		t.Fatalf("the narrow reader's view: %+v", box)
	}
	if box := e.mailbox(reader, shell0); len(box) != 1 || box[0].From == nil || box[0].From.PaneID != id1 || box[0].Actor.Name != "full" {
		t.Fatalf("the reader's view: %+v", box)
	}
	if f := e.feed(narrow); len(f.Talk) != 0 {
		t.Fatalf("the feed for a token that reads one side: %+v", f.Talk)
	}
	if f := e.feed(reader); len(f.Talk) != 1 || f.Talk[0].Kind != "mail" || f.Talk[0].ID != made.Mail.ID || f.Talk[0].From.PaneID != id1 {
		t.Fatalf("the feed: %+v", f.Talk)
	}
	// A reply to a mail nobody sent, from a pane that holds nothing.
	if _, errs, code := e.readMail(a, id0, "reply", "999", "nope"); code == 0 || !strings.Contains(errs, "no such mail") {
		t.Fatalf("a reply to an unknown id: %d %q", code, errs)
	}
	// A mail from no pane cannot be answered over the socket.
	expect(t, e.mail(full, shell0, "from the web", nil), http.StatusCreated, "mail from a client")
	box := e.mailbox(full, shell0)
	if len(box) != 2 || box[1].From != nil {
		t.Fatalf("a client's mail: %+v", box)
	}
	if _, errs, code := e.readMail(a, id0, "reply", fmt.Sprint(box[1].ID), "who?"); code == 0 || !strings.Contains(errs, "no pane") {
		t.Fatalf("a reply to a client's mail: %d %q", code, errs)
	}
	// Full: the 51st is refused; the burst is paced under the token's rate.
	for i := 2; i < 50; i++ {
		expect(t, e.mail(full, shell0, fmt.Sprintf("fill %d", i), nil), http.StatusCreated, fmt.Sprintf("mail %d", i))
		time.Sleep(60 * time.Millisecond)
	}
	expect(t, e.mail(full, shell0, "one too many", nil), http.StatusConflict, "the 51st mail")
	if r := e.mail(full, shell0, "one too many", nil); !strings.Contains(r.body, "mailbox_full") {
		t.Fatalf("the code: %s", r.body)
	}
	// The screen still has none of it; the logs have ids and sizes, no text.
	if out := ts.capture("work:0.0"); strings.Contains(out, "mailcanary") || strings.Contains(out, "fill ") {
		t.Fatalf("mail was typed:\n%s", out)
	}
	hubLog, _ := os.ReadFile(filepath.Join(e.logs, "hub.log"))
	agentLog, _ := os.ReadFile(filepath.Join(e.logs, "agent-"+host+".log"))
	for _, l := range [][]byte{hubLog, agentLog} {
		if bytes.Contains(l, []byte("mailcanary")) || bytes.Contains(l, []byte("from the web")) || bytes.Contains(l, []byte(full)) {
			t.Fatal("a text or a token is in a log")
		}
	}
	for _, want := range []string{"msg=\"audit mail\"", "result=read_only", "result=mailbox_full", fmt.Sprintf("mail=%d", made.Mail.ID), "kind=mail"} {
		if !bytes.Contains(hubLog, []byte(want)) {
			t.Fatalf("hub log lacks %q", want)
		}
	}
	if !bytes.Contains(agentLog, []byte("op=mail")) || !bytes.Contains(agentLog, []byte("text_bytes=17")) {
		t.Fatalf("agent audit lacks the mail:\n%s", agentLog)
	}
}

// 111
func TestMailReachesTheProcessAndComesBack(t *testing.T) {
	e, ts, a := basic(t)
	ts.split("work:0.0")
	e.expose(ts, "work:0.1", "--write")
	shell1 := host + "/work/0.1"
	id0, id1 := paneIDOf(ts, "work:0.0"), paneIDOf(ts, "work:0.1")
	full := e.token("full", []string{"*"}, []string{"*"})
	env := e.clientEnv(full)
	inPane := func(id string) []string { return append(append([]string{}, env...), "TMUX_PANE="+id) }

	// From the command line in 0.1, to 0.0: the origin is found.
	out, errs, code := e.runClient(inPane(id1), "mail", shell0, "run the tests, then tell me", "--agent-dir", a.dir)
	if code != 0 || !strings.HasPrefix(out, "mail ") {
		t.Fatalf("client mail: %d %q %q", code, out, errs)
	}
	var id uint64
	fmt.Sscanf(out, "mail %d", &id)
	if n := e.unread(full, shell0); n != 1 {
		t.Fatalf("unread after the mail: %d", n)
	}
	// Nothing on the screen; the process reads it over the socket.
	time.Sleep(200 * time.Millisecond)
	if strings.Contains(ts.capture("work:0.0"), "run the tests") {
		t.Fatal("mail was typed")
	}
	got, errs, code := e.readMail(a, id0)
	want := fmt.Sprintf("--- %d  ", id)
	if code != 0 || !strings.HasPrefix(got, want) || !strings.Contains(got, "  from "+shell1+"  (full)\nrun the tests, then tell me\n\n") {
		t.Fatalf("muxway mail: %d %q %q", code, got, errs)
	}
	// The listing follows within its second of cache.
	waitFor(t, "the count cleared", func() bool { return e.unread(full, shell0) == 0 })
	if got, _, _ := e.readMail(a, id0); got != "" {
		t.Fatalf("read mail printed again: %q", got)
	}
	if got, _, _ := e.readMail(a, id0, "--all"); !strings.Contains(got, "run the tests") {
		t.Fatalf("--all leaves out the read mail: %q", got)
	}
	if box := e.mailbox(full, shell0); len(box) != 1 || box[0].ReadAt == 0 {
		t.Fatalf("read_at after the read: %+v", box)
	}
	// Text mode of the mailbox, and from the command line.
	r := e.getText(full, "/v1/panes/"+shell0+"/mail")
	expect(t, r, http.StatusOK, "mailbox text")
	if !strings.HasPrefix(r.body, fmt.Sprintf("%d\t", id)) || !strings.Contains(r.body, "\t"+shell1+"\tfull\t") || !strings.HasSuffix(r.body, "\trun the tests, then tell me\n") {
		t.Fatalf("text mode: %q", r.body)
	}
	if out, _, code := e.runClient(env, "mailbox", shell0); code != 0 || out != r.body {
		t.Fatalf("client mailbox: %d %q", code, out)
	}
	// --wait blocks until one comes; --peek marks nothing.
	waited := make(chan string, 1)
	go func() {
		got, _, _ := e.readMail(a, id0, "--wait", "--timeout", "20s")
		waited <- got
	}()
	time.Sleep(500 * time.Millisecond)
	expect(t, e.mail(full, shell0, "second one", from(host, id1)), http.StatusCreated, "a second mail")
	select {
	case got := <-waited:
		if !strings.Contains(got, "second one") {
			t.Fatalf("waited: %q", got)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("--wait did not return")
	}
	if _, errs, code := e.readMail(a, id0, "--wait", "--timeout", "1s"); code != 2 || !strings.Contains(errs, "nothing came") {
		t.Fatalf("--wait timing out: %d %q", code, errs)
	}
	expect(t, e.mail(full, shell0, "third one", nil), http.StatusCreated, "a third mail")
	if got, _, _ := e.readMail(a, id0, "--peek"); !strings.Contains(got, "third one") || strings.Contains(got, "second one") {
		t.Fatalf("--peek: %q", got)
	}
	waitFor(t, "the count after --peek", func() bool { return e.unread(full, shell0) == 1 })
	// The Stop hook hands the mail over as the reason to go on, and the
	// pane is working, not done; with nothing waiting, done and silence.
	hooked := e.hookOut(a, id0, `{"hook_event_name":"Stop","stop_hook_active":false}`)
	var decision struct {
		Decision string `json:"decision"`
		Reason   string `json:"reason"`
	}
	if err := json.Unmarshal([]byte(hooked), &decision); err != nil || decision.Decision != "block" ||
		!strings.Contains(decision.Reason, "third one") || !strings.Contains(decision.Reason, "muxway mail reply") {
		t.Fatalf("the Stop hook's output: %q", hooked)
	}
	waitFor(t, "working after the mail", func() bool { return e.attention(full, shell0) == "" })
	if strings.Contains(e.get(full, "/v1/events").body, "third one") {
		t.Fatal("the mail's text travelled as an event")
	}
	if hooked := e.hookOut(a, id0, `{"hook_event_name":"Stop","stop_hook_active":false}`); hooked != "" {
		t.Fatalf("the Stop hook spoke without mail: %q", hooked)
	}
	waitFor(t, "done", func() bool { return e.attention(full, shell0) == "done" })
	// The next prompt carries what came meanwhile.
	expect(t, e.mail(full, shell0, "for the prompt", from(host, id1)), http.StatusCreated, "mail before a prompt")
	if hooked := e.hookOut(a, id0, `{"hook_event_name":"UserPromptSubmit","prompt":"secret plans"}`); !strings.Contains(hooked, "for the prompt") || strings.HasPrefix(hooked, "{") {
		t.Fatalf("the prompt hook's output: %q", hooked)
	}
	// Replies go back to the sender's pane, once.
	if out, errs, code := e.readMail(a, id0, "reply", fmt.Sprint(id), "tests green, two warnings"); code != 0 || out != "replied\n" {
		t.Fatalf("reply: %d %q %q", code, out, errs)
	}
	back := e.mailbox(full, shell1)
	if len(back) != 1 || back[0].ReplyTo != id || back[0].Text != "tests green, two warnings" || back[0].From == nil || back[0].From.PaneID != id0 || back[0].Actor.Name != "reply" {
		t.Fatalf("the reply in 0.1's box: %+v", back)
	}
	if got, _, _ := e.readMail(a, id1); !strings.Contains(got, fmt.Sprintf("  from %s  (reply)  reply to %d\ntests green", shell0, id)) {
		t.Fatalf("the reply as read: %q", got)
	}
	if _, errs, code := e.readMail(a, id0, "reply", fmt.Sprint(id), "again"); code == 0 || !strings.Contains(errs, "answered already") {
		t.Fatalf("a second reply: %d %q", code, errs)
	}
	if box := e.mailbox(full, shell0); !box[0].Replied {
		t.Fatalf("the mail is not marked replied: %+v", box[0])
	}
	f := e.feed(full)
	last := f.Talk[len(f.Talk)-1]
	if last.Kind != "mail" || last.ReplyTo != id || last.From.PaneID != id0 || last.To.PaneID != id1 || last.Actor.Name != "reply" {
		t.Fatalf("the reply's entry: %+v", last)
	}
	if f.Talk[0].ID != id || f.Talk[0].Text != "run the tests, then tell me" {
		t.Fatalf("the first entry: %+v", f.Talk[0])
	}
	// A client's mail has no origin in the feed; the partners come from mail too.
	for _, en := range f.Talk {
		if en.Text == "third one" && en.From != nil {
			t.Fatalf("a client's mail with an origin: %+v", en)
		}
	}
	if p := e.partners(full, shell0); len(p) != 1 || p[0].PaneID != id1 || p[0].Way != "both" {
		t.Fatalf("partners: %+v", p)
	}
	if out, _, code := e.runClient(env, "talk"); code != 0 || !strings.Contains(out, "\t"+shell1+"\t"+shell0+"\tmail\trun the tests, then tell me\n") || !strings.Contains(out, "\t\t"+shell0+"\tmail\tthird one\n") {
		t.Fatalf("client talk: %q", out)
	}

	// The MCP server in 0.1: mail, mailbox, my_mail.
	cmd := exec.Command(bin, "mcp", "--agent-dir", a.dir)
	cmd.Env = inPane(id1)
	stdin, _ := cmd.StdinPipe()
	stdout, _ := cmd.StdoutPipe()
	cmd.Stderr = e.logFile("mcp-mail")
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
	if sent := send(`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"mail","arguments":{"address":"` + shell0 + `","text":"via mcp"}}}`); !strings.HasPrefix(text(sent), "mailed, id ") {
		t.Fatalf("mail: %v", sent)
	}
	if box := send(`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"mailbox","arguments":{"address":"` + shell0 + `"}}}`); !strings.Contains(text(box), "\tvia mcp\n") {
		t.Fatalf("mailbox: %v", box)
	}
	if mine := send(`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"my_mail","arguments":{}}}`); text(mine) != "no mail" {
		t.Fatalf("my_mail with nothing new: %v", mine)
	}
	go func() {
		time.Sleep(500 * time.Millisecond)
		e.mail(full, shell1, "wake up", nil)
	}()
	if mine := send(`{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"my_mail","arguments":{"timeout_seconds":10}}}`); !strings.Contains(text(mine), "wake up") {
		t.Fatalf("my_mail waiting: %v", mine)
	}
	waitFor(t, "my_mail marked it read", func() bool { return e.unread(full, shell1) == 0 })
}

// 112
func TestMailBetweenTwoHosts(t *testing.T) {
	e, ts, a := basic(t)
	ts2 := newTmux(t)
	b := e.pairAgent("bob-desktop", ts2)
	e.expose(ts2, "work:0.0", "--write")
	bob := "bob-desktop/work/0.0"
	idA, idB := paneIDOf(ts, "work:0.0"), paneIDOf(ts2, "work:0.0")
	full := e.token("full", []string{"*"}, []string{"*"})
	alice := e.token("alice", []string{host + "/*"}, nil)

	r := e.mail(full, bob, "hello bob", from(host, idA))
	expect(t, r, http.StatusCreated, "alice to bob")
	var made struct {
		Mail struct {
			ID uint64 `json:"id"`
		} `json:"mail"`
	}
	json.Unmarshal([]byte(r.body), &made)
	if got, _, code := e.readMail(b, idB); code != 0 || !strings.Contains(got, "  from "+shell0+"  (full)\nhello bob\n") {
		t.Fatalf("bob reads: %d %q", code, got)
	}
	if out, errs, code := e.readMail(b, idB, "reply", fmt.Sprint(made.Mail.ID), "hello alice"); code != 0 {
		t.Fatalf("bob replies: %d %q %q", code, out, errs)
	}
	if got, _, code := e.readMail(a, idA); code != 0 || !strings.Contains(got, "  from "+bob+"  (reply)  reply to ") || !strings.Contains(got, "\nhello alice\n") {
		t.Fatalf("alice reads: %d %q", code, got)
	}
	f := e.feed(full)
	if len(f.Talk) != 2 || f.Talk[0].From.Host != host || f.Talk[0].To.Host != "bob-desktop" || f.Talk[1].From.Host != "bob-desktop" || f.Talk[1].ReplyTo != made.Mail.ID {
		t.Fatalf("the feed across hosts: %+v", f.Talk)
	}
	if p := e.partners(full, shell0); len(p) != 1 || p[0].Address != bob || p[0].Way != "both" {
		t.Fatalf("partners across hosts: %+v", p)
	}
	// A token that sees one host sees neither the entries nor the partner.
	if f := e.feed(alice); len(f.Talk) != 0 {
		t.Fatalf("the feed for one host: %+v", f.Talk)
	}
	if p := e.partners(alice, shell0); p != nil {
		t.Fatalf("a partner on a host the token may not see: %+v", p)
	}
	// Bob's host goes away: a reply to it fails and says so.
	expect(t, e.mail(full, shell0, "answer me", from("bob-desktop", idB)), http.StatusCreated, "bob to alice")
	stop(b.cmd)
	e.waitOnline("bob-desktop", false)
	box := e.mailbox(full, shell0)
	if _, errs, code := e.readMail(a, idA, "reply", fmt.Sprint(box[len(box)-1].ID), "too late"); code == 0 || !strings.Contains(errs, "host_offline") {
		t.Fatalf("a reply to an offline host: %d %q", code, errs)
	}
}
