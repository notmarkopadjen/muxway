package hub

import (
	"testing"

	"github.com/notmarkopadjen/muxway/internal/tmux"
)

func TestSanePanes(t *testing.T) {
	panes := []tmux.Pane{
		{Width: 80, Height: 24, CursorX: 3, CursorY: 24},
		{Width: 80, Height: 24, CursorX: 81, CursorY: 1},
		{Width: 80, Height: 24, CursorX: 1, CursorY: 25},
		{Width: 80, Height: 24, CursorX: 0, CursorY: 0},
		{Width: 80, Height: 24, CursorX: -4, CursorY: 2},
	}
	sanePanes(panes)
	if panes[0].CursorX != 3 || panes[0].CursorY != 24 {
		t.Fatal("a cursor inside the pane was changed")
	}
	for _, p := range panes[1:] {
		if p.CursorX != 0 || p.CursorY != 0 {
			t.Fatalf("a cursor outside the pane kept: %+v", p)
		}
	}
}
