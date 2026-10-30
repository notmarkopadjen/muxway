//go:build e2e

package e2e

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// Keys by name: modifiers on any key, the keypad and chords, and nothing
// else. tmux types a name it does not know as text and reads ; as the end
// of a command, so every refusal must leave the pane untouched.

// keyEcho runs a program in the pane that writes every byte it reads, as
// Python's repr, into a file.
func keyEcho(t *testing.T, ts *tmuxServer) string { return keyEchoIn(t, ts, "work:0.0", false) }

// keyEchoIn is keyEcho in any pane; asking, the program first asks tmux
// for modified keys, as Claude Code does.
func keyEchoIn(t *testing.T, ts *tmuxServer, target string, asking bool) string {
	out := filepath.Join(t.TempDir(), "keys")
	prog := "import os,sys,tty\ntty.setraw(0)\n"
	if asking {
		prog += "sys.stdout.write('\\x1b[>4;2m'); sys.stdout.flush()\n"
	}
	prog += "f=open(sys.argv[1],'a')\nwhile True:\n  b=os.read(0,64)\n  f.write(repr(b)[2:-1]); f.flush()\n"
	script := filepath.Join(t.TempDir(), "echo.py")
	os.WriteFile(script, []byte(prog), 0o600)
	ts.must("respawn-pane", "-k", "-t", target, "python3", script, out)
	waitFor(t, "the echo program", func() bool {
		return ts.must("display-message", "-p", "-t", target, "#{pane_current_command}") == "python3"
	})
	return out
}

func readKeys(path string) string {
	b, _ := os.ReadFile(path)
	return string(b)
}

// 125
func TestSec125_KeyNamesOutsideTheGrammarAreRefused(t *testing.T) {
	e, ts, _ := basic(t)
	out := keyEcho(t, ts)
	tok := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	reader := e.token("reader", []string{host + "/*"}, nil)
	for _, key := range []string{"C-;", "M-;", "F13", "S-a", "M-C-a", "C-C-a", "KP10", "C-\x1b", "a",
		"C-a;kill-server", "C-a ; kill-server", "Up\n", "enter", "IC", strings.Repeat("C-", 500) + "a", "C-é", "M-#",
		"S-S-Enter", "Enter;kill-server", "C-M-S-PageDown1"} {
		expect(t, e.input(tok, shell0, map[string]string{"key": key}), http.StatusBadRequest, key)
	}
	expect(t, e.input(reader, shell0, map[string]string{"key": "C-M-Delete"}), http.StatusForbidden, "read-only token")
	expect(t, e.input("", shell0, map[string]string{"key": "C-M-Delete"}), http.StatusUnauthorized, "no token")
	if got := readKeys(out); got != "" {
		t.Fatalf("a refused key reached the pane: %q", got)
	}
	if _, err := ts.run("has-session", "-t", "work"); err != nil {
		t.Fatalf("the tmux server is gone: %v", err)
	}
}

// 126
func TestFlow126_KeysReachThePaneAsTheTerminalSendsThem(t *testing.T) {
	e, ts, _ := basic(t)
	out := keyEcho(t, ts)
	tok := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	for _, c := range []struct{ key, bytes string }{
		{"C-M-Delete", `\x1b[3;7~`}, {"S-Up", `\x1b[1;2A`}, {"M-S-F5", `\x1b[15;4~`}, {"S-F1", `\x1b[1;2P`},
		{"C-M-a", `\x1b\x01`}, {"M-'", `\x1b'`}, {"KP7", `7`}, {"KPEnter", `\n`}, {"C-c", `\x03`},
		{"Insert", `\x1b[2~`}, {"C-Right", `\x1b[1;5C`}, {"M-x", `\x1bx`}, {`C-\`, `\x1c`},
	} {
		before := len(readKeys(out))
		expect(t, e.input(tok, shell0, map[string]string{"key": c.key}), http.StatusNoContent, c.key)
		waitFor(t, c.key, func() bool { return len(readKeys(out)) > before })
		if got := readKeys(out)[before:]; got != c.bytes {
			t.Fatalf("%s reached the pane as %s, want %s", c.key, got, c.bytes)
		}
	}
	var hosts struct {
		Hosts []struct {
			Name string `json:"name"`
			Keys int    `json:"keys"`
		} `json:"hosts"`
	}
	r := e.get(tok, "/v1/hosts")
	if err := json.Unmarshal([]byte(r.body), &hosts); err != nil || len(hosts.Hosts) == 0 || hosts.Hosts[0].Keys != 2 {
		t.Fatalf("hosts do not say keys 2: %v %s", err, r.body)
	}
}

func extendedKeys(ts *tmuxServer) string {
	return strings.TrimSpace(ts.must("show-options", "-s", "-v", "extended-keys"))
}

// 178: the agent turns tmux's extended-keys on, so Shift+Enter reaches a
// program that asked for modified keys as a modified key and a program
// that did not ask still gets a plain Enter. The pane's process may
// change once only, so the plain program gets a pane of its own.
func TestFlow178_ShiftEnterReachesAProgramThatAsked(t *testing.T) {
	e, ts, _ := basic(t)
	waitFor(t, "extended-keys on", func() bool { return extendedKeys(ts) == "on" })
	ts.split("work:0.0")
	e.expose(ts, "work:0.1", "--write")
	asking := keyEchoIn(t, ts, "work:0.0", true)
	plain := keyEchoIn(t, ts, "work:0.1", false)
	tok := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	second := host + "/work/0.1"
	waitFor(t, "the second pane listed", func() bool { return e.get(tok, "/v1/panes/"+second).status == http.StatusOK })
	// Modified Enter in either encoding tmux has (extended-keys-format):
	// xterm's, the default, or CSI u.
	for _, c := range []struct {
		key   string
		bytes []string
	}{{"S-Enter", []string{`\x1b[27;2;13~`, `\x1b[13;2u`}}, {"Enter", []string{`\r`}}} {
		before := len(readKeys(asking))
		expect(t, e.input(tok, shell0, map[string]string{"key": c.key}), http.StatusNoContent, c.key)
		waitFor(t, c.key, func() bool { return len(readKeys(asking)) > before })
		if got := readKeys(asking)[before:]; !slices.Contains(c.bytes, got) {
			t.Fatalf("%s reached the asking program as %s, want one of %v", c.key, got, c.bytes)
		}
	}
	expect(t, e.input(tok, second, map[string]string{"key": "S-Enter"}), http.StatusNoContent, "S-Enter to a plain program")
	waitFor(t, "S-Enter", func() bool { return len(readKeys(plain)) > 0 })
	if got := readKeys(plain); got != `\r` {
		t.Fatalf("S-Enter reached a plain program as %s, want a carriage return", got)
	}
}

// 179: a server whose owner set extended-keys to always keeps it.
func TestFlow179_ExtendedKeysAlwaysIsLeftAlone(t *testing.T) {
	e := newEnv(t)
	ts := newTmux(t)
	ts.must("set-option", "-s", "extended-keys", "always")
	e.pairAgent(host, ts)
	e.expose(ts, "work:0.0", "--write")
	tok := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	expect(t, e.get(tok, "/v1/panes/"+shell0), http.StatusOK, "the agent listed the pane")
	if got := extendedKeys(ts); got != "always" {
		t.Fatalf("extended-keys is %q after the agent started", got)
	}
}
