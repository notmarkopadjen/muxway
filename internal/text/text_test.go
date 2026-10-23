package text

import (
	"reflect"
	"testing"
)

func TestStripAndWrap(t *testing.T) {
	in := "\x1b[1;32mhello\x1b[0m world\x1b]0;title\x07\nsecond line here\n\n\n"
	got := Wrap(in, 6, 0)
	want := []string{"hello ", "world", "second", " line ", "here"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q", got)
	}
	if got := Wrap("a\nb\nc", 10, 2); !reflect.DeepEqual(got, []string{"b", "c"}) {
		t.Fatalf("last: %q", got)
	}
	if got := Wrap("čćžšđ", 2, 0); !reflect.DeepEqual(got, []string{"čć", "žš", "đ"}) {
		t.Fatalf("runes: %q", got)
	}
}
