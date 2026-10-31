package agent

import (
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

func TestDetectHarness(t *testing.T) {
	cases := []struct {
		command, title, want string
	}{
		{"claude", "claude", "claude"},
		{"node", "✳ fixing the build", "claude"},
		{"codex", "codex", "codex"},
		{"gemini", "", "gemini"},
		{"node", "Gemini - ~/work", "gemini"},
		{"agy", "notes", "agy"},
		{"node", "Antigravity CLI", "agy"},
		{"node", "copilot", "copilot"},
		{"opencode", "x", "opencode"},
		{"aider", "", "aider"},
		{"cursor-agent", "", "cursor-agent"},
		{"bash", "gemini notes", ""},
		{"vim", "✳ a", ""},
		{"node", "server.js", ""},
	}
	for _, c := range cases {
		got := ""
		if h := detectHarness(c.command, c.title); h != nil {
			got = h.name
		}
		if got != c.want {
			t.Errorf("%q %q: got %q, want %q", c.command, c.title, got, c.want)
		}
	}
}

// Synthetic screens, as these CLIs draw them.
const (
	claudePermission = `● Bash(make test)
  ⎿  Running…

╭─────────────────────────────────────────────╮
│ Do you want to proceed?                      │
│ ❯ 1. Yes                                     │
│   2. Yes, and don't ask again for make       │
│   3. No, and tell Claude what to do          │
╰─────────────────────────────────────────────╯
  Esc to cancel`
	claudeQuestion = `● Which database should the service use?

  ❯ 1. PostgreSQL
    2. SQLite
    3. Type something else

  Enter to select · ↑↓ to move`
	claudeIdle = `● Done. The tests pass.

╭──────────────────────────────────────────────╮
│ ❯                                            │
╰──────────────────────────────────────────────╯
  ? for shortcuts`
	claudeWorking = `● Running the tests…
  ⎿  ok  internal/hub  0.3s
  ⎿  ok  internal/agent  0.1s
✶ Thinking… (12s · ↑ 1.2k tokens)`
	codexPermission = `codex wants to run: rm -rf build/
Allow command?
  › 1. Yes
    2. Yes, and don't ask again this session
    3. No`
	codexIdle = `codex: done, the build passes.

› `
	aiderPermission  = `Add src/main.py to the chat? (Y)es/(N)o/(D)on't ask again [Yes]: `
	geminiPermission = `Allow execution of: 'npm test'?
 ● 1. Yes, allow once
   2. Yes, allow always
   3. No`
	plainShell = `alice@laptop:~/work$ make test
ok
alice@laptop:~/work$ `
	// Antigravity CLI at rest: a bare > between rules, the hints under it.
	agyIdle = `      ▄▀▀▄        Antigravity CLI 1.4.12
     ▀▀▀▀▀▀       alice@example.com (Google AI Pro)
 ┃ Verbosity now defaults to medium
 ┃ esc to dismiss
────────────────────────────────────────────
>
────────────────────────────────────────────
? for shortcuts                                      Gemini · medium`
	agyPermission = `Allow run_command: make test?
 ● 1. Yes, once
   2. Yes, always
   3. No
────────────────────────────────────────────
? for shortcuts                                      Gemini · medium`
)

func TestClassify(t *testing.T) {
	cases := []struct {
		harness, screen string
		waiting         string
		atPrompt        bool
	}{
		{"claude", claudePermission, "permission", false},
		{"claude", claudeQuestion, "question", false},
		{"claude", claudeIdle, "", true},
		{"claude", claudeWorking, "", false},
		{"codex", codexPermission, "permission", false},
		{"codex", codexIdle, "", true},
		{"aider", aiderPermission, "", false},
		{"gemini", geminiPermission, "permission", false},
		{"claude", plainShell, "", false},
		{"agy", agyIdle, "", true},
		{"agy", agyPermission, "permission", false},
		{"claude", "", "", false},
	}
	for _, c := range cases {
		h := detectHarness(c.harness, "")
		s := classify(h, strings.Split(c.screen, "\n"))
		if s.waiting != c.waiting || s.atPrompt != c.atPrompt {
			t.Errorf("%s:\n%s\ngot %+v, want waiting %q atPrompt %v", c.harness, c.screen, s, c.waiting, c.atPrompt)
		}
	}
}

func TestWatchPane(t *testing.T) {
	a := &Agent{log: slog.New(slog.DiscardHandler), attention: map[string]tmux.Attention{}, watched: map[string]*watched{}, hooked: map[string]bool{}, asks: map[string]*pendingAsk{}}
	h := detectHarness("claude", "")
	p := tmux.Pane{PaneID: "%1", Command: "claude", Mode: tmux.ModeWrite}
	now := time.Unix(1_700_000_000, 0)
	step := func(screen string, after time.Duration, wantKind string) {
		t.Helper()
		now = now.Add(after)
		kind, text := a.watchPane(p, h, screen, now)
		if kind != wantKind {
			t.Fatalf("after %s with:\n%s\ngot %q %q, want %q", after, screen, kind, text, wantKind)
		}
		if kind != "" && kind != wire.KindWorking && text == "" {
			t.Fatalf("%s without its phrase", kind)
		}
		for _, row := range strings.Split(screen, "\n") {
			if row != "" && strings.Contains(text, strings.TrimSpace(row)) {
				t.Fatalf("a row of the screen travelled: %q", text)
			}
		}
	}
	// The first look at a quiet prompt says nothing.
	step(claudeIdle, 0, "")
	step(claudeIdle, 2*time.Second, "")
	// The screen moves: working, said once.
	step(claudeWorking, 2*time.Second, wire.KindWorking)
	step(claudeWorking+"\n  ⎿  more", 2*time.Second, "")
	// A permission prompt: waiting, said once.
	step(claudePermission, 2*time.Second, wire.KindPermission)
	step(claudePermission, 2*time.Second, "")
	// Answered on the host: the screen moves again.
	step(claudeWorking, 2*time.Second, wire.KindWorking)
	// Still at the prompt, but not for long enough.
	step(claudeIdle, 2*time.Second, "")
	step(claudeIdle, 4*time.Second, "")
	// Eight seconds still at the prompt: done, once.
	step(claudeIdle, 4*time.Second, wire.KindDone)
	step(claudeIdle, 10*time.Second, "")
	// Still for long but not at a prompt (a long tool run with quiet output): nothing.
	step(claudeWorking, 2*time.Second, wire.KindWorking)
	step(claudeWorking, 20*time.Second, "")
	// A question seen on the very first look is reported.
	q := tmux.Pane{PaneID: "%2", Command: "claude", Mode: tmux.ModeWrite}
	if kind, _ := a.watchPane(q, h, claudeQuestion, now); kind != wire.KindQuestion {
		t.Fatalf("first look at a question: %q", kind)
	}
}

// A pane whose hooks have spoken keeps working and done to them; the
// watcher still raises a prompt the hooks said nothing about, and takes
// it back when the screen moves on.
func TestWatchPaneHooked(t *testing.T) {
	a := &Agent{log: slog.New(slog.DiscardHandler), attention: map[string]tmux.Attention{}, watched: map[string]*watched{}, hooked: map[string]bool{"%1": true}, asks: map[string]*pendingAsk{}}
	h := detectHarness("agy", "")
	p := tmux.Pane{PaneID: "%1", Command: "agy", Mode: tmux.ModeWrite}
	now := time.Unix(1_700_000_000, 0)
	step := func(screen string, after time.Duration, want string) {
		t.Helper()
		now = now.Add(after)
		if kind, _ := a.watchPane(p, h, screen, now); kind != want {
			t.Fatalf("hooked, after %s:\n%s\ngot %q, want %q", after, screen, kind, want)
		}
	}
	// The screen moving says nothing: the hooks report working.
	step(agyIdle, 0, "")
	step(agyIdle+"\nmore", 2*time.Second, "")
	step(agyIdle+"\nmore\nand more", 2*time.Second, "")
	// Still for long at the prompt: no done either.
	step(agyIdle, 10*time.Second, "")
	// A prompt the hooks did not report: raised, once.
	step(agyPermission, 2*time.Second, wire.KindPermission)
	step(agyPermission, 2*time.Second, "")
	// Answered on the host: the watcher clears what it raised, once.
	step(agyIdle, 2*time.Second, wire.KindWorking)
	step(agyIdle+"\nx", 2*time.Second, "")
	// A prompt the hooks did report (attention already there) is left alone.
	a.attention["%1"] = tmux.Attention{Kind: wire.KindPermission, At: now.Unix(), Text: "from the hook"}
	step(agyPermission, 2*time.Second, "")
	// The hooks spoke again (a working notification): the watcher's own
	// marks are reset, so a prompt it had raised is not cleared by it.
	delete(a.attention, "%1")
	a.watched["%1"].state, a.watched["%1"].ownPrompt = "", false
	step(agyIdle, 2*time.Second, "")
}
