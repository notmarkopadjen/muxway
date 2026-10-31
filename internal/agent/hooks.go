package agent

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/notmarkopadjen/muxway/internal/wire"
)

// Hooks for the harnesses besides Claude Code (hook.go). Each one maps
// the harness's payload to a kind and a text, and prints the harness's
// own configuration shape with muxway notify as the command. Only the
// harness's notice to its user travels as text; a prompt, a tool's input
// or a model's answer never does.

// Harnesses muxway prints hooks for, in the order the help lists them.
var Harnesses = []string{"claude-code", "codex", "gemini", "copilot", "opencode", "agy"}

// KnownHarness reports whether hooks exist for name.
func KnownHarness(name string) bool {
	for _, h := range Harnesses {
		if h == name {
			return true
		}
	}
	return false
}

// SelfKinded harnesses have no hook payload worth reading: their printed
// configuration names the kind in the command itself.
func SelfKinded(harness string) bool { return harness == "opencode" || harness == "agy" }

// ParseHook reads one harness's hook payload. ok is false for events that
// do not concern the owner.
func ParseHook(harness string, raw []byte) (kind, text string, ok bool) {
	switch harness {
	case "claude-code":
		return ClaudeHook(raw)
	case "codex":
		return CodexHook(raw)
	case "gemini":
		return GeminiHook(raw)
	case "copilot":
		return CopilotHook(raw)
	}
	return "", "", false
}

// CodexHook maps Codex CLI's hooks.json payload: UserPromptSubmit,
// PermissionRequest (the tool's name only), Stop, SessionEnd.
func CodexHook(raw []byte) (kind, text string, ok bool) {
	var in struct {
		Event string `json:"hook_event_name"`
		Tool  string `json:"tool_name"`
	}
	if json.Unmarshal(raw, &in) != nil {
		return "", "", false
	}
	switch in.Event {
	case "UserPromptSubmit":
		return wire.KindWorking, "", true
	case "PermissionRequest":
		if t := wire.CleanText(in.Tool); t != "" {
			return wire.KindPermission, "Codex wants to use " + t, true
		}
		return wire.KindPermission, "Codex wants a permission", true
	case "Stop":
		return wire.KindDone, "", true
	case "SessionEnd":
		return wire.KindWorking, "", true
	}
	return "", "", false
}

// GeminiHook maps Gemini CLI's hooks: BeforeAgent, Notification of a
// ToolPermission (with its message), AfterAgent, SessionEnd.
func GeminiHook(raw []byte) (kind, text string, ok bool) {
	var in struct {
		Event   string `json:"hook_event_name"`
		Type    string `json:"notification_type"`
		Message string `json:"message"`
	}
	if json.Unmarshal(raw, &in) != nil {
		return "", "", false
	}
	switch in.Event {
	case "BeforeAgent":
		return wire.KindWorking, "", true
	case "AfterAgent":
		return wire.KindDone, "", true
	case "SessionEnd":
		return wire.KindWorking, "", true
	case "Notification":
		if in.Type == "ToolPermission" {
			return wire.KindPermission, wire.CleanText(in.Message), true
		}
	}
	return "", "", false
}

// CopilotHook maps Copilot CLI's hooks in their PascalCase form, which
// carries hook_event_name: UserPromptSubmit, Notification (a permission
// prompt or a question), Stop, SessionEnd.
func CopilotHook(raw []byte) (kind, text string, ok bool) {
	var in struct {
		Event   string `json:"hook_event_name"`
		Type    string `json:"notification_type"`
		Message string `json:"message"`
	}
	if json.Unmarshal(raw, &in) != nil {
		return "", "", false
	}
	switch in.Event {
	case "UserPromptSubmit":
		return wire.KindWorking, "", true
	case "Stop":
		return wire.KindDone, "", true
	case "SessionEnd":
		return wire.KindWorking, "", true
	case "Notification":
		switch in.Type {
		case "permission_prompt":
			return wire.KindPermission, wire.CleanText(in.Message), true
		case "elicitation_dialog":
			return wire.KindQuestion, wire.CleanText(in.Message), true
		}
	}
	return "", "", false
}

