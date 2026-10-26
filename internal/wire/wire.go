// Package wire defines the messages on the encrypted channel between hub
// and agent. The hub sends requests, the agent answers them; there is
// nothing else.
package wire

import (
	"regexp"

	"github.com/notmarkopadjen/muxway/internal/tmux"
)

// Ops the hub may request.
const (
	OpList       = "list"
	OpRead       = "read"
	OpInput      = "input"
	OpResize     = "resize"
	OpSplit      = "split"       // one more pane beside or below Pane
	OpNewSession = "new-session" // a session named Name, marked writable
	OpKillPane   = "kill-pane"   // the hub's undo of a split it may not grant
	OpClosePane  = "close-pane"  // a client closes a writable pane, where the owner allows it
	OpFile       = "file"        // a file for the pane's program, into the agent's inbox
	OpReadFile   = "read-file"   // one file of the inbox back, by name
)

// Request from hub to agent. Actor is the id of the client token the hub
// acts for, recorded in the agent's audit log.
type Request struct {
	ID    uint64 `json:"id"`
	Op    string `json:"op"`
	Actor string `json:"actor,omitempty"`
	Pane  string `json:"pane,omitempty"`
	Lines int    `json:"lines,omitempty"`
	ANSI  bool   `json:"ansi,omitempty"`
	// Wrapped asks for the rows as the terminal wrapped them; without it a
	// line the terminal wrapped comes back joined, for a reader that rewraps.
	Wrapped bool    `json:"wrapped,omitempty"`
	Text    *string `json:"text,omitempty"`
	Key     string  `json:"key,omitempty"`
	Mouse   *Mouse  `json:"mouse,omitempty"`
	Cols    int     `json:"cols,omitempty"`
	Rows    int     `json:"rows,omitempty"`
	Fit     string  `json:"fit,omitempty"`   // "auto" gives the window back to tmux
	Scope   string  `json:"scope,omitempty"` // "" or "pane": size the pane; "window": size its window
	// Layout, with scope "window", is a tmux layout string whose
	// proportions the window takes at the new size.
	Layout string `json:"layout,omitempty"`
	// Arrange: the hub found the principal may write to every pane of the
	// window, so the layout may move panes, not only size them.
	Arrange bool `json:"arrange,omitempty"`
	// Zoom, with scope "window", shows the pane alone in its window.
	Zoom bool `json:"zoom,omitempty"`
	// Direction of a split: "h" puts the new pane beside Pane, "v" below.
	Direction string `json:"direction,omitempty"`
	// Name of the session to start, or of the inbox file to read.
	Name string `json:"name,omitempty"`
	// Type and Data of a file for the inbox; the agent names it.
	Type string `json:"type,omitempty"`
	Data []byte `json:"data,omitempty"`
}

// Mouse is one click or wheel notch at a cell, 1-based.
type Mouse struct {
	Button string `json:"button"`
	X      int    `json:"x"`
	Y      int    `json:"y"`
	// Count turns the wheel that many notches in one go; absent, one.
	Count int `json:"count,omitempty"`
}

// MaxWheel bounds Count: a hand's worth of scrolling per request.
const MaxWheel = 50

// Buttons a client may send, with their xterm codes.
var Buttons = map[string]int{"left": 0, "middle": 1, "right": 2, "wheelup": 64, "wheeldown": 65}

// ValidMouse reports whether m is a known button at a cell of a w×h pane.
func ValidMouse(m *Mouse, w, h int) bool {
	if m == nil {
		return false
	}
	code, ok := Buttons[m.Button]
	if m.Count != 0 && (code < 64 || m.Count < 1 || m.Count > MaxWheel) {
		return false
	}
	return ok && m.X >= 1 && m.X <= w && m.Y >= 1 && m.Y <= h
}

// Response from agent to hub.
type Response struct {
	ID      uint64      `json:"id"`
	Error   string      `json:"error,omitempty"`
	Panes   []tmux.Pane `json:"panes,omitempty"`
	Content string      `json:"content,omitempty"`
	// Pane is what a split or a new session made.
	Pane *tmux.Pane `json:"pane,omitempty"`
	// Sessions, with a list, says the agent starts sessions for clients.
	Sessions bool `json:"sessions,omitempty"`
	Close    bool `json:"close,omitempty"`
	// Keys, with a list, is the version of key names the agent takes:
	// 2 for modifiers on any key, the keypad and chords (tmux.KeyName).
	Keys int `json:"keys,omitempty"`
	// Inbox, with a list, says the agent takes files; Path is where one went.
	Inbox bool   `json:"inbox,omitempty"`
	Path  string `json:"path,omitempty"`
	// Type and Data of a file read back.
	Type string `json:"type,omitempty"`
	Data []byte `json:"data,omitempty"`
}

