package text

import "testing"

func TestFold(t *testing.T) {
	cases := []struct{ in, latin1, ascii string }{
		{"─━═│║┌┐└┘├┤┬┴┼╔╗╚╝╱╲╳", "--=||+++++++++++++/\\X", "--=||+++++++++++++/\\X"},
		{"▀▄█░▒▓", "######", "######"},
		{"❯ › » ▶ ▸ ⏵ ➜ → ← ↑ ↓", "> > » > > > > > < ^ v", "> > > > > > > > < ^ v"},
		{"● • ○ ◦ ■ □ ▪ ◆ ★ ☆ ⠋⠙ ✳ ✻ ✽ ✶ ✢ ✦ ✧ ⎿", "* * * * * * * * * * ** * * * * * * * +", "* * * * * * * * * * ** * * * * * * * +"},
		{"a·b…c—d–e−f×g", "a·b...c-d-e-f×g", "a.b...c-d-e-fxg"},
		{"✓ ✔ ✗ ✘ ✖ ⚠", "v v x x x !", "v v x x x !"},
		{"‘q’ “q” x y", "'q' \"q\" x y", "'q' \"q\" x y"},
		{"äöü ÄÖÜ ß æ Æ ñ é ø Þ", "äöü ÄÖÜ ß æ Æ ñ é ø Þ", "aou AOU ss ae AE n e o Th"},
		{"čćžšđ ČĆŽŠĐ ł Ł ő ű ĳ Œ ſ", "cczsd CCZSD l L o u ij OE s", "cczsd CCZSD l L o u ij OE s"},
		{"日本 € ∑ 😀", "?? ? ? ?", "?? ? ? ?"},
		{"plain ascii stays", "plain ascii stays", "plain ascii stays"},
		{"bad \xff byte", "bad ? byte", "bad ? byte"},
	}
	for _, c := range cases {
		if got := Fold(c.in, Latin1); got != c.latin1 {
			t.Errorf("latin1 %q: got %q, want %q", c.in, got, c.latin1)
		}
		if got := Fold(c.in, ASCII); got != c.ascii {
			t.Errorf("ascii %q: got %q, want %q", c.in, got, c.ascii)
		}
		if got := Fold(c.in, UTF8); got != c.in {
			t.Errorf("utf-8 changed %q to %q", c.in, got)
		}
	}
}

func TestEncode(t *testing.T) {
	if got := Encode("ä-日", Latin1); string(got) != "\xe4-?" {
		t.Errorf("latin1 bytes: %q", got)
	}
	if got := Encode("ä", UTF8); string(got) != "ä" {
		t.Errorf("utf-8 bytes: %q", got)
	}
	for _, c := range []struct {
		cs   string
		ok   bool
		mime string
	}{{"utf-8", true, "text/plain; charset=utf-8"}, {"latin1", true, "text/plain; charset=iso-8859-1"},
		{"ascii", true, "text/plain; charset=us-ascii"}, {"ASCII", false, ""}, {"utf-16", false, ""}, {"", false, ""}} {
		if Charset(c.cs) != c.ok {
			t.Errorf("Charset(%q) = %v", c.cs, !c.ok)
		}
		if c.ok && ContentType(c.cs) != c.mime {
			t.Errorf("ContentType(%q) = %q", c.cs, ContentType(c.cs))
		}
	}
}
