package hub

import (
	"io"
	"log/slog"
	"testing"
)

func TestRingHandler(t *testing.T) {
	ring := newLogRing()
	log := slog.New(&ringHandler{next: slog.NewTextHandler(io.Discard, nil), ring: ring})
	log.Debug("not kept")
	log.With("host", "alice-laptop").Info("agent connected", "addr", "192.0.2.10")
	log.WithGroup("g").Warn("refused", "n", 3)
	recs, next := ring.after(^uint64(0), 10)
	if len(recs) != 2 || next != 2 {
		t.Fatalf("%d records, next %d", len(recs), next)
	}
	if r := recs[0]; r.Msg != "agent connected" || r.Attrs["host"] != "alice-laptop" || r.Attrs["addr"] != "192.0.2.10" || r.Level != "INFO" {
		t.Fatalf("first: %+v", r)
	}
	if r := recs[1]; r.Attrs["g.n"] != "3" || r.Level != "WARN" {
		t.Fatalf("second: %+v", r)
	}
	if recs, _ := ring.after(1, 10); len(recs) != 1 || recs[0].Seq != 2 {
		t.Fatalf("after 1: %+v", recs)
	}
	for i := 0; i < logRing+5; i++ {
		log.Info("x")
	}
	if recs, _ := ring.after(0, logRing+10); len(recs) != logRing || recs[0].Seq != 8 {
		t.Fatalf("ring: %d records from %d", len(recs), recs[0].Seq)
	}
}
