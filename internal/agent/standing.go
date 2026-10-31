package agent

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/notmarkopadjen/muxway/internal/tmux"
)

// A standing mark names a session on the agent's command line: the agent
// marks the session whenever one of that name appears, so a session the
// owner starts again after it ended is exposed without another expose.

var standingName = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,32}$`)

// ParseExpose splits an --expose value, name=mode.
func ParseExpose(v string) (name, mode string, err error) {
	name, mode, ok := strings.Cut(v, "=")
	if !ok {
		return "", "", errors.New("--expose takes session=read or session=write")
	}
	if !standingName.MatchString(name) {
		return "", "", fmt.Errorf("--expose: a session name is 1 to 32 letters, digits, _ . or -, not %q", name)
	}
	if mode != tmux.ModeRead && mode != tmux.ModeWrite {
		return "", "", fmt.Errorf("--expose: the mode is read or write, not %q", mode)
	}
	return name, mode, nil
}

// applyStanding marks each session that has a standing mark and was not
// seen yet, once per session: an unexpose by hand holds while it lives. A
// session is its server's pid, its id and its creation time, so a
// restarted server that hands out the same ids is marked afresh. The panes given are updated in place
// so this listing already shows the mark.
func (a *Agent) applyStanding(ctx context.Context, panes []tmux.Pane) {
	if len(a.cfg.Expose) == 0 {
		return
	}
	key := func(p tmux.Pane) string { return fmt.Sprintf("%d/%s@%d", p.ServerPID, p.SessionID, p.SessionCreated) }
	alive := map[string]bool{}
	marked := map[string]string{}
	a.mu.Lock()
	for _, p := range panes {
		k := key(p)
		alive[k] = true
		mode, want := a.cfg.Expose[p.SessionName]
		if !want || a.standing[k] {
			continue
		}
		a.standing[k] = true
		marked[p.SessionID] = mode
	}
	for k := range a.standing {
		if !alive[k] {
			delete(a.standing, k)
		}
	}
	a.mu.Unlock()
	for id, mode := range marked {
		if err := a.tmux.MarkSession(ctx, id, mode); err != nil {
			a.log.Warn("standing mark not set", "session_id", id, "err", err)
			continue
		}
		name := ""
		for i := range panes {
			if panes[i].SessionID != id {
				continue
			}
			name = panes[i].SessionName
			if panes[i].Mode == "" {
				panes[i].Mode = mode
			}
		}
		a.log.Info("standing mark set", "session", name, "session_id", id, "mode", mode)
	}
}
