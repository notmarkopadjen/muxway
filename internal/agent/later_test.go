package agent

import (
	"log/slog"
	"testing"

	"github.com/notmarkopadjen/muxway/internal/tmux"
)

func TestInputWakesAParkedPane(t *testing.T) {
	a := &Agent{log: slog.New(slog.DiscardHandler), attention: map[string]tmux.Attention{"%1": {Kind: "done"}}, later: map[string]int64{"%1": 7, "%2": 9}}
	a.clearAttention("%1")
	if _, ok := a.later["%1"]; ok {
		t.Fatal("input into a parked pane left it parked")
	}
	if _, ok := a.attention["%1"]; ok {
		t.Fatal("input left the attention")
	}
	if at := a.later["%2"]; at != 9 {
		t.Fatal("another pane's parking was touched")
	}
}
