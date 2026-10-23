package hub

import (
	"context"
	"sync"
	"time"

	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

// Events agents sent, kept in memory for clients to poll. The ring is
// bounded; the cursor starts over with the hub.
const (
	eventRing  = 500
	eventRate  = 10 // per agent, per second
	eventBurst = 30
	maxWait    = 30 * time.Second
)

type event struct {
	Seq  uint64
	At   int64
	Host string
	Pane tmux.Pane
	Kind string
	Text string
}

type eventLog struct {
	mu   sync.Mutex
	seq  uint64
	ring []event
	wake chan struct{}
}

func newEventLog() *eventLog { return &eventLog{wake: make(chan struct{})} }

func (l *eventLog) add(host string, ev wire.Event) event {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.seq++
	e := event{Seq: l.seq, At: time.Now().Unix(), Host: host, Pane: ev.Pane, Kind: ev.Kind, Text: ev.Text}
	if len(l.ring) == eventRing {
		copy(l.ring, l.ring[1:])
		l.ring = l.ring[:eventRing-1]
	}
	l.ring = append(l.ring, e)
	close(l.wake)
	l.wake = make(chan struct{})
	return e
}

func (l *eventLog) cursor() uint64 {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.seq
}

// after returns up to limit visible events with a sequence number above
// cursor, and the cursor a client continues from. Without a cursor (a
// value above the current one), the most recent visible events.
func (l *eventLog) after(cursor uint64, limit int, visible func(event) bool) ([]event, uint64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	var out []event
	if cursor > l.seq {
		for i := len(l.ring) - 1; i >= 0 && len(out) < limit; i-- {
			if visible(l.ring[i]) {
				out = append(out, l.ring[i])
			}
		}
		for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
			out[i], out[j] = out[j], out[i]
		}
		return out, l.seq
	}
	for _, e := range l.ring {
		if e.Seq > cursor && visible(e) {
			out = append(out, e)
			if len(out) == limit {
				return out, e.Seq
			}
		}
	}
	return out, l.seq
}

// wait blocks until an event is added after cursor, or ctx ends.
func (l *eventLog) wait(ctx context.Context, cursor uint64) {
	l.mu.Lock()
	if l.seq > cursor {
		l.mu.Unlock()
		return
	}
	ch := l.wake
	l.mu.Unlock()
	select {
	case <-ch:
	case <-ctx.Done():
	}
}
