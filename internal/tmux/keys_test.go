package tmux

import (
	"strings"
	"testing"
)

func TestKeyNameTakesTheGrammar(t *testing.T) {
	for key, want := range map[string]string{
		"Enter": "Enter", "Insert": "IC", "C-Delete": "C-DC", "BTab": "BTab", "F12": "F12",
		"C-c": "C-c", "C-M-a": "C-M-a", "M-x": "M-x", "C-M-S-F5": "C-M-S-F5", "S-Up": "S-Up",
		"M-S-PageDown": "M-S-PageDown", "KP7": "KP7", "C-KPEnter": "C-KPEnter", "KP/": "KP/",
		"C-[": "C-[", `M-\`: `M-\`, "M-'": "M-'", "C-.": "C-.", "M-`": "M-`", "C-0": "C-0",
	} {
		if got, ok := KeyName(key); !ok || got != want {
			t.Errorf("%q: %q %v, want %q", key, got, ok, want)
		}
	}
}

func TestKeyNameRefusesTheRest(t *testing.T) {
	for _, key := range []string{
		"", "a", "A", "C-", "C-;", "M-;", "F13", "F0", "S-a", "C-S-a", "C-A", "M-C-a", "S-C-a",
		"C-C-a", "C-M-M-a", "KP10", "KP", "C-\x1b", "C-a;kill-server", "Up\n", "up", "enter",
		"C-é", "M-#", "C-ab", "IC", "DC", "PgUp", "C- ", " Enter", strings.Repeat("C-", 9) + "a",
	} {
		if got, ok := KeyName(key); ok {
			t.Errorf("%q taken as %q", key, got)
		}
	}
}
