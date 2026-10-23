package hub

import (
	"testing"

	"github.com/notmarkopadjen/muxway/internal/tmux"
)

func TestGrantPatterns(t *testing.T) {
	pane := tmux.Pane{SessionName: "work", WindowIndex: 1, WindowName: "logs", PaneIndex: 2, Alias: "build"}
	cases := map[string]bool{
		"alice-laptop": true, "alice-laptop/*": true, "*": true, "alice-*": true,
		"alice-laptop/work": true, "alice-laptop/work/1.2": true, "alice-laptop/work/logs.*": true,
		"alice-laptop/work/1.*": true, "alice-laptop/w*/*": true, "alice-laptop/@build": true,
		"bob-desktop": false, "alice-laptop/other": false, "alice-laptop/work/0.*": false,
		"alice-laptop/work/1.3": false, "alice-laptop/@logs": false, "*/@build": true,
	}
	for s, want := range cases {
		p, err := parsePattern(s)
		if err != nil {
			t.Fatalf("%s: %v", s, err)
		}
		if got := p.matches("alice-laptop", pane); got != want {
			t.Errorf("%s: got %v, want %v", s, got, want)
		}
	}
	for _, bad := range []string{"", "/work", "alice-laptop/@Bad", "alice-laptop//x"} {
		if _, err := parsePattern(bad); err == nil {
			t.Errorf("accepted %q", bad)
		}
	}
	// A name full of glob characters is matched literally.
	star := tmux.Pane{SessionName: "*"}
	if p, _ := parsePattern("alice-laptop/work"); p.matches("alice-laptop", star) {
		t.Error("session named * matched a grant for work")
	}
}
