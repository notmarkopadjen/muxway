package agent

import (
	"context"

	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

// setAlias names an exposed, writable pane, or takes its name away with
// an empty alias, and returns the name it had. A name another pane of
// this server holds is refused: an alias is an address.
func (a *Agent) setAlias(ctx context.Context, req wire.Request) (string, string) {
	if req.Alias != "" && !wire.ValidAlias(req.Alias) {
		return "", wire.ErrBadInput
	}
	panes, err := a.list(ctx)
	if err != nil {
		return "", wire.ErrTmux
	}
	var p *tmux.Pane
	for i := range panes {
		if panes[i].PaneID == req.Pane {
			p = &panes[i]
		} else if req.Alias != "" && panes[i].Alias == req.Alias {
			return "", wire.ErrAliasTaken
		}
	}
	if p == nil || !p.Exposed() || !a.sameProcess(*p) {
		return "", wire.ErrNotExposed
	}
	if p.Mode != tmux.ModeWrite {
		return p.Alias, wire.ErrReadOnly
	}
	if p.Alias == req.Alias {
		return p.Alias, ""
	}
	if err := a.tmux.SetPaneAlias(ctx, p.PaneID, req.Alias); err != nil {
		return p.Alias, wire.ErrTmux
	}
	return p.Alias, ""
}
