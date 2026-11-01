// Package mcp serves a hub's panes to one local program as MCP tools over
// stdio: newline-delimited JSON-RPC 2.0, the 2025-06-18 protocol, tools
// only. It has the token's rights and nothing more.
package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/notmarkopadjen/muxway/internal/agent"
	"github.com/notmarkopadjen/muxway/internal/client"
)

const protocolVersion = "2025-06-18"

type request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// Tool is one operation as MCP lists it.
type Tool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

type content struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type callResult struct {
	Content []content `json:"content"`
	IsError bool      `json:"isError,omitempty"`
}

func str(desc string) map[string]any { return map[string]any{"type": "string", "description": desc} }
func num(desc string) map[string]any { return map[string]any{"type": "integer", "description": desc} }

func schema(props map[string]any, required ...string) map[string]any {
	s := map[string]any{"type": "object", "properties": props}
	if len(required) > 0 {
		s["required"] = required
	}
	return s
}

// Tools the server offers, in the order they are listed.
var Tools = []Tool{
	{"list_panes", "List the tmux panes this token may read, across hosts: address, mode (read or write), command, title, and what the pane waits for.", schema(map[string]any{})},
	{"inbox", "List the panes that wait for their owner, oldest first: a question, a permission, an agent gone idle or finished; with the choices a question offers.", schema(map[string]any{})},
	{"read_pane", "Read the last lines of a pane's screen as plain text.", schema(map[string]any{
		"address": str("the pane's address, host/session/window.pane or host/@alias"),
		"lines":   num("how many lines from the bottom, default 100, at most 2000"),
	}, "address")},
	{"send_text", "Type text into a pane; it is not sent until Enter follows (set enter to true to add it).", schema(map[string]any{
		"address": str("the pane's address"),
		"text":    str("the text to type, up to 4096 bytes; a newline inside pastes it as one block"),
		"enter":   map[string]any{"type": "boolean", "description": "press Enter after the text"},
	}, "address", "text")},
	{"send_key", "Press a named key in a pane: Enter, Escape, Tab, BTab, Up, Down, C-c, M-x, F5 and the like.", schema(map[string]any{
		"address": str("the pane's address"),
		"key":     str("the key's name, in muxway's key grammar"),
		"count":   num("how many times, 1 to 50"),
	}, "address", "key")},
	{"answer", "Answer a question a pane asked with fixed choices (see inbox) with one of its choices.", schema(map[string]any{
		"address": str("the pane's address"),
		"choice":  str("one of the question's choices, exactly"),
	}, "address", "choice")},
	{"wait", "Block until a pane (or any pane) needs its owner, up to timeout_seconds, and return what it waits for.", schema(map[string]any{
		"address":         str("the pane's address; empty for any pane"),
		"timeout_seconds": num("how long to wait at most, default 300, at most 3600"),
	})},
	{"talk", "What panes said to panes lately: every mail and every write that named the pane it came from, oldest first, with who sent it, where, the kind (mail, text, key, answer) and the text.", schema(map[string]any{})},
	{"mail", "Leave a message for the process in a pane, such as another agent: it is held for that process and never typed into the pane. Use this to talk to another agent; send_text is for driving a shell.", schema(map[string]any{
		"address": str("the pane's address"),
		"text":    str("the message, up to 4000 characters"),
	}, "address", "text")},
	{"mailbox", "The mail a pane holds, read and unread, oldest first: id, when, from where, who sent it, when it was read, the text.", schema(map[string]any{
		"address": str("the pane's address"),
	}, "address")},
	{"my_mail", "The unread mail left for the pane this server runs in, then marked read; with timeout_seconds, wait that long for one to arrive. Answer one with muxway mail reply <id> in your shell.", schema(map[string]any{
		"timeout_seconds": num("how long to wait for mail, default 0 (what is there now), at most 3600"),
	})},
}

// Server answers one client over in and out. AgentDir and Pane say
// where this server runs, for the mail left for its own pane.
type Server struct {
	Client   *client.Client
	Name     string
	AgentDir string
	Pane     string
}

// Serve reads requests until in ends.
func (s *Server) Serve(ctx context.Context, in io.Reader, out io.Writer) error {
	rd := bufio.NewReaderSize(in, 1<<20)
	enc := json.NewEncoder(out)
	for {
		line, err := rd.ReadBytes('\n')
		if len(line) == 0 && err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
		line = []byte(strings.TrimSpace(string(line)))
		if len(line) == 0 {
			continue
		}
		var req request
		if json.Unmarshal(line, &req) != nil || req.JSONRPC != "2.0" {
			enc.Encode(response{JSONRPC: "2.0", ID: json.RawMessage("null"), Error: &rpcError{-32700, "parse error"}})
			continue
		}
		if req.ID == nil {
			// A notification: nothing is answered.
			continue
		}
		resp := response{JSONRPC: "2.0", ID: req.ID}
		result, rpcErr := s.handle(ctx, req)
		if rpcErr != nil {
			resp.Error = rpcErr
		} else {
			resp.Result = result
		}
		if err := enc.Encode(resp); err != nil {
			return err
		}
	}
}

