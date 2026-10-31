package agent

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestHarnessHooks(t *testing.T) {
	cases := []struct {
		harness, in string
		kind, text  string
		ok          bool
	}{
		// Codex: the tool's name travels, never its input or the model's answer.
		{"codex", `{"hook_event_name":"UserPromptSubmit","session_id":"s","cwd":"/w","prompt":"secret plans","turn_id":"t"}`, "working", "", true},
		{"codex", `{"hook_event_name":"PermissionRequest","tool_name":"shell","tool_input":{"command":"rm -rf /"}}`, "permission", "Codex wants to use shell", true},
		{"codex", `{"hook_event_name":"PermissionRequest","tool_name":"a\u001bb"}`, "permission", "Codex wants to use a b", true},
		{"codex", `{"hook_event_name":"PermissionRequest"}`, "permission", "Codex wants a permission", true},
		{"codex", `{"hook_event_name":"Stop","last_assistant_message":"TOKEN=mxt_secret done"}`, "done", "", true},
		{"codex", `{"hook_event_name":"SessionEnd","reason":"other"}`, "working", "", true},
		{"codex", `{"hook_event_name":"PreToolUse","tool_name":"shell"}`, "", "", false},
		{"codex", `nope`, "", "", false},
		// Gemini: its own permission message travels.
		{"gemini", `{"hook_event_name":"BeforeAgent","prompt":"p"}`, "working", "", true},
		{"gemini", `{"hook_event_name":"AfterAgent","prompt":"p","prompt_response":"r"}`, "done", "", true},
		{"gemini", `{"hook_event_name":"Notification","notification_type":"ToolPermission","message":"Allow run_shell_command?","details":{}}`, "permission", "Allow run_shell_command?", true},
		{"gemini", `{"hook_event_name":"Notification","notification_type":"Other","message":"x"}`, "", "", false},
		{"gemini", `{"hook_event_name":"SessionEnd"}`, "working", "", true},
		{"gemini", `{"hook_event_name":"BeforeTool"}`, "", "", false},
		// Copilot, in the form that names its event.
		{"copilot", `{"hook_event_name":"UserPromptSubmit","prompt":"p"}`, "working", "", true},
		{"copilot", `{"hook_event_name":"Stop","stop_reason":"end_turn"}`, "done", "", true},
		{"copilot", `{"hook_event_name":"Notification","notification_type":"permission_prompt","message":"Copilot needs permission to run a command"}`, "permission", "Copilot needs permission to run a command", true},
		{"copilot", `{"hook_event_name":"Notification","notification_type":"elicitation_dialog","message":"Which branch?"}`, "question", "Which branch?", true},
		{"copilot", `{"hook_event_name":"Notification","notification_type":"agent_idle","message":"x"}`, "", "", false},
		{"copilot", `{"hook_event_name":"SessionEnd","reason":"user_exit"}`, "working", "", true},
		{"copilot", `{"sessionId":"s","timestamp":1,"cwd":"/w","reason":"complete"}`, "", "", false},
		// The Claude parser is reachable the same way.
		{"claude-code", `{"hook_event_name":"UserPromptSubmit"}`, "working", "", true},
		{"opencode", `{}`, "", "", false},
		{"unknown", `{}`, "", "", false},
	}
	for _, c := range cases {
		kind, text, ok := ParseHook(c.harness, []byte(c.in))
		if kind != c.kind || text != c.text || ok != c.ok {
			t.Errorf("%s %s: got %q %q %v, want %q %q %v", c.harness, c.in, kind, text, ok, c.kind, c.text, c.ok)
		}
	}
}

