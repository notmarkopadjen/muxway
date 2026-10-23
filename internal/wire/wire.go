// Package wire defines the messages on the encrypted channel between hub
// and agent. The hub sends requests, the agent answers them; there is
// nothing else.
package wire

import "github.com/notmarkopadjen/muxway/internal/tmux"

// Ops the hub may request.
const (
	OpList  = "list"
	OpRead  = "read"
	OpInput = "input"
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
)

// Limits shared by hub and agent.
const (
	MaxLines     = 2000
	MaxTextBytes = 4096
)

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
