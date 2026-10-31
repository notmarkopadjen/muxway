package agent

import (
	"regexp"
	"strings"
)

// The AI coding CLIs the watcher knows: how to tell one from the pane's
// command and title, and what its screen looks like when it waits.
// Everything here is a heuristic over a screen the owner can read anyway;
// the worst a screen can do is light a badge.

type harness struct {
	name string
	// title says the harness is there when the command is an interpreter.
	title *regexp.Regexp
	// permission and question match a row near the bottom; prompt is the
	// input prompt as the last row looks when the harness waits for a line.
	permission, question, prompt *regexp.Regexp
}

var (
	// A numbered choice as these CLIs draw one: "❯ 1. Yes", "  2. No".
	numbered = regexp.MustCompile(`^\s*[❯>›]?\s*[1-9][.)]\s+\S`)
	// Yes or no at the end of a line: "[y/N]", "(y/n)", "y/n?".
	yesNo = regexp.MustCompile(`(?i)[\[(]\s*y(es)?\s*/\s*n(o)?\s*[\])]|\by/n\??\s*$`)
	// A prompt row: the glyph these CLIs lead their input line with, alone
	// or with what was typed so far.
	promptRow = regexp.MustCompile(`^\s*[❯›>]\s*(\S.*)?$`)
	permWords = regexp.MustCompile(`(?i)\b(permission|allow|approve|proceed|run this|execute|apply this)\b`)
	// The hint these CLIs print under their prompt: "? for shortcuts",
	// "Esc to cancel", "Enter to select", "ctrl+c to quit".
	hintRow = regexp.MustCompile(`(?i)^(\? for |esc to |enter to |ctrl\+[a-z] to |↑↓ |tab to |shift\+tab )`)
)

var harnesses = []harness{
	{name: "claude", title: regexp.MustCompile(`^[✳✶✻✽✢]`),
		permission: regexp.MustCompile(`(?i)do you want to (proceed|make this edit|run|allow)|needs your permission`),
		question:   regexp.MustCompile(`\?\s*$`), prompt: promptRow},
	{name: "codex",
		permission: regexp.MustCompile(`(?i)allow (command|codex|this)|approve|would you like to (run|apply)|requires approval`),
		question:   regexp.MustCompile(`\?\s*$`), prompt: promptRow},
	{name: "gemini", title: regexp.MustCompile(`(?i)\bgemini\b`),
		permission: regexp.MustCompile(`(?i)allow execution|do you want to (proceed|allow)|apply this change`),
		question:   regexp.MustCompile(`\?\s*$`), prompt: promptRow},
	{name: "copilot", title: regexp.MustCompile(`(?i)\bcopilot\b`),
		permission: regexp.MustCompile(`(?i)allow|approve|confirm|do you want to`),
		question:   regexp.MustCompile(`\?\s*$`), prompt: promptRow},
	{name: "opencode", permission: permWords, question: regexp.MustCompile(`\?\s*$`), prompt: promptRow},
	{name: "aider", permission: yesNo, question: regexp.MustCompile(`\?\s*$`), prompt: promptRow},
	{name: "goose", permission: permWords, question: regexp.MustCompile(`\?\s*$`), prompt: promptRow},
	{name: "amp", permission: permWords, question: regexp.MustCompile(`\?\s*$`), prompt: promptRow},
	{name: "cursor-agent", permission: permWords, question: regexp.MustCompile(`\?\s*$`), prompt: promptRow},
}

// Commands an interpreter runs a harness under; the title then has to say.
var interpreters = map[string]bool{"node": true, "bun": true, "deno": true, "python": true, "python3": true, "uv": true}

// detectHarness names the harness in a pane, or "" for any other program.
func detectHarness(command, title string) *harness {
	for i := range harnesses {
		h := &harnesses[i]
		if command == h.name || (h.title != nil && (interpreters[command] || command == "") && h.title.MatchString(strings.TrimSpace(title))) {
			return h
		}
	}
	return nil
}

// Screen is what the classifier read from a capture.
type screen struct {
	// waiting is "permission" or "question" when a prompt for the owner is
	// on the screen, else "".
	waiting string
	// atPrompt says the last row is the harness's own input prompt, where it
	// sits when it has nothing to do.
	atPrompt bool
}

// Box drawing a CLI frames its prompt with; stripped so the rows inside
// read like the plain ones.
var boxEdge = regexp.MustCompile(`^[\s│┃║|]+|[\s│┃║|]+$`)

// bare is a row without its frame and its blanks at either end; a row that
// is only a frame or a rule is empty.
func bare(row string) string {
	t := boxEdge.ReplaceAllString(row, "")
	if strings.Trim(t, "─━═╭╮╰╯┌┐└┘├┤┬┴┼-=_ ") == "" {
		return ""
	}
	return t
}

// classify reads the last rows of a harness's pane. A permission or a
// question is a prompt row near the bottom with numbered choices or a
// yes/no under it, or the harness's own wording for a permission. The
// input prompt is the last non-blank row, a hint line under it aside.
func classify(h *harness, rows []string) screen {
	var s screen
	tail := rows
	if len(tail) > 15 {
		tail = tail[len(tail)-15:]
	}
	last := ""
	for i := len(tail) - 1; i >= 0; i-- {
		t := bare(tail[i])
		if t == "" || hintRow.MatchString(t) {
			continue
		}
		last = t
		break
	}
	choices, yn, perm, ask := false, false, false, false
	for _, r := range tail {
		t := bare(r)
		if numbered.MatchString(t) {
			choices = true
		}
		if yesNo.MatchString(t) {
			yn = true
		}
		if h.permission.MatchString(t) {
			perm = true
		}
		if h.question.MatchString(t) {
			ask = true
		}
	}
	switch {
	case perm && (choices || yn):
		s.waiting = "permission"
	case ask && (choices || yn):
		s.waiting = "question"
	case perm && yn:
		s.waiting = "permission"
	}
	s.atPrompt = s.waiting == "" && last != "" && h.prompt.MatchString(last)
	return s
}