func TestHookConfigs(t *testing.T) {
	const cmd = "/usr/local/bin/muxway notify --from X --dir /home/alice/.config/muxway/agent"
	for _, h := range []string{"claude-code", "codex", "gemini", "copilot"} {
		raw, where, err := HookConfig(h, cmd)
		if err != nil || where == "" {
			t.Fatalf("%s: %v", h, err)
		}
		var v map[string]any
		if err := json.Unmarshal(raw, &v); err != nil {
			t.Fatalf("%s: not JSON: %v\n%s", h, err, raw)
		}
		if !strings.Contains(string(raw), cmd) {
			t.Errorf("%s: the command is not in it:\n%s", h, raw)
		}
		hooks, _ := v["hooks"].(map[string]any)
		if len(hooks) < 3 {
			t.Errorf("%s: too few events: %v", h, hooks)
		}
	}
	// Codex: matcher groups with async command handlers, timeout in seconds.
	raw, _, _ := HookConfig("codex", cmd)
	var codex struct {
		Hooks map[string][]struct {
			Hooks []struct {
				Type    string
				Command string
				Timeout int
				Async   bool
			}
		}
	}
	json.Unmarshal(raw, &codex)
	for _, ev := range []string{"UserPromptSubmit", "PermissionRequest", "Stop", "SessionEnd"} {
		g := codex.Hooks[ev]
		if len(g) != 1 || len(g[0].Hooks) != 1 || g[0].Hooks[0].Type != "command" || g[0].Hooks[0].Timeout != 10 || !g[0].Hooks[0].Async {
			t.Errorf("codex %s: %s", ev, raw)
		}
	}
	// Gemini: timeout in milliseconds, the notification matched by type.
	raw, _, _ = HookConfig("gemini", cmd)
	var gemini struct {
		Hooks map[string][]struct {
			Matcher string
			Hooks   []struct{ Timeout int }
		}
	}
	json.Unmarshal(raw, &gemini)
	if gemini.Hooks["Notification"][0].Matcher != "ToolPermission" || gemini.Hooks["BeforeAgent"][0].Hooks[0].Timeout != 10000 {
		t.Errorf("gemini: %s", raw)
	}
	// Copilot: version 1, bash entries with timeoutSec.
	raw, where, _ := HookConfig("copilot", cmd)
	var copilot struct {
		Version int
		Hooks   map[string][]struct {
			Type       string
			Bash       string
			TimeoutSec int
		}
	}
	json.Unmarshal(raw, &copilot)
	if copilot.Version != 1 || copilot.Hooks["Stop"][0].Bash != cmd || copilot.Hooks["Stop"][0].TimeoutSec != 10 || !strings.Contains(where, ".copilot/hooks") {
		t.Errorf("copilot: %s", raw)
	}
	// OpenCode: a plugin that calls notify itself, kind by kind.
	raw, where, err := HookConfig("opencode", "/usr/local/bin/muxway notify --dir /d")
	if err != nil || !strings.Contains(where, "opencode/plugins") {
		t.Fatal(err, where)
	}
	for _, want := range []string{"export const MuxwayPlugin", "/usr/local/bin/muxway notify --dir /d --kind", `"permission.asked"`, `"session.idle"`, `"message.updated"`} {
		if !strings.Contains(string(raw), want) {
			t.Errorf("opencode plugin lacks %q:\n%s", want, raw)
		}
	}
	// Antigravity: a named hook, the kind in each handler's command.
	raw, where, err = HookConfig("agy", "/usr/local/bin/muxway notify --dir /d")
	if err != nil || !strings.Contains(where, ".gemini/config/hooks.json") {
		t.Fatal(err, where)
	}
	var agy map[string]map[string][]struct {
		Type    string
		Command string
		Timeout int
	}
	if err := json.Unmarshal(raw, &agy); err != nil {
		t.Fatal(err)
	}
	mx := agy["muxway"]
	if len(mx["PreInvocation"]) != 1 || mx["PreInvocation"][0].Command != "/usr/local/bin/muxway notify --dir /d --kind working" ||
		len(mx["Stop"]) != 1 || mx["Stop"][0].Command != "/usr/local/bin/muxway notify --dir /d --kind done" || mx["Stop"][0].Timeout != 10 {
		t.Errorf("agy: %s", raw)
	}
	if !SelfKinded("agy") || !SelfKinded("opencode") || SelfKinded("codex") {
		t.Error("self-kinded harnesses")
	}
	if _, _, err := HookConfig("vim", cmd); err == nil {
		t.Error("an unknown harness got a config")
	}
}
