package tmux

import (
	"strings"
	"testing"
)

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

func TestLayoutPanes(t *testing.T) {
	ids, err := LayoutPanes("dddb,200x50,0,0{100x50,0,0[100x25,0,0,1,100x24,0,26,3],99x50,101,0,2}")
	if err != nil || strings.Join(ids, " ") != "%1 %2 %3" {
		t.Fatalf("%v %v", ids, err)
	}
	if _, err := LayoutPanes("junk"); err == nil {
		t.Fatal("junk parsed")
	}
}

func TestGrowMovesOnlyTheSiblingsInTheWay(t *testing.T) {
	s := "dddb,200x50,0,0{100x50,0,0[100x25,0,0,1,100x24,0,26,3],99x50,101,0,2}"
	// The right pane wider: the left column keeps its width.
	root, _ := parseLayout(s)
	if !root.grow(2, 10, 0) {
		t.Fatal("pane 2 not found")
	}
	if got := root.String(); got[5:] != "210x50,0,0{100x50,0,0[100x25,0,0,1,100x24,0,26,3],109x50,101,0,2}" {
		t.Fatalf("right grown: %s", got)
	}
	// The top left pane wider and taller: its column widens, the pane
	// under it widens with it and moves down, the right pane moves over
	// and takes the height.
	root, _ = parseLayout(s)
	if !root.grow(1, 7, 3) {
		t.Fatal("pane 1 not found")
	}
	if got := root.String(); got[5:] != "207x53,0,0{107x53,0,0[107x28,0,0,1,107x24,0,29,3],99x53,108,0,2}" {
		t.Fatalf("top left grown: %s", got)
	}
	// The bottom left pane taller: the top one stays, the right pane
	// takes the height.
	root, _ = parseLayout(s)
	root.grow(3, 0, 4)
	if got := root.String(); got[5:] != "200x54,0,0{100x54,0,0[100x25,0,0,1,100x28,0,26,3],99x54,101,0,2}" {
		t.Fatalf("bottom left grown: %s", got)
	}
	// Grown and written, tmux's own checksum: the string round-trips.
	again, err := parseLayout(root.String())
	if err != nil || again.String() != root.String() {
		t.Fatalf("round trip: %v", err)
	}
	if root.grow(9, 1, 1) {
		t.Fatal("a pane not in the layout grew")
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
