package agent

import (
	"encoding/json"

	"github.com/notmarkopadjen/muxway/internal/wire"
)

// ClaudeHook maps the JSON Claude Code hands a hook on stdin to a kind and
// a text. ok is false for events that do not concern the owner.
func ClaudeHook(raw []byte) (kind, text string, ok bool) {
	var in struct {
		Event   string `json:"hook_event_name"`
		Type    string `json:"notification_type"`
		Message string `json:"message"`
	}
	if json.Unmarshal(raw, &in) != nil {
		return "", "", false
	}
	switch in.Event {
	case "Stop":
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

// ClaudeHooks is the hooks section for Claude Code's settings.json that
// runs command for the events the owner cares about.
func ClaudeHooks(command string) []byte {
	hook := []map[string]any{{"hooks": []map[string]any{{
		"type": "command", "command": command, "async": true, "timeout": 10,
	}}}}
	withMatcher := []map[string]any{{
		"matcher": "permission_prompt|idle_prompt|elicitation_dialog|agent_needs_input",
		"hooks":   hook[0]["hooks"],
	}}
	raw, _ := json.MarshalIndent(map[string]any{"hooks": map[string]any{
		"Notification": withMatcher, "Stop": hook, "UserPromptSubmit": hook,
	}}, "", "  ")
	return append(raw, '\n')
}
