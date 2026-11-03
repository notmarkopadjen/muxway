package hub

import (
	"testing"

	"github.com/notmarkopadjen/muxway/internal/tmux"
)

func TestInboxOrderAndKinds(t *testing.T) {
	att := func(kind string, at int64) *tmux.Attention { return &tmux.Attention{Kind: kind, At: at} }
	out := []PaneView{
		{Address: "a/w/0.0", Pane: tmux.Pane{Attention: att("done", 30), Later: true, LaterAt: 40}},
		{Address: "a/w/0.1", Pane: tmux.Pane{Attention: att("question", 20)}},
		{Address: "a/w/0.2", Pane: tmux.Pane{Later: true, LaterAt: 25}},
		{Address: "a/w/0.3", Pane: tmux.Pane{Attention: att("permission", 10)}},
	}
	sortInbox(out)
	want := []string{"a/w/0.3", "a/w/0.1", "a/w/0.2", "a/w/0.0"}
	for i, v := range out {
		if v.Address != want[i] {
			t.Fatalf("order %d: %s, want %s", i, v.Address, want[i])
		}
	}
	if k := textKind(out[0].Pane); k != "permission" {
		t.Fatalf("awake kind %q", k)
	}
	if k := textKind(out[3].Pane); k != "later" {
		t.Fatalf("a parked pane's kind %q, want later", k)
	}
	if k := textKind(tmux.Pane{}); k != "" {
		t.Fatalf("a quiet pane's kind %q", k)
	}
	if at := inboxAt(out[2].Pane); at != 25 {
		t.Fatalf("a parked pane without attention waits since %d, want its parking", at)
	}
	if at := inboxAt(out[3].Pane); at != 30 {
		t.Fatalf("a parked pane with attention waits since %d, want the attention", at)
	}
}
