package agent

import (
	"context"
	"strings"
	"time"

	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

// The watcher: every few seconds the agent reads the visible screen of
// each exposed pane that runs a known harness (the screen, not the
// history: a prompt that scrolled away is over) and tells the hub when
// its state changes, so a harness without hooks shows as working,
// waiting or done. The texts are fixed phrases; a row of the screen never
// travels. A pane that has notified over the socket is left to its hooks
// for working and done; a prompt on its screen is still reported while
// its hooks have said nothing about it, since not every harness has a
// hook for a permission.

const (
	watchEvery = 2 * time.Second
	// How long the screen stays still at the input prompt before a pane
	// that was working counts as done.
	watchStill = 8 * time.Second
)

// The watcher's phrases, the only texts it sends.
var watchText = map[string]string{
	wire.KindPermission: "asks for a permission",
	wire.KindQuestion:   "asks a question",
	wire.KindDone:       "finished",
}

// watched is what the watcher last saw in one pane.
type watched struct {
	last      string    // the rows, to see a change
	state     string    // "", working, waiting:<kind>, done
	changedAt time.Time // when the screen last moved
	// ownPrompt says the pane's attention is a prompt the watcher raised,
	// which it may clear when the screen moves on.
	ownPrompt bool
}

func (a *Agent) watch(ctx context.Context) {
	t := time.NewTicker(watchEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			a.watchOnce(ctx)
		}
	}
}

func (a *Agent) watchOnce(ctx context.Context) {
	panes, err := a.list(ctx)
	if err != nil {
		return
	}
	for _, p := range panes {
		if !p.Exposed() || !a.sameProcess(p) {
			continue
		}
		h := detectHarness(p.Command, p.Title)
		if h == nil {
			a.mu.Lock()
			delete(a.watched, p.PaneID)
			a.mu.Unlock()
			continue
		}
		content, _, err := a.tmux.Capture(ctx, p.PaneID, 0, false, true)
		if err != nil {
			continue
		}
		if kind, text := a.watchPane(p, h, content, time.Now()); kind != "" {
			a.tell(ctx, p, kind, text)
		}
	}
}

// watchPane folds one capture into the pane's state and says what to
// report, if anything.
func (a *Agent) watchPane(p tmux.Pane, h *harness, content string, now time.Time) (string, string) {
	rows := strings.Split(content, "\n")
	s := classify(h, rows)
	a.mu.Lock()
	defer a.mu.Unlock()
	hooked := a.hooked[p.PaneID]
	_, attended := a.attention[p.PaneID]
	w := a.watched[p.PaneID]
	first := w == nil
	if first {
		w = &watched{last: content, changedAt: now}
		a.watched[p.PaneID] = w
	}
	changed := !first && content != w.last
	w.last = content
	if changed {
		w.changedAt = now
	}
	if hooked {
		// The hooks own working and done. A prompt is reported while they
		// have said nothing about it, and cleared when the screen moves on.
		switch {
		case s.waiting != "" && !attended && w.state != "waiting:"+s.waiting:
			w.state, w.ownPrompt = "waiting:"+s.waiting, true
			return s.waiting, watchText[s.waiting]
		case s.waiting == "" && changed && w.ownPrompt:
			w.state, w.ownPrompt = "working", false
			return wire.KindWorking, ""
		}
		return "", ""
	}
	// The first look only remembers: a harness sitting at its prompt when
	// the agent starts has nothing to report; a prompt already up does.
	switch {
	case s.waiting != "":
		if w.state != "waiting:"+s.waiting {
			w.state, w.ownPrompt = "waiting:"+s.waiting, true
			return s.waiting, watchText[s.waiting]
		}
	case first:
	case changed:
		if w.state != "working" {
			w.state, w.ownPrompt = "working", false
			return wire.KindWorking, ""
		}
	case w.state == "working" && s.atPrompt && now.Sub(w.changedAt) >= watchStill:
		w.state = "done"
		return wire.KindDone, watchText[wire.KindDone]
	}
	return "", ""
}

// tell records what the watcher saw as the pane's attention and sends it,
// like a notification but without claiming the pane for hooks.
func (a *Agent) tell(ctx context.Context, p tmux.Pane, kind, text string) {
	a.mu.Lock()
	if kind == wire.KindWorking {
		delete(a.attention, p.PaneID)
		p.Attention = nil
	} else {
		att := tmux.Attention{Kind: kind, At: time.Now().Unix(), Text: text}
		a.attention[p.PaneID] = att
		p.Attention = &att
	}
	a.mu.Unlock()
	a.log.Info("notify", "pane", p.PaneID, "kind", kind, "source", sourceWatcher, "result", "ok")
	a.send(ctx, p, kind, text)
}
