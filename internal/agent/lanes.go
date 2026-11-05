package agent

import (
	"context"
	"time"

	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

// The hub's requests are served concurrently, in lanes, so a key never
// waits behind a read. A read takes one of a few permits; a write to a
// pane waits for the writes that came before it to that pane; an op
// that moves windows runs alone.
const (
	readPermits  = 4
	maxInFlight  = 256
	requestLimit = 10 * time.Second
	// A read may use a listing this old; a write lists afresh.
	listShared = 500 * time.Millisecond
	// A capture is reused while the pane stands still, this long at most.
	captureKept = 5 * time.Second
	captureMax  = 256
)

type lane int

const (
	laneRead lane = iota
	laneWrite
	laneShape
	laneList
)

// laneOf says which lane an op runs in; anything unknown only looks.
func laneOf(op string) lane {
	switch op {
	case wire.OpInput, wire.OpAnswer, wire.OpMail, wire.OpLater, wire.OpAlias, wire.OpFile:
		return laneWrite
	case wire.OpSplit, wire.OpNewSession, wire.OpKillPane, wire.OpClosePane, wire.OpResize:
		return laneShape
	case wire.OpList:
		return laneList
	}
	return laneRead
}

// turn is a write's place in its pane's queue: it runs once the one
// before it is done, and the one after waits for it.
type turn struct {
	prev, done chan struct{}
	pane       string
}

// claim takes the next place in the pane's queue, in arrival order: the
// loop calls it before it hands the request to a goroutine.
func (a *Agent) claim(req wire.Request) *turn {
	if laneOf(req.Op) != laneWrite {
		return nil
	}
	t := &turn{done: make(chan struct{}), pane: req.Pane}
	a.mu.Lock()
	if a.writes == nil {
		a.writes = map[string]chan struct{}{}
	}
	t.prev = a.writes[req.Pane]
	a.writes[req.Pane] = t.done
	a.mu.Unlock()
	return t
}

// wait blocks until the write before this one is done.
func (t *turn) wait(ctx context.Context) error {
	if t.prev == nil {
		return nil
	}
	select {
	case <-t.prev:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (a *Agent) release(t *turn) {
	close(t.done)
	a.mu.Lock()
	if a.writes[t.pane] == t.done {
		delete(a.writes, t.pane)
	}
	a.mu.Unlock()
}

// serve runs one request in its lane and answers it. A write whose turn
// never comes within the deadline is refused, not typed late.
func (a *Agent) serve(ctx context.Context, req wire.Request, t *turn) wire.Response {
	switch laneOf(req.Op) {
	case laneWrite:
		defer a.release(t)
		if err := t.wait(ctx); err != nil {
			return wire.Response{ID: req.ID, Error: wire.ErrTmux}
		}
	case laneShape:
		a.shape.Lock()
		defer a.shape.Unlock()
	case laneRead:
		select {
		case a.reads <- struct{}{}:
			defer func() { <-a.reads }()
		case <-ctx.Done():
			return wire.Response{ID: req.ID, Error: wire.ErrTmux}
		}
	}
	return a.Handle(ctx, req)
}

// listing is one run of tmux's list, shared by whoever asks while it runs.
type listing struct {
	done  chan struct{}
	panes []tmux.Pane
	err   error
	at    time.Time
}

// listShared answers a listing taken within maxAge, or the one in
// flight, or takes one. The side effects of a listing (sweeping what is
// gone) run once per run, as they would for a request of its own.
func (a *Agent) listShared(ctx context.Context, maxAge time.Duration) ([]tmux.Pane, time.Time, error) {
	a.mu.Lock()
	if l := a.lastList; l != nil && maxAge > 0 && time.Since(l.at) < maxAge && l.err == nil {
		a.mu.Unlock()
		return l.panes, l.at, nil
	}
	if l := a.listNow; l != nil {
		a.mu.Unlock()
		select {
		case <-l.done:
			return l.panes, l.at, l.err
		case <-ctx.Done():
			return nil, time.Time{}, ctx.Err()
		}
	}
	l := &listing{done: make(chan struct{}), at: time.Now()}
	a.listNow = l
	a.mu.Unlock()
	l.panes, l.err = a.list(ctx)
	a.mu.Lock()
	a.listNow = nil
	if l.err == nil {
		a.lastList = l
	}
	a.mu.Unlock()
	close(l.done)
	return l.panes, l.at, l.err
}

// findIn finds an exposed pane in a listing.
func (a *Agent) findIn(panes []tmux.Pane, paneID string) (tmux.Pane, bool) {
	for _, p := range panes {
		if p.PaneID == paneID && p.Exposed() && a.sameProcess(p) {
			return p, true
		}
	}
	return tmux.Pane{}, false
}

// capture is what a pane showed when it was last read, with what the
// listing said of the pane then, so a later read can tell the pane has
// not moved since.
type capture struct {
	content string
	trimmed int
	at      time.Time
	cursorX int
	cursorY int
	width   int
	height  int
}

type captureKey struct {
	pane  string
	lines int
	ansi  bool
	join  bool
}

// unmoved says whether a listing shows the pane as it was when the
// capture was taken: the window's last activity falls in a second before
// the capture (tmux keeps whole seconds, so output in the capture's own
// second counts as moved), the cursor and the size are the same.
func (c *capture) unmoved(p tmux.Pane) bool {
	return p.Activity < c.at.Unix() &&
		p.CursorX == c.cursorX && p.CursorY == c.cursorY && p.Width == c.width && p.Height == c.height
}

// still says whether a kept capture is what a capture now would give:
// the pane unmoved in a listing younger than the capture, and the
// capture not old.
func (c *capture) still(p tmux.Pane, listedAt, now time.Time) bool {
	return c.unmoved(p) && listedAt.After(c.at) && now.Sub(c.at) < captureKept
}

// read answers a pane's content: from the kept capture while the pane
// stands still, else from tmux. The listing is shared with other reads;
// one older than the kept capture cannot say whether a pane it shows
// unmoved has moved since, so a fresh one is taken then, shared with
// whoever asks at the same moment: one listing for every idle pane
// read in that moment, where a capture would be one per pane.
func (a *Agent) read(ctx context.Context, paneID string, lines int, ansi, join bool) (string, int, string) {
	panes, listedAt, err := a.listShared(ctx, listShared)
	if err != nil {
		return "", 0, wire.ErrTmux
	}
	p, ok := a.findIn(panes, paneID)
	if !ok {
		return "", 0, wire.ErrNotExposed
	}
	k := captureKey{paneID, lines, ansi, join}
	a.mu.Lock()
	c := a.captures[k]
	a.mu.Unlock()
	if c != nil && c.unmoved(p) && !listedAt.After(c.at) {
		if panes, listedAt, err = a.listShared(ctx, 0); err != nil {
			return "", 0, wire.ErrTmux
		}
		if p, ok = a.findIn(panes, paneID); !ok {
			return "", 0, wire.ErrNotExposed
		}
	}
	if c != nil && c.still(p, listedAt, time.Now()) {
		return c.content, c.trimmed, ""
	}
	at := time.Now()
	content, trimmed, err := a.tmux.Capture(ctx, p.PaneID, lines, ansi, join)
	if err != nil {
		return "", 0, wire.ErrTmux
	}
	a.mu.Lock()
	if a.captures == nil {
		a.captures = map[captureKey]*capture{}
	}
	if len(a.captures) >= captureMax {
		var oldest captureKey
		var oldestAt time.Time
		for k, c := range a.captures {
			if oldestAt.IsZero() || c.at.Before(oldestAt) {
				oldest, oldestAt = k, c.at
			}
		}
		delete(a.captures, oldest)
	}
	a.captures[k] = &capture{content: content, trimmed: trimmed, at: at, cursorX: p.CursorX, cursorY: p.CursorY, width: p.Width, height: p.Height}
	a.mu.Unlock()
	return content, trimmed, ""
}

// sweepCaptures forgets the captures of panes that are gone. Under a.mu.
func (a *Agent) sweepCaptures(alive map[string]bool) {
	for k := range a.captures {
		if !alive[k.pane] {
			delete(a.captures, k)
		}
	}
}
