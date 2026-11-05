//go:build e2e

package e2e

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

// Later: the owner parks a pane, every client sees it, the inbox lists
// it last, and coming back to the pane wakes it.

func (e *env) later(tok, address string, on bool) resp {
	return e.post(tok, "/v1/panes/"+address+"/later", fmt.Sprintf(`{"later":%v}`, on))
}

type laterPane struct {
	Address   string `json:"address"`
	Later     bool   `json:"later"`
	LaterAt   int64  `json:"later_at"`
	Attention *struct {
		Kind string `json:"kind"`
	} `json:"attention"`
}

// parked reports whether the listing says the pane is parked.
func (e *env) parked(tok, address string) bool {
	e.t.Helper()
	var list struct {
		Panes []laterPane `json:"panes"`
	}
	r := e.get(tok, "/v1/panes")
	expect(e.t, r, http.StatusOK, "panes")
	json.Unmarshal([]byte(r.body), &list)
	for _, p := range list.Panes {
		if p.Address == address {
			return p.Later
		}
	}
	return false
}

func (e *env) inboxAddresses(tok string) []string {
	e.t.Helper()
	var in struct {
		Inbox []laterPane `json:"inbox"`
		Count int         `json:"count"`
	}
	r := e.get(tok, "/v1/inbox")
	expect(e.t, r, http.StatusOK, "inbox")
	json.Unmarshal([]byte(r.body), &in)
	var out []string
	for _, p := range in.Inbox {
		out = append(out, p.Address)
	}
	if in.Count != len(out) {
		e.t.Fatalf("inbox count %d, %d listed", in.Count, len(out))
	}
	return out
}

// 188
func TestSec188_LaterNeedsTheWriteGrantAndABoolean(t *testing.T) {
	e, ts, _ := basic(t)
	ts.split("work:0.0")
	e.expose(ts, "work:0.1")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	reader := e.token("reader", []string{host + "/*"}, nil)
	expect(t, e.later(reader, shell0, true), http.StatusForbidden, "a reader parks")
	expect(t, e.later(full, host+"/work/0.1", true), http.StatusForbidden, "a writer on a read-only pane")
	expect(t, e.post(full, "/v1/panes/"+shell0+"/later", `{"later":"yes"}`), http.StatusBadRequest, "not a boolean")
	expect(t, e.post(full, "/v1/panes/"+shell0+"/later", `{"later":true,"text":"x"}`), http.StatusBadRequest, "an extra key")
	expect(t, e.post(full, "/v1/panes/"+shell0+"/later", `{}`), http.StatusBadRequest, "no value")
	expect(t, e.later(full, host+"/work/2.0", true), http.StatusNotFound, "no such pane")
	if e.parked(full, shell0) || e.parked(full, host+"/work/0.1") {
		t.Fatal("a refused request parked a pane")
	}
}

// 189
func TestSec189_LaterIsRateLimited(t *testing.T) {
	e, _, _ := basic(t)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	limited := false
	for i := 0; i < 6; i++ {
		if e.later(full, shell0, i%2 == 0).status == http.StatusTooManyRequests {
			limited = true
		}
	}
	if !limited {
		t.Fatal("six parkings in a second all went through")
	}
}

// 190
func TestSec190_LaterIsAuditedWithoutContent(t *testing.T) {
	e, ts, _ := basic(t)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	ts.must("send-keys", "-t", "work:0.0", "echo later-secret-on-screen", "Enter")
	expect(t, e.later(full, shell0, true), http.StatusNoContent, "park")
	expect(t, e.later(full, shell0, false), http.StatusNoContent, "wake")
	for _, f := range []string{"hub.log", "agent-" + host + ".log"} {
		raw, _ := os.ReadFile(filepath.Join(e.logs, f))
		log := string(raw)
		lines := regexp.MustCompile(`(?m)^.*later=(true|false).*$`).FindAllString(log, -1)
		if len(lines) < 2 {
			t.Fatalf("%s: audit lines for the parking and the waking missing:\n%s", f, log)
		}
		for _, l := range lines {
			if !strings.Contains(l, "pane=%") || !strings.Contains(l, "result=ok") {
				t.Fatalf("%s: audit line lacks the pane or the result: %s", f, l)
			}
		}
		if strings.Contains(log, "later-secret-on-screen") {
			t.Fatalf("%s carries pane content", f)
		}
	}
}

