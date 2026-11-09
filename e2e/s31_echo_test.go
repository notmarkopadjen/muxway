//go:build e2e

package e2e

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"testing"
)

// A key's echo rides on the input's answer: with read=1 the hub answers
// the pane's screen once the keys landed, as a read with the same lines
// and ansi would, to a token that may read the pane; otherwise 204.

var paneIDShape = regexp.MustCompile(`^%[0-9]{1,9}$`)

// 223
func TestSec223_ATokenThatMayNotReadThePaneGetsNoScreenWithItsInput(t *testing.T) {
	e, ts, _ := basic(t)
	out := keyEcho(t, ts)
	// A token reads one pane and writes every pane: the shell pane is not
	// its to see, so it is not its to type into either, with read=1 as
	// without, and nothing of the screen comes back.
	ts.split("work:0.0")
	e.expose(ts, "work:0.1")
	writeOnly := e.token("write-only", []string{host + "/work/0.1"}, []string{host + "/*"})
	r := e.post(writeOnly, "/v1/panes/"+shell0+"/input?read=1&lines=50&ansi=1", `{"text":"w"}`)
	expect(t, r, http.StatusNotFound, "a pane outside the read grant, with read=1")
	if strings.Contains(r.body, "content") || r.header.Get("Muxway-Pane") != "" || r.header.Get("ETag") != "" {
		t.Fatalf("something of the screen came back: %q %v", r.body, r.header)
	}
	if got := readKeys(out); got != "" {
		t.Fatalf("the refused input reached the pane: %q", got)
	}
}

// 224
func TestSec224_ABadReadParameterIsRefusedBeforeAnythingIsTyped(t *testing.T) {
	e, ts, _ := basic(t)
	out := keyEcho(t, ts)
	tok := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	for _, q := range []string{"read=1&lines=0", "read=1&lines=2001", "read=1&lines=x", "read=1&lines=-1"} {
		r := e.post(tok, "/v1/panes/"+shell0+"/input?"+q, `{"text":"n"}`)
		if r.status != http.StatusBadRequest || !strings.Contains(r.body, "bad_parameter") {
			t.Fatalf("%s: %d %s", q, r.status, r.body)
		}
	}
	if got := readKeys(out); got != "" {
		t.Fatalf("a refused input reached the pane: %q", got)
	}
	// Without read the parameter is not looked at, as before this.
	expect(t, e.post(tok, "/v1/panes/"+shell0+"/input?lines=0", `{"text":"n"}`), http.StatusNoContent, "lines without read")
	waitFor(t, "the key typed", func() bool { return readKeys(out) == "n" })
	// An input's answer is never 304, whatever ETag the client sends.
	r := e.do("POST", tok, "/v1/panes/"+shell0+"/input?read=1&lines=50", "", `{"text":"m"}`, "If-None-Match", `"anything"`)
	expect(t, r, http.StatusOK, "input with an If-None-Match")
	r = e.do("POST", tok, "/v1/panes/"+shell0+"/input?read=1&lines=50", "", `{"text":"m"}`, "If-None-Match", r.header.Get("ETag"))
	expect(t, r, http.StatusOK, "input with the last answer's ETag")
}

// 225
func TestSec225_ReadOnlyIsRefusedWithReadAsWithout(t *testing.T) {
	e, ts, _ := basic(t)
	ts.split("work:0.0")
	e.expose(ts, "work:0.1")
	tok := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	reader := e.token("reader", []string{host + "/*"}, nil)
	for _, c := range []struct {
		tok, pane string
	}{{reader, shell0}, {tok, host + "/work/0.1"}} {
		r := e.post(c.tok, "/v1/panes/"+c.pane+"/input?read=1&lines=50", `{"text":"r"}`)
		expect(t, r, http.StatusForbidden, "read-only with read=1")
		if strings.Contains(r.body, "content") {
			t.Fatalf("a refusal carried the screen: %s", r.body)
		}
	}
}

// 226
func TestFlow226_AnInputWithReadAnswersTheScreenWithTheEcho(t *testing.T) {
	e, _, _ := basic(t)
	tok := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	r := e.post(tok, "/v1/panes/"+shell0+"/input?read=1&lines=50&ansi=1", `{"text":"echo-rides-along"}`)
	expect(t, r, http.StatusOK, "input with read=1")
	var got struct {
		Pane struct {
			Address string `json:"address"`
			PaneID  string `json:"pane_id"`
		}
		Content string
		Trimmed int
	}
	if err := json.Unmarshal([]byte(r.body), &got); err != nil {
		t.Fatalf("the answer is not a read's body: %v: %s", err, r.body)
	}
	if got.Pane.Address != shell0 || !paneIDShape.MatchString(got.Pane.PaneID) {
		t.Fatalf("the pane in the answer: %+v", got.Pane)
	}
	if !strings.Contains(got.Content, "echo-rides-along") {
		t.Fatalf("the screen in the answer does not show the text: %q", got.Content)
	}
	if r.header.Get("Muxway-Pane") != got.Pane.PaneID {
		t.Fatalf("Muxway-Pane %q, the pane %q", r.header.Get("Muxway-Pane"), got.Pane.PaneID)
	}
	if r.header.Get("ETag") == "" || r.header.Get("Content-Type") != "application/json" {
		t.Fatalf("headers: %v", r.header)
	}
	// The same read on its own agrees, trimmed included.
	read := e.get(tok, "/v1/panes/"+shell0+"?lines=50&ansi=1")
	expect(t, read, http.StatusOK, "the read after")
	var again struct{ Content string }
	json.Unmarshal([]byte(read.body), &again)
	if !strings.Contains(again.Content, "echo-rides-along") {
		t.Fatalf("the read after the input: %q", again.Content)
	}
}

// 227
func TestFlow227_WithoutReadOrInTextModeTheInputAnswers204(t *testing.T) {
	e, _, _ := basic(t)
	tok := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	r := e.post(tok, "/v1/panes/"+shell0+"/input", `{"text":"plain"}`)
	expect(t, r, http.StatusNoContent, "input without read")
	if r.body != "" {
		t.Fatalf("a body without read: %q", r.body)
	}
	r = e.do("POST", tok, "/v1/panes/"+shell0+"/input?read=1&lines=50", "text/plain", `{"text":"text"}`)
	expect(t, r, http.StatusNoContent, "input with read=1 in text mode")
	if r.body != "" {
		t.Fatalf("a body in text mode: %q", r.body)
	}
	// Audit as before: the input's line, no read's.
}
