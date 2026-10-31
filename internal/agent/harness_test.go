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
	aiderPermission = `Add src/main.py to the chat? (Y)es/(N)o/(D)on't ask again [Yes]: `
	geminiPermission = `Allow execution of: 'npm test'?
 ● 1. Yes, allow once
   2. Yes, allow always
   3. No`
	plainShell = `alice@laptop:~/work$ make test
ok
alice@laptop:~/work$ `
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
