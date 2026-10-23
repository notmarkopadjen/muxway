package agent

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestClaudeHook(t *testing.T) {
	cases := []struct {
		in         string
		kind, text string
		ok         bool
	}{
		{`{"hook_event_name":"Notification","notification_type":"permission_prompt","message":"Claude needs your permission to use Bash"}`, "permission", "Claude needs your permission to use Bash", true},
		{`{"hook_event_name":"Notification","notification_type":"elicitation_dialog","message":"q?"}`, "question", "q?", true},
		{`{"hook_event_name":"Notification","notification_type":"agent_needs_input"}`, "question", "", true},
		{`{"hook_event_name":"Notification","notification_type":"idle_prompt","message":"a\u001b[2Jb\n"}`, "idle", "a [2Jb", true},
		{`{"hook_event_name":"Notification","notification_type":"auth_success","message":"x"}`, "", "", false},
		{`{"hook_event_name":"Stop","stop_hook_active":false}`, "done", "", true},
		{`{"hook_event_name":"UserPromptSubmit","prompt":"secret plans"}`, "working", "", true},
		{`{"hook_event_name":"PreToolUse"}`, "", "", false},
		{`not json`, "", "", false},
	}
	for _, c := range cases {
		kind, text, ok := ClaudeHook([]byte(c.in))
		if kind != c.kind || text != c.text || ok != c.ok {
			t.Errorf("%s: got %q %q %v, want %q %q %v", c.in, kind, text, ok, c.kind, c.text, c.ok)
		}
	}
}

func TestClaudeHooks(t *testing.T) {
	raw := ClaudeHooks("/usr/local/bin/muxway notify --from claude-code")
	var v struct {
		Hooks map[string][]struct {
			Matcher string `json:"matcher"`
			Hooks   []struct {
				Type, Command string
				Async         bool
				Timeout       int
			} `json:"hooks"`
		} `json:"hooks"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	for _, ev := range []string{"Notification", "Stop", "UserPromptSubmit"} {
		h := v.Hooks[ev]
		if len(h) != 1 || len(h[0].Hooks) != 1 || h[0].Hooks[0].Type != "command" || !h[0].Hooks[0].Async ||
			!strings.HasSuffix(h[0].Hooks[0].Command, "notify --from claude-code") {
			t.Errorf("%s: %s", ev, raw)
		}
	}
	if !strings.Contains(v.Hooks["Notification"][0].Matcher, "permission_prompt") || v.Hooks["Stop"][0].Matcher != "" {
		t.Errorf("matchers: %s", raw)
	}
}