// 191
func TestFlow191_LaterShowsEverywhere(t *testing.T) {
	e, ts, a := basic(t)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	if _, err := e.notify(a, "--pane", paneIDOf(ts, "work:0.0"), "--kind", "done", "--text", "finished"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "attention", func() bool { return e.attention(full, shell0) == "done" })
	expect(t, e.later(full, shell0, true), http.StatusNoContent, "park")
	waitFor(t, "parked in the listing", func() bool { return e.parked(full, shell0) })
	for _, path := range []string{"/v1/hosts/" + host + "/tree", "/v1/panes/" + shell0, "/v1/inbox"} {
		r := e.get(full, path)
		expect(t, r, http.StatusOK, path)
		if !strings.Contains(r.body, `"later":true`) || !strings.Contains(r.body, `"kind":"done"`) {
			t.Fatalf("%s lacks the parking or the kind underneath: %s", path, r.body)
		}
	}
	if r := e.get(full, "/v1/hosts"); !strings.Contains(r.body, `"later":true`) {
		t.Fatalf("the host does not say it parks: %s", r.body)
	}
	for _, path := range []string{"/v1/panes", "/v1/inbox"} {
		r := e.getText(full, path)
		expect(t, r, http.StatusOK, path+" text")
		if !strings.Contains(r.body, shell0+"\t") || !strings.Contains(r.body, "\tlater\t") {
			t.Fatalf("%s text mode lacks the later column: %q", path, r.body)
		}
	}
	expect(t, e.later(full, shell0, false), http.StatusNoContent, "wake")
	waitFor(t, "awake", func() bool { return !e.parked(full, shell0) })
	if r := e.getText(full, "/v1/panes"); !strings.Contains(r.body, "\tdone\t") {
		t.Fatalf("the kind did not come back in text mode: %q", r.body)
	}
}

// 192
func TestFlow192_ComingBackWakesANotificationDoesNot(t *testing.T) {
	e, ts, a := basic(t)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	park := func(what string) {
		t.Helper()
		expect(t, e.later(full, shell0, true), http.StatusNoContent, "park before "+what)
		waitFor(t, "parked before "+what, func() bool { return e.parked(full, shell0) })
		time.Sleep(250 * time.Millisecond)
	}
	park("input")
	expect(t, e.input(full, shell0, map[string]any{"key": "Enter"}), http.StatusNoContent, "input")
	waitFor(t, "input wakes", func() bool { return !e.parked(full, shell0) })

	park("an answer")
	ask := e.ask(a, paneIDOf(ts, "work:0.0"), "30s", "deploy?", "yes", "no")
	waitFor(t, "question", func() bool { return e.attention(full, shell0) == "question" })
	if e.parked(full, shell0) == false {
		t.Fatal("a question woke the pane")
	}
	expect(t, e.answer(full, shell0, "yes"), http.StatusNoContent, "answer")
	ask.wait(t, 5*time.Second)
	waitFor(t, "an answer wakes", func() bool { return !e.parked(full, shell0) })

	park("mail")
	expect(t, e.mail(full, shell0, "read this later", nil), http.StatusCreated, "mail")
	waitFor(t, "mail wakes", func() bool { return !e.parked(full, shell0) })

	park("a notification")
	if _, err := e.notify(a, "--pane", paneIDOf(ts, "work:0.0"), "--kind", "permission", "--text", "may I?"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "permission", func() bool { return e.attention(full, shell0) == "permission" })
	if !e.parked(full, shell0) {
		t.Fatal("a notification woke the pane")
	}
	if _, err := e.notify(a, "--pane", paneIDOf(ts, "work:0.0"), "--kind", "working"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "working clears the attention", func() bool { return e.attention(full, shell0) == "" })
	if !e.parked(full, shell0) {
		t.Fatal("a working notice woke the pane")
	}
}

// 193
func TestFlow193_LaterSurvivesTheHubAndGoesWithThePane(t *testing.T) {
	e, ts, _ := basic(t)
	ts.split("work:0.0")
	e.expose(ts, "work:0.1", "--write")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	pane1 := host + "/work/0.1"
	expect(t, e.later(full, pane1, true), http.StatusNoContent, "park")
	waitFor(t, "parked", func() bool { return e.parked(full, pane1) })
	e.stopHub()
	e.startHub()
	e.waitOnline(host, true)
	waitFor(t, "still parked after the hub restart", func() bool { return e.parked(full, pane1) })
	ts.must("kill-pane", "-t", "work:0.1")
	waitFor(t, "the pane gone", func() bool {
		return !strings.Contains(e.get(full, "/v1/panes").body, `"address":"`+pane1+`"`)
	})
	ts.split("work:0.0")
	e.expose(ts, "work:0.1", "--write")
	waitFor(t, "a new pane at the address", func() bool {
		return strings.Contains(e.get(full, "/v1/panes").body, `"address":"`+pane1+`"`)
	})
	if e.parked(full, pane1) {
		t.Fatal("a new pane at the old address inherited the parking")
	}
}

