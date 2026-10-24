package wire

import (
	"strings"
	"testing"
)

func TestCleanText(t *testing.T) {
	cases := map[string]string{
		"plain":               "plain",
		"  two   words  ":     "two words",
		"a\x1b[31mred\x1b[0m": "a [31mred [0m",
		"tab\tand\nnewline":   "tab and newline",
		"c1\u0085x\u009fy":    "c1 x y",
		"":                    "",
		"\x00\x01":            "",
		"ok�":                 "ok",
		"čćž 日本":              "čćž 日本",
	}
	for in, want := range cases {
		if got := CleanText(in); got != want {
			t.Errorf("CleanText(%q) = %q, want %q", in, got, want)
		}
	}
	long := strings.Repeat("ab", 300)
	if got := CleanText(long); len([]rune(got)) != MaxEventText {
		t.Errorf("long text not capped: %d", len([]rune(got)))
	}
	for _, bad := range []string{"a\tb", " lead", "trail ", "x\x1by", strings.Repeat("a", MaxEventText+1)} {
		if ValidEventText(bad) {
			t.Errorf("ValidEventText(%q) should be false", bad)
		}
	}
	if !ValidEventText("Claude needs your permission to use Bash") || !ValidEventText("") {
		t.Error("clean text refused")
	}
}

func TestValidText(t *testing.T) {
	for _, ok := range []string{"a", "two\nlines", "ends\n", "\n", "čćž 日本", strings.Repeat("a\n", MaxTextBytes/2)} {
		if !ValidText(ok) {
			t.Errorf("ValidText(%q) should be true", ok)
		}
	}
	for _, bad := range []string{"", "a\rb", "a\r\nb", "tab\there", "\x1b[200~x\x1b[201~", "del\x7f", "c1\u0085", "ok\ufffd", strings.Repeat("a\n", MaxTextBytes/2) + "a"} {
		if ValidText(bad) {
			t.Errorf("ValidText(%q) should be false", bad)
		}
	}
}

func TestKnownKind(t *testing.T) {
	for _, k := range []string{KindQuestion, KindPermission, KindIdle, KindDone, KindWorking} {
		if !KnownKind(k) {
			t.Errorf("%s unknown", k)
		}
	}
	for _, k := range []string{"", "Question", "exec", "done\n"} {
		if KnownKind(k) {
			t.Errorf("%q known", k)
		}
	}
}
