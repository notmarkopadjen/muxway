// Package wire defines the messages on the encrypted channel between hub
// and agent. The hub sends requests, the agent answers them; there is
// nothing else.
package wire

import "github.com/notmarkopadjen/muxway/internal/tmux"

// Ops the hub may request.
const (
	OpList   = "list"
	OpRead   = "read"
	OpInput  = "input"
	OpResize = "resize"
)

// Request from hub to agent. Actor is the id of the client token the hub
// acts for, recorded in the agent's audit log.
type Request struct {
	ID    uint64  `json:"id"`
	Op    string  `json:"op"`
	Actor string  `json:"actor,omitempty"`
	Pane  string  `json:"pane,omitempty"`
	Lines int     `json:"lines,omitempty"`
	ANSI  bool    `json:"ansi,omitempty"`
	Text  *string `json:"text,omitempty"`
	Key   string  `json:"key,omitempty"`
	Cols  int     `json:"cols,omitempty"`
	Rows  int     `json:"rows,omitempty"`
	Fit   string  `json:"fit,omitempty"`   // "auto" gives the window back to tmux
	Scope string  `json:"scope,omitempty"` // "" or "pane": size the pane; "window": size its window
	// Layout, with scope "window", is a tmux layout string whose
	// proportions the window takes at the new size.
	Layout string `json:"layout,omitempty"`
	// Zoom, with scope "window", shows the pane alone in its window.
	Zoom bool `json:"zoom,omitempty"`
}

// Response from agent to hub.
type Response struct {
	ID      uint64      `json:"id"`
	Error   string      `json:"error,omitempty"`
	Panes   []tmux.Pane `json:"panes,omitempty"`
	Content string      `json:"content,omitempty"`
}

// Errors an agent returns. They are codes, never details.
const (
	ErrNotExposed = "not_exposed"
	ErrReadOnly   = "read_only"
	ErrBadInput   = "bad_input"
	ErrUnknownOp  = "unknown_op"
	ErrTmux       = "tmux_error"
	ErrRateLimit  = "rate_limited"
)

// Limits shared by hub and agent.
const (
	MaxLines         = 2000
	MaxTextBytes     = 4096
	MinCols, MaxCols = 20, 500
	MinRows, MaxRows = 5, 300
	MaxLayoutBytes   = 2048
)

// ValidSize reports whether a window may be resized to cols by rows.
func ValidSize(cols, rows int) bool {
	return cols >= MinCols && cols <= MaxCols && rows >= MinRows && rows <= MaxRows
}

// ValidText reports whether text may be typed into a pane: UTF-8 without
// control characters (C0, DEL, C1), at most MaxTextBytes.
func ValidText(s string) bool {
	if len(s) == 0 || len(s) > MaxTextBytes {
		return false
	}
	for _, r := range s {
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