// KeyGrammar is the key names this build takes, as Response.Keys says.
const KeyGrammar = 2

// Errors an agent returns. They are codes, never details.
const (
	ErrNotExposed = "not_exposed"
	ErrReadOnly   = "read_only"
	ErrBadInput   = "bad_input"
	ErrUnknownOp  = "unknown_op"
	ErrTmux       = "tmux_error"
	ErrRateLimit  = "rate_limited"
	ErrNotAllowed = "not_allowed" // the agent does not start sessions
	ErrExists     = "exists"
	ErrTooMany    = "too_many"
	ErrInboxFull  = "inbox_full"
	ErrNoFile     = "no_file" // no such file in the inbox
)

// Limits shared by hub and agent.
const (
	MaxLines         = 2000
	MaxTextBytes     = 4096
	MinCols, MaxCols = 20, 500
	MinRows, MaxRows = 5, 300
	MaxLayoutBytes   = 2048
	// Panes a window may be split into, and sessions an agent starts for
	// clients, over its lifetime's live ones.
	MaxPanesPerWindow = 8
	MaxClientSessions = 32
	// A file for the inbox, and the largest message that may carry one;
	// every other message stays under MaxMessage.
	MaxFile        = 8 << 20
	MaxFileMessage = 12 << 20
	MaxMessage     = 1 << 20
)

// A session a client starts has a short name of its own.
var sessionName = regexp.MustCompile(`^[a-z0-9_-]{1,32}$`)

// ValidSessionName reports whether a client may name a session so.
func ValidSessionName(s string) bool { return sessionName.MatchString(s) }

// ValidDirection reports whether a split direction is one of the two.
func ValidDirection(s string) bool { return s == "h" || s == "v" }

// ValidSize reports whether a window may be resized to cols by rows.
func ValidSize(cols, rows int) bool {
	return cols >= MinCols && cols <= MaxCols && rows >= MinRows && rows <= MaxRows
}

// ValidText reports whether text may be typed into a pane: UTF-8 without
// control characters (C0, DEL, C1), at most MaxTextBytes. The newline is
// the one exception: a text with one is pasted, not typed.
func ValidText(s string) bool {
	if len(s) == 0 || len(s) > MaxTextBytes {
		return false
	}
	for _, r := range s {
		if r == '\n' {
			continue
		}
		if r < 0x20 || r == 0x7f || (r >= 0x80 && r <= 0x9f) || r == 0xfffd {
			return false
		}
	}
	return true
}

// Kinds of attention a pane can ask for, and the one that clears it.
const (
	KindQuestion   = "question"
	KindPermission = "permission"
	KindIdle       = "idle"
	KindDone       = "done"
	KindWorking    = "working"
)

// MaxEventText caps the text that travels with an event, in characters.
const MaxEventText = 200

// KnownKind reports whether a kind is one of the fixed list.
func KnownKind(k string) bool {
	switch k {
	case KindQuestion, KindPermission, KindIdle, KindDone, KindWorking:
		return true
	}
	return false
}

// Event is the one unsolicited message an agent sends: something happened
// in an exposed pane. It carries the pane as listed so the hub can check
// grants without a round trip. The host is the connection's, never a
// field here.
type Event struct {
	Pane tmux.Pane `json:"pane"`
	Kind string    `json:"kind"`
	Text string    `json:"text,omitempty"`
}

// Notice is a message from agent to hub: a response to a request, or an
// event when there is no id.
type Notice struct {
	Response
	Event *Event `json:"event,omitempty"`
}

// CleanText makes free text safe to travel and display: control characters
// become spaces, runs of blanks collapse, the result is trimmed and cut to
// MaxEventText characters.
func CleanText(s string) string {
	var b []rune
	space := true
	for _, r := range s {
		if r < 0x20 || r == 0x7f || (r >= 0x80 && r <= 0x9f) || r == 0xfffd || r == ' ' {
			if !space {
				b = append(b, ' ')
				space = true
			}
			continue
		}
		b = append(b, r)
		space = false
	}
	if len(b) > 0 && b[len(b)-1] == ' ' {
		b = b[:len(b)-1]
	}
	if len(b) > MaxEventText {
		b = b[:MaxEventText]
	}
	return string(b)
}

// ValidEventText is what the hub accepts: already clean, within the cap.
func ValidEventText(s string) bool {
	return CleanText(s) == s && len([]rune(s)) <= MaxEventText
}
