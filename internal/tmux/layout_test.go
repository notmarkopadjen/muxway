package tmux

import "testing"

func TestLayoutRoundTrip(t *testing.T) {
	// Both strings are tmux's own, checksums included.
	for _, s := range []string{
		"a87d,100x30,0,0,0",
		"dddb,200x50,0,0{100x50,0,0[100x25,0,0,1,100x24,0,26,3],99x50,101,0,2}",
	} {
		root, err := parseLayout(s)
		if err != nil {
			t.Fatalf("%s: %v", s, err)
		}
		if got := root.String(); got != s {
			t.Fatalf("round trip:\n%s\n%s", s, got)
		}
	}
	for _, bad := range []string{"", "a87d", "a87d,100x30", "a87d,100x30,0,0", "a87d,100x30,0,0{50x30,0,0,3", "a87d,100x30,0,0,1,junk", "100x30,0,0,1"} {
		if _, err := parseLayout(bad); err == nil {
			t.Fatalf("%q parsed", bad)
		}
	}
}

func TestScaleLayoutKeepsProportions(t *testing.T) {
	// Two stacked panes on the left, one on the right, in a 200x50 window.
	s := "dddb,200x50,0,0{100x50,0,0[100x25,0,0,1,100x24,0,26,3],99x50,101,0,2}"
	got, err := ScaleLayout(s, 90, 25)
	if err != nil {
		t.Fatal(err)
	}
	root, err := parseLayout(got)
	if err != nil {
		t.Fatalf("%s: %v", got, err)
	}
	left, right := root.children[0], root.children[1]
	if left.w+1+right.w != 90 || left.w < 44 || left.w > 46 {
		t.Fatalf("widths %d and %d", left.w, right.w)
	}
	top, bottom := left.children[0], left.children[1]
	if top.h+1+bottom.h != 25 || top.h != 12 || bottom.h != 12 || bottom.y != 13 {
		t.Fatalf("heights %d at %d and %d at %d", top.h, top.y, bottom.h, bottom.y)
	}
	if right.x != left.w+1 || right.h != 25 || top.id != 1 || bottom.id != 3 || right.id != 2 {
		t.Fatalf("scaled: %s", got)
	}
	if _, err := ScaleLayout(s, 90, 2); err == nil {
		t.Fatal("two stacked panes fit in two rows")
	}
}
