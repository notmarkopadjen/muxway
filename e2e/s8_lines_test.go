//go:build e2e

package e2e

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Lines: a text with newlines reaches the pane as one paste.

// 92
func TestSec92_TheNewlineIsTheOnlyControlByteAdmitted(t *testing.T) {
	e, ts, _ := basic(t)
	ts.must("new-window", "-t", "work:1", "-n", "ro", shell())
	ts.title("work:1.0")
	e.expose(ts, "work:1.0") // read-only
	reader := e.token("reader", []string{host + "/*"}, nil)
	writer := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	before := ts.capture("work:0.0")
	for _, text := range []string{"a\r\nb", "a\rb", "a\n\x1bb", "a\n\x7f", "a\n\u0085", "\x1b[200~a\nb\x1b[201~", "\n\x00"} {
		expect(t, e.input(writer, shell0, map[string]string{"text": text}), http.StatusBadRequest, fmt.Sprintf("text %q", text))
	}
	long := strings.Repeat("a\n", 2048) + "a"
	expect(t, e.input(writer, shell0, map[string]string{"text": long}), http.StatusBadRequest, "4097 bytes with newlines")
	two := map[string]string{"text": "echo one\necho two"}
	expect(t, e.input(reader, shell0, two), http.StatusForbidden, "read-only token")
	expect(t, e.input(writer, host+"/work/1.0", two), http.StatusForbidden, "read-only pane")
	time.Sleep(300 * time.Millisecond)
	if after := ts.capture("work:0.0"); after != before {
		t.Fatalf("pane changed:\n%s", after)
	}
	if out := ts.must("list-buffers"); out != "" {
		t.Fatalf("a buffer was left behind: %s", out)
	}
}

// 92
func TestFlow92_LinesArePastedAsOneBlock(t *testing.T) {
	e, ts, _ := basic(t)
	tok := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	lines := func() []string { return strings.Split(ts.capture("work:0.0"), "\n") }
	has := func(line string) bool {
		for _, l := range lines() {
			if l == line {
				return true
			}
		}
		return false
	}
	// bash with bracketed paste takes the lines as one block and waits for Enter.
	expect(t, e.input(tok, shell0, map[string]string{"text": "echo one\necho two"}), http.StatusNoContent, "two lines")
	waitFor(t, "block shown", func() bool { return has("echo two") })
	time.Sleep(300 * time.Millisecond)
	if has("one") {
		t.Fatalf("the first line ran before Enter:\n%s", ts.capture("work:0.0"))
	}
	expect(t, e.input(tok, shell0, map[string]string{"key": "Enter"}), http.StatusNoContent, "enter")
	waitFor(t, "both ran", func() bool { return has("one") && has("two") })
	if out := ts.must("list-buffers"); out != "" {
		t.Fatalf("the paste buffer was not deleted: %s", out)
	}
	// cat -v shows what it reads: the paste marks come from tmux when the
	// program asked for them, and only then.
	ts.must("send-keys", "-t", "work:0.0", "-l", `printf '\033[?2004h'; cat -v`)
	ts.must("send-keys", "-t", "work:0.0", "Enter")
	waitFor(t, "cat running", func() bool {
		return ts.must("display-message", "-p", "-t", "work:0.0", "#{pane_current_command}") == "cat"
	})
	expect(t, e.input(tok, shell0, map[string]string{"text": "a\nb"}), http.StatusNoContent, "bracketed")
	waitFor(t, "marks shown", func() bool {
		c := ts.capture("work:0.0")
		return strings.Contains(c, "^[[200~a") && strings.Contains(c, "b^[[201~")
	})
	ts.must("send-keys", "-t", "work:0.0", "C-c")
	ts.must("send-keys", "-t", "work:0.0", "-l", `printf '\033[?2004l'; cat -v`)
	ts.must("send-keys", "-t", "work:0.0", "Enter")
	time.Sleep(300 * time.Millisecond)
	expect(t, e.input(tok, shell0, map[string]string{"text": "c\nd"}), http.StatusNoContent, "plain")
	waitFor(t, "lines shown", func() bool { return strings.Contains(ts.capture("work:0.0"), "c\nd") })
	if c := ts.capture("work:0.0"); strings.Contains(c, "200~c") {
		t.Fatalf("marks without bracketed paste:\n%s", c)
	}
	// A text without a newline is typed as before, no buffer involved.
	expect(t, e.input(tok, shell0, map[string]string{"text": "typed"}), http.StatusNoContent, "typed")
	waitFor(t, "typed shown", func() bool { return strings.Contains(ts.capture("work:0.0"), "typed") })
	for _, name := range []string{"hub.log", "agent-" + host + ".log"} {
		logs, _ := os.ReadFile(filepath.Join(e.logs, name))
		if !strings.Contains(string(logs), "text_bytes=17 result=ok") || strings.Contains(string(logs), "echo one") {
			t.Fatalf("%s audit:\n%s", name, logs)
		}
	}
}
