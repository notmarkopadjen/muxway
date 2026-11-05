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

func TestGrowGivesBackWithANegativeDelta(t *testing.T) {
	s := "dddb,200x50,0,0{100x50,0,0[100x25,0,0,1,100x24,0,26,3],99x50,101,0,2}"
	// The right pane narrower: it shrinks, the window with it, the left
	// column keeps its width.
	got, w, h, err := GrowLayout(s, "%2", -10, 0)
	if err != nil || w != 190 || h != 50 || got[5:] != "190x50,0,0{100x50,0,0[100x25,0,0,1,100x24,0,26,3],89x50,101,0,2}" {
		t.Fatalf("right shrunk: %s %dx%d %v", got, w, h, err)
	}
	// The top left pane narrower and shorter: its column narrows, the
	// pane under it narrows with it and moves up, the right pane moves
	// over and loses the height.
	got, w, h, err = GrowLayout(s, "%1", -7, -3)
	if err != nil || w != 193 || h != 47 || got[5:] != "193x47,0,0{93x47,0,0[93x22,0,0,1,93x24,0,23,3],99x47,94,0,2}" {
		t.Fatalf("top left shrunk: %s %dx%d %v", got, w, h, err)
	}
	// A pane cannot give more than it has.
	if _, _, _, err := GrowLayout(s, "%2", -99, 0); err == nil {
		t.Fatal("a pane gave every column it had")
	}
}

func TestLeastAndScaleFloor(t *testing.T) {
	// Four panes in a row above one.
	s := "0000,200x50,0,0[200x30,0,0{50x30,0,0,1,49x30,51,0,2,49x30,101,0,3,49x30,151,0,4},200x19,0,31,5]"
	if w, h, err := LeastLayout(s); err != nil || w != 4*floorCols+3 || h != 2*floorRows+1 {
		t.Fatalf("least: %d×%d %v", w, h, err)
	}
	// Scaled to 100 columns, a plain scale leaves the row's panes near 24
	// each, above the floor; at 70 it would leave them 16: the floor
	// scale cannot help within the row, every pane is at the floor, so
	// the row is laid out as a scale would and the caller sizes the
	// window to least first.
	root, _ := parseLayout(s)
	if err := root.scaleFloor(100, 50, 0, 0); err != nil {
		t.Fatal(err)
	}
	for _, c := range root.children[0].children {
		if c.w < floorCols {
			t.Fatalf("a pane under the floor at 100 columns: %s", root.String())
		}
	}
	// The row shorter than the floor allows (3 rows of 50): the bottom
	// pane, with room, gives the rows.
	s = "0000,200x50,0,0[200x3,0,0{50x3,0,0,1,49x3,51,0,2,49x3,101,0,3,49x3,151,0,4},200x46,0,4,5]"
	root, _ = parseLayout(s)
	if err := root.scaleFloor(200, 50, 0, 0); err != nil {
		t.Fatal(err)
	}
	if row, bottom := root.children[0], root.children[1]; row.h != floorRows || bottom.h != 50-floorRows-1 || bottom.y != floorRows+1 {
		t.Fatalf("the floor was not taken from the pane with room: %s", root.String())
	}
	// A zoomed pane's cell underneath is a pane like any other: a row of
	// one wide pane and one narrow gives the narrow one its floor from
	// the wide one, the window as asked.
	s = "0000,100x20,0,0{90x20,0,0,1,9x20,91,0,2}"
	root, _ = parseLayout(s)
	if err := root.scaleFloor(100, 20, 0, 0); err != nil {
		t.Fatal(err)
	}
	if a, b := root.children[0], root.children[1]; b.w != floorCols || a.w != 100-floorCols-1 || root.w != 100 {
		t.Fatalf("the narrow pane did not get its floor from the wide one: %s", root.String())
	}
}