// HookConfig is the configuration a harness takes, with command as the
// hook, and where it goes.
func HookConfig(harness, command string) (config []byte, where string, err error) {
	switch harness {
	case "claude-code":
		return ClaudeHooks(command), "~/.claude/settings.json (merge the \"hooks\" key if it exists)", nil
	case "codex":
		return codexHooks(command), "~/.codex/hooks.json (merge the \"hooks\" key if it exists)", nil
	case "gemini":
		return geminiHooks(command), "~/.gemini/settings.json (merge the \"hooks\" key if it exists)", nil
	case "copilot":
		return copilotHooks(command), "~/.copilot/hooks/muxway.json", nil
	case "opencode":
		return opencodePlugin(command), "~/.config/opencode/plugins/muxway.ts", nil
	case "agy":
		return agyHooks(command), "~/.gemini/config/hooks.json (merge: add the \"muxway\" key beside the others)", nil
	}
	return nil, "", fmt.Errorf("no hooks for %q; one of %s", harness, strings.Join(Harnesses, ", "))
}

func indent(v any) []byte {
	raw, _ := json.MarshalIndent(v, "", "  ")
	return append(raw, '\n')
}

// codexHooks: ~/.codex/hooks.json, event → matcher group → handlers,
// timeout in seconds, async so Codex never waits.
func codexHooks(command string) []byte {
	group := []map[string]any{{"hooks": []map[string]any{{
		"type": "command", "command": command, "timeout": 10, "async": true,
	}}}}
	return indent(map[string]any{"hooks": map[string]any{
		"UserPromptSubmit": group, "PermissionRequest": group, "Stop": group, "SessionEnd": group,
	}})
}

// geminiHooks: the hooks object of ~/.gemini/settings.json, timeout in
// milliseconds, the Notification matcher an exact type.
func geminiHooks(command string) []byte {
	hooks := []map[string]any{{"type": "command", "command": command, "name": "muxway", "timeout": 10000}}
	group := []map[string]any{{"hooks": hooks}}
	return indent(map[string]any{"hooks": map[string]any{
		"BeforeAgent": group, "AfterAgent": group, "SessionEnd": group,
		"Notification": []map[string]any{{"matcher": "ToolPermission", "hooks": hooks}},
	}})
}

// copilotHooks: a file of ~/.copilot/hooks/, version 1, the PascalCase
// events so the payload names itself.
func copilotHooks(command string) []byte {
	entry := []map[string]any{{"type": "command", "bash": command, "timeoutSec": 10}}
	return indent(map[string]any{"version": 1, "hooks": map[string]any{
		"UserPromptSubmit": entry, "Notification": entry, "Stop": entry, "SessionEnd": entry,
	}})
}

// agyHooks: Antigravity CLI's ~/.gemini/config/hooks.json, a named hook
// with handlers under each lifecycle event; its payload does not name
// the event, so each handler carries its kind. PreInvocation fires
// before every model call (working, again and again, which is fine) and
// Stop when the turn ends; a permission has no event, the watcher sees it.
func agyHooks(command string) []byte {
	handler := func(kind string) []map[string]any {
		return []map[string]any{{"type": "command", "command": command + " --kind " + kind, "timeout": 10}}
	}
	return indent(map[string]any{"muxway": map[string]any{
		"PreInvocation": handler(wire.KindWorking),
		"Stop":          handler(wire.KindDone),
	}})
}

// opencodePlugin: a plugin for ~/.config/opencode/plugins/ that calls
// notify itself, kind by kind; command here is the bare notify command.
func opencodePlugin(command string) []byte {
	return []byte(`// muxway: tell the hub what OpenCode in this pane is up to.
// Printed by "muxway hooks opencode"; $TMUX_PANE names the pane.
export const MuxwayPlugin = async ({ $ }) => {
  const notify = (kind, text = "") =>
    $` + "`" + command + ` --kind ${kind} --text ${text}` + "`" + `.quiet().nothrow();
  return {
    event: async ({ event }) => {
      switch (event.type) {
        case "permission.asked":
          await notify("permission", "OpenCode asks for a permission");
          break;
        case "session.idle":
          await notify("done");
          break;
        case "message.updated":
          if (event.properties?.info?.role === "user") await notify("working");
          break;
      }
    },
  };
};
`)
}
