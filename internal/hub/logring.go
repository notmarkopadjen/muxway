package hub

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

// The access log: every record at Info and above, as the hub's own log
// has it, kept in memory for admins to read. It holds no more than the
// journal does.
const logRing = 2000

// LogRecord is one line of the hub's log.
type LogRecord struct {
	Seq   uint64            `json:"seq"`
	At    int64             `json:"at"`
	Level string            `json:"level"`
	Msg   string            `json:"msg"`
	Attrs map[string]string `json:"attrs,omitempty"`
}

type logRingBuf struct {
	mu   sync.Mutex
	seq  uint64
	ring []LogRecord
	wake chan struct{}
}

func newLogRing() *logRingBuf { return &logRingBuf{wake: make(chan struct{})} }

func (l *logRingBuf) add(rec LogRecord) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.seq++
	rec.Seq = l.seq
	if len(l.ring) == logRing {
		copy(l.ring, l.ring[1:])
		l.ring = l.ring[:logRing-1]
	}
	l.ring = append(l.ring, rec)
	close(l.wake)
	l.wake = make(chan struct{})
}

// after works like the event log's: records above cursor, or without a
// cursor the most recent ones.
func (l *logRingBuf) after(cursor uint64, limit int) ([]LogRecord, uint64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if cursor > l.seq {
		start := max(0, len(l.ring)-limit)
		return append([]LogRecord{}, l.ring[start:]...), l.seq
	}
	var out []LogRecord
	for _, rec := range l.ring {
		if rec.Seq > cursor {
			out = append(out, rec)
			if len(out) == limit {
				return out, rec.Seq
			}
		}
	}
	return out, l.seq
}

func (l *logRingBuf) wait(ctx context.Context, cursor uint64) {
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

// ringHandler passes every record on and keeps a copy of those at Info
// and above.
type ringHandler struct {
	next  slog.Handler
	ring  *logRingBuf
	attrs []slog.Attr
	group string
}

func (rh *ringHandler) Enabled(ctx context.Context, l slog.Level) bool {
	return l >= slog.LevelInfo || rh.next.Enabled(ctx, l)
}

func (rh *ringHandler) Handle(ctx context.Context, r slog.Record) error {
	if r.Level >= slog.LevelInfo {
		rec := LogRecord{At: r.Time.Unix(), Level: r.Level.String(), Msg: r.Message, Attrs: map[string]string{}}
		if r.Time.IsZero() {
			rec.At = time.Now().Unix()
		}
		for _, a := range rh.attrs {
			flatten(rec.Attrs, rh.group, a)
		}
		r.Attrs(func(a slog.Attr) bool {
			flatten(rec.Attrs, rh.group, a)
			return true
		})
		rh.ring.add(rec)
	}
	if rh.next.Enabled(ctx, r.Level) {
		return rh.next.Handle(ctx, r)
	}
	return nil
}

func flatten(m map[string]string, prefix string, a slog.Attr) {
	key := a.Key
	if prefix != "" {
		key = prefix + "." + key
	}
	v := a.Value.Resolve()
	if v.Kind() == slog.KindGroup {
		for _, g := range v.Group() {
			flatten(m, key, g)
		}
		return
	}
	m[key] = v.String()
}

func (rh *ringHandler) WithAttrs(as []slog.Attr) slog.Handler {
	c := *rh
	c.next = rh.next.WithAttrs(as)
	c.attrs = append(append([]slog.Attr{}, rh.attrs...), as...)
	return &c
}

func (rh *ringHandler) WithGroup(name string) slog.Handler {
	c := *rh
	c.next = rh.next.WithGroup(name)
	if c.group != "" {
		name = c.group + "." + name
	}
	c.group = name
	return &c
}