// 194
func TestFlow194_TheInboxListsParkedPanesLast(t *testing.T) {
	e, ts, a := basic(t)
	for _, target := range []string{"work:0.0", "work:0.1", "work:0.2"} {
		ts.split(target)
	}
	for _, target := range []string{"work:0.1", "work:0.2", "work:0.3"} {
		e.expose(ts, target, "--write")
	}
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	p := func(i int) string { return fmt.Sprintf("%s/work/0.%d", host, i) }
	// Oldest first: 0.0 and 0.1 call, then 0.2 is parked quietly, then 0.3
	// calls and is parked, then 0.0 is parked too.
	notify := func(target, kind string) {
		t.Helper()
		if _, err := e.notify(a, "--pane", paneIDOf(ts, target), "--kind", kind, "--text", kind); err != nil {
			t.Fatal(err)
		}
		waitFor(t, target+" "+kind, func() bool {
			return e.attention(full, host+"/work/"+strings.TrimPrefix(target, "work:")) == kind
		})
		time.Sleep(1100 * time.Millisecond)
	}
	notify("work:0.0", "done")
	notify("work:0.1", "question")
	expect(t, e.later(full, p(2), true), http.StatusNoContent, "park 0.2")
	time.Sleep(1100 * time.Millisecond)
	notify("work:0.3", "permission")
	expect(t, e.later(full, p(3), true), http.StatusNoContent, "park 0.3")
	expect(t, e.later(full, p(0), true), http.StatusNoContent, "park 0.0")
	want := []string{p(1), p(0), p(2), p(3)}
	waitFor(t, "the inbox in order", func() bool {
		return strings.Join(e.inboxAddresses(full), " ") == strings.Join(want, " ")
	})
	rows := strings.Split(strings.TrimSpace(e.getText(full, "/v1/inbox").body), "\n")
	if len(rows) != 4 || !strings.HasPrefix(rows[2], p(2)+"\tlater\t") || !strings.HasPrefix(rows[3], p(3)+"\tlater\t") {
		t.Fatalf("text inbox: %q", rows)
	}
	if f := strings.Split(rows[2], "\t"); len(f) != 6 || f[2] == "0" || f[3] != "" || f[5] != "" {
		t.Fatalf("a parked pane without attention waits since its parking, with no text and nothing pending: %q", rows[2])
	}
	// The sixth column is what waits under a parked pane, so a keypad phone draws zz · !;
	// an awake pane's kind column says it already and its pending column stays empty.
	if f := strings.Split(rows[3], "\t"); len(f) != 6 || f[1] != "later" || f[5] != "permission" {
		t.Fatalf("a parked pane with a permission underneath: %q", rows[3])
	}
	if f := strings.Split(rows[0], "\t"); len(f) != 6 || f[1] != "question" || f[5] != "" {
		t.Fatalf("an awake pane's row: %q", rows[0])
	}
	if f := e.textRow(full, p(3)); f[4] != "later" || f[9] != "permission" {
		t.Fatalf("the listing's row of a parked pane: %q", f)
	}
	if f := e.textRow(full, p(1)); f[4] != "question" || f[9] != "" {
		t.Fatalf("the listing's row of an awake pane: %q", f)
	}
}

// 195
func TestSec195_TextHostsCarryTheFlagsOfVisibleHostsOnly(t *testing.T) {
	e, _, _ := basic(t)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	rows := strings.Split(strings.TrimSuffix(e.getText(full, "/v1/hosts").body, "\n"), "\n")
	if len(rows) != 1 {
		t.Fatalf("hosts: %q", rows)
	}
	f := strings.Split(rows[0], "\t")
	if len(f) != 3 || f[0] != host || f[1] != "online" {
		t.Fatalf("host row: %q", rows[0])
	}
	// The flags name what the agent takes, in the protocol's order, and nothing it does not.
	for _, want := range []string{"ask", "mail", "later", "rename", "keys2"} {
		if !strings.Contains("|"+f[2]+"|", "|"+want+"|") {
			t.Fatalf("flags %q lack %s", f[2], want)
		}
	}
	for _, not := range []string{"sessions", "close"} {
		if strings.Contains("|"+f[2]+"|", "|"+not+"|") {
			t.Fatalf("flags %q claim %s, which this agent does not take", f[2], not)
		}
	}
	// A token for another host sees no row, flags or not.
	other := e.token("other", []string{"bob-desktop/*"}, nil)
	if body := e.getText(other, "/v1/hosts").body; strings.Contains(body, host) {
		t.Fatalf("a token without the grant read the host's row: %q", body)
	}
}
