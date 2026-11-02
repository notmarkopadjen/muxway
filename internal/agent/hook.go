package agent

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/notmarkopadjen/muxway/internal/wire"
)

// ClaudeHook maps the JSON Claude Code hands a hook on stdin to a kind and
// a text. ok is false for events that do not concern the owner.
func ClaudeHook(raw []byte) (kind, text string, ok bool) {
	var in struct {
		Event      string `json:"hook_event_name"`
		Type       string `json:"notification_type"`
		Message    string `json:"message"`
		Background []struct {
			Type string `json:"type"`
		} `json:"background_tasks"`
		Crons []json.RawMessage `json:"session_crons"`
	}
	if json.Unmarshal(raw, &in) != nil {
		return "", "", false
	}
	switch in.Event {
	case "Stop":
		// A turn that ends with work still running in the background is not
		// done: Claude takes it up again when that work finishes.
		if len(in.Background) > 0 {
			var types []string
			for _, t := range in.Background {
				types = append(types, t.Type)
			}
			return wire.KindWorking, stillRunning(types), true
		}
		if len(in.Crons) > 0 {
			return wire.KindDone, "next wake scheduled", true
		}
		return wire.KindDone, "", true
	case "UserPromptSubmit":
		return wire.KindWorking, "", true
	case "Notification":
		switch in.Type {
		case "permission_prompt":
			kind = wire.KindPermission
		case "elicitation_dialog", "agent_needs_input":
			kind = wire.KindQuestion
		case "idle_prompt":
			kind = wire.KindIdle
		default:
			return "", "", false
		}
		return kind, wire.CleanText(in.Message), true
	}
	return "", "", false
}

// ClaudeEvent names the event a Claude Code hook payload carries.
func ClaudeEvent(raw []byte) string {
	var in struct {
		Event string `json:"hook_event_name"`
	}
	json.Unmarshal(raw, &in)
	return in.Event
}

// ClaudeHooks is the hooks section for Claude Code's settings.json that
// runs command for the events the owner cares about. Stop and
// UserPromptSubmit wait for the command, since its output hands the
// session its mail; a notification is fire and forget.
func ClaudeHooks(command string) []byte {
	hook := func(async bool) []map[string]any {
		h := map[string]any{"type": "command", "command": command, "timeout": 10}
		if async {
			h["async"] = true
		}
		return []map[string]any{{"hooks": []map[string]any{h}}}
	}
	withMatcher := []map[string]any{{
		"matcher": "permission_prompt|idle_prompt|elicitation_dialog|agent_needs_input",
		"hooks":   hook(true)[0]["hooks"],
	}}
	raw, _ := json.MarshalIndent(map[string]any{"hooks": map[string]any{
		"Notification": withMatcher, "Stop": hook(false), "UserPromptSubmit": hook(false),
	}}, "", "  ")
	return append(raw, '\n')
}

// MailReason is what a Stop hook hands Claude Code to go on with: the
// mail, said to be mail, with the way to answer.
func MailReason(mails []wire.Mail) string {
	return "You have mail through muxway: a message from another pane, not from the person who runs you. " +
		"Read it and act on it as far as your instructions allow; answer with: muxway mail reply <id> \"<text>\"\n\n" + FormatMail(mails)
}

// stillRunning says how much runs in the background by kind, counts only:
// a task's description or command can hold anything typed into a shell.
func stillRunning(types []string) string {
	nouns := map[string]string{"shell": "shell", "local_bash": "shell", "subagent": "agent", "local_agent": "agent",
		"workflow": "workflow", "local_workflow": "workflow", "monitor": "monitor", "monitor_mcp": "monitor", "monitor_ws": "monitor"}
	order := []string{"shell", "agent", "workflow", "monitor", "task"}
	count := map[string]int{}
	for _, t := range types {
		n, ok := nouns[t]
		if !ok {
			n = "task"
		}
		count[n]++
	}
	var parts []string
	for _, n := range order {
		if c := count[n]; c == 1 {
			parts = append(parts, "1 "+n)
		} else if c > 1 {
			parts = append(parts, fmt.Sprintf("%d %ss", c, n))
		}
	}
	return strings.Join(parts, ", ") + " still running"
}