func (s *Server) handle(ctx context.Context, req request) (any, *rpcError) {
	switch req.Method {
	case "initialize":
		return map[string]any{
			"protocolVersion": protocolVersion,
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": s.Name, "version": "1"},
			"instructions":    "muxway reaches tmux panes on the hosts this token may see. Read before you type; a write needs the token's write grant and the pane's write mark.",
		}, nil
	case "ping":
		return map[string]any{}, nil
	case "tools/list":
		return map[string]any{"tools": Tools}, nil
	case "tools/call":
		var p struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if json.Unmarshal(req.Params, &p) != nil || p.Name == "" {
			return nil, &rpcError{-32602, "invalid params"}
		}
		text, err := s.call(ctx, p.Name, p.Arguments)
		if err != nil {
			var unknown *unknownTool
			if errors.As(err, &unknown) {
				return nil, &rpcError{-32602, err.Error()}
			}
			return callResult{Content: []content{{"text", err.Error()}}, IsError: true}, nil
		}
		return callResult{Content: []content{{"text", text}}}, nil
	}
	return nil, &rpcError{-32601, "method not found: " + req.Method}
}

type unknownTool struct{ name string }

func (e *unknownTool) Error() string { return "unknown tool: " + e.name }

type args struct {
	Address string `json:"address"`
	Lines   int    `json:"lines"`
	Text    string `json:"text"`
	Enter   bool   `json:"enter"`
	Key     string `json:"key"`
	Count   int    `json:"count"`
	Choice  string `json:"choice"`
	Timeout int    `json:"timeout_seconds"`
}

// call runs one tool and returns its text.
func (s *Server) call(ctx context.Context, name string, raw json.RawMessage) (string, error) {
	var a args
	if len(raw) > 0 && json.Unmarshal(raw, &a) != nil {
		return "", errors.New("arguments: not an object of the tool's fields")
	}
	switch name {
	case "list_panes":
		return s.Client.Text(ctx, "/v1/panes")
	case "talk":
		entries, _, err := s.Client.Talk(ctx, 0, 0, 100)
		if err != nil {
			return "", err
		}
		if len(entries) == 0 {
			return "no pane talked to another lately", nil
		}
		var b strings.Builder
		for _, e := range entries {
			fmt.Fprintf(&b, "%d\t%s → %s\t%s\t%s\n", e.At, e.FromAddress(), e.To.Address, e.Kind, strings.NewReplacer("\t", " ", "\n", " ").Replace(e.Text))
		}
		return b.String(), nil
	case "mail":
		if a.Address == "" || a.Text == "" {
			return "", errors.New("address and text are required")
		}
		id, err := s.Client.Mail(ctx, a.Address, a.Text)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("mailed, id %d", id), nil
	case "mailbox":
		if a.Address == "" {
			return "", errors.New("address is required")
		}
		out, err := s.Client.Mailbox(ctx, a.Address)
		if err != nil {
			return "", err
		}
		if strings.TrimSpace(out) == "" {
			return "no mail", nil
		}
		return out, nil
	case "my_mail":
		if s.Pane == "" {
			return "", errors.New("not in a tmux pane: no mailbox of its own")
		}
		req := agent.NotifyRequest{Pane: s.Pane, Mail: "take", How: "pull"}
		if a.Timeout > 0 {
			req.Mail, req.Timeout = "wait", min(a.Timeout, 3600)
		}
		mails, err := agent.ExchangeMail(s.AgentDir, req)
		if err != nil {
			return "", err
		}
		if len(mails) == 0 {
			return "no mail", nil
		}
		return agent.FormatMail(mails), nil
	case "inbox":
		panes, err := s.Client.Inbox(ctx)
		if err != nil {
			return "", err
		}
		if len(panes) == 0 {
			return "nothing waits", nil
		}
		var b strings.Builder
		for _, p := range panes {
			fmt.Fprintf(&b, "%s\t%s\t%s", p.Address, p.Attention.Kind, p.Attention.Text)
			if len(p.Attention.Choices) > 0 {
				fmt.Fprintf(&b, "\tchoices: %s", strings.Join(p.Attention.Choices, " | "))
			}
			b.WriteByte('\n')
		}
		return b.String(), nil
	case "read_pane":
		if a.Address == "" {
			return "", errors.New("address is required")
		}
		return s.Client.Read(ctx, a.Address, a.Lines)
	case "send_text":
		if a.Address == "" || a.Text == "" {
			return "", errors.New("address and text are required")
		}
		if err := s.Client.Input(ctx, a.Address, map[string]any{"text": a.Text}); err != nil {
			return "", err
		}
		if a.Enter {
			if err := s.Client.Input(ctx, a.Address, map[string]any{"key": "Enter"}); err != nil {
				return "", err
			}
		}
		return "sent", nil
	case "send_key":
		if a.Address == "" || a.Key == "" {
			return "", errors.New("address and key are required")
		}
		body := map[string]any{"key": a.Key}
		if a.Count > 1 {
			body["count"] = a.Count
		}
		if err := s.Client.Input(ctx, a.Address, body); err != nil {
			return "", err
		}
		return "sent", nil
	case "answer":
		if a.Address == "" || a.Choice == "" {
			return "", errors.New("address and choice are required")
		}
		if err := s.Client.Answer(ctx, a.Address, a.Choice); err != nil {
			return "", err
		}
		return "answered", nil
	case "wait":
		timeout := a.Timeout
		if timeout <= 0 {
			timeout = 300
		}
		timeout = min(timeout, 3600)
		wctx, cancel := context.WithTimeout(ctx, time.Duration(timeout)*time.Second)
		defer cancel()
		e, err := s.Client.Wait(wctx, a.Address)
		if err != nil {
			return "", err
		}
		if e == nil {
			return "nothing waited within the time", nil
		}
		text := fmt.Sprintf("%s\t%s\t%s", e.Address, e.Kind, e.Text)
		if len(e.Choices) > 0 {
			text += "\tchoices: " + strings.Join(e.Choices, " | ")
		}
		return text, nil
	}
	return "", &unknownTool{name}
}
