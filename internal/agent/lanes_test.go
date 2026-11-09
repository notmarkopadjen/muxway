package agent

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/notmarkopadjen/muxway/internal/secure"
	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

// fakeTmux puts a tmux of its own first on PATH: it lists the panes
// given, captures a line after a short while, takes keys, and writes
// what it was asked to a log, one line per call, start and end of each
// capture on lines of their own.
func fakeTmux(t *testing.T, panes []tmux.Pane) (tmux.Server, string) {
	t.Helper()
	dir := t.TempDir()
	log := filepath.Join(dir, "calls.log")
	for i, p := range panes {
		vals := map[string]string{
			"session_id": p.SessionID, "session_name": p.SessionName, "window_id": p.WindowID, "window_index": "0", "window_name": "w",
			"window_layout": "x", "window_active": "1", "pane_id": p.PaneID, "pane_index": fmt.Sprint(p.PaneIndex), "pane_active": "1",
			"pane_width": fmt.Sprint(p.Width), "pane_height": fmt.Sprint(p.Height), "pane_title": "t", "pane_current_command": "bash",
			"window_activity": fmt.Sprint(p.Activity), "@muxway-mode": p.Mode, "@muxway-alias": "", "pane_pid": "100",
			"window_zoomed_flag": "0", "mouse_any_flag": "0", "mouse_button_flag": "", "mouse_standard_flag": "", "mouse_all_flag": "",
			"cursor_x": fmt.Sprint(p.CursorX - 1), "cursor_y": fmt.Sprint(p.CursorY - 1), "session_created": "1", "pid": "99", "pane_current_path": "/home/alice",
		}
		var sed []string
		for k, v := range vals {
			sed = append(sed, fmt.Sprintf("s|#{%s}|%s|g", k, v))
		}
		os.WriteFile(filepath.Join(dir, fmt.Sprintf("pane-%d.sed", i)), []byte(strings.Join(sed, "\n")+"\n"), 0o600)
	}
	script := `#!/bin/sh
dir="$(dirname "$0")"
log="$dir/calls.log"
shift 2
case "$1" in
list-panes)
  echo "list-panes" >> "$log"
  sleep 0.05
  for f in "$dir"/pane-*.sed; do printf '%s\n' "$4" | sed -f "$f"; done
  ;;
capture-pane)
  echo "capture start $4" >> "$log"
  sleep 0.2
  echo "capture end $4" >> "$log"
  echo "a line of $4"
  ;;
send-keys)
  echo "send-keys $*" >> "$log"
  ;;
esac
exit 0
`
	os.WriteFile(filepath.Join(dir, "tmux"), []byte(script), 0o700)
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	return tmux.Server{Name: "fake"}, log
}

func calls(t *testing.T, log, prefix string) []string {
	t.Helper()
	raw, _ := os.ReadFile(log)
	var out []string
	for _, l := range strings.Split(string(raw), "\n") {
		if strings.HasPrefix(l, prefix) {
			out = append(out, l)
		}
	}
	return out
}

// highWater is the most captures that ran at once, from the log's order.
func highWater(t *testing.T, log string) int {
	t.Helper()
	raw, _ := os.ReadFile(log)
	n, high := 0, 0
	for _, l := range strings.Split(string(raw), "\n") {
		switch {
		case strings.HasPrefix(l, "capture start"):
			n++
			high = max(high, n)
		case strings.HasPrefix(l, "capture end"):
			n--
		}
	}
	return high
}

func testAgent(t *testing.T, ts tmux.Server) *Agent {
	t.Helper()
	pub, _, _ := ed25519.GenerateKey(rand.Reader)
	a, err := New(Config{HubURL: "https://hub.example.com", HubKey: secure.EncodePublic(pub)}, nil, ts, slog.New(slog.DiscardHandler))
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func TestLaneOf(t *testing.T) {
	for op, want := range map[string]lane{
		wire.OpRead: laneRead, wire.OpMailList: laneRead, wire.OpReadPath: laneRead, wire.OpGitStatus: laneRead, "no-such-op": laneRead,
		wire.OpInput: laneWrite, wire.OpAnswer: laneWrite, wire.OpMail: laneWrite, wire.OpLater: laneWrite, wire.OpAlias: laneWrite, wire.OpFile: laneWrite,
		wire.OpSplit: laneShape, wire.OpNewSession: laneShape, wire.OpKillPane: laneShape, wire.OpClosePane: laneShape, wire.OpResize: laneShape,
		wire.OpList: laneList,
	} {
		if got := laneOf(op); got != want {
			t.Errorf("%s: lane %d, want %d", op, got, want)
		}
	}
}

// Writes to one pane run in the order they were claimed, whatever the
// goroutines do; writes to different panes do not wait for each other.
func TestWriteTurnsKeepOrder(t *testing.T) {
	a := &Agent{}
	var mu sync.Mutex
	order := map[string][]int{}
	var wg sync.WaitGroup
	panes := []string{"%1", "%2", "%3"}
	for i := 0; i < 100; i++ {
		pane := panes[i%3]
		tn := a.claim(wire.Request{Op: wire.OpInput, Pane: pane})
		wg.Add(1)
		go func(i int, tn *turn) {
			defer wg.Done()
			// Later writes run first if nothing holds them: the queue must.
			time.Sleep(time.Duration(100-i) * 50 * time.Microsecond)
			if err := tn.wait(context.Background()); err != nil {
				t.Error(err)
			}
			mu.Lock()
			order[pane] = append(order[pane], i)
			mu.Unlock()
			a.release(tn)
		}(i, tn)
	}
	wg.Wait()
	for _, pane := range panes {
		got := order[pane]
		if len(got) != 33 && len(got) != 34 {
			t.Fatalf("%s: %d writes", pane, len(got))
		}
		for j := 1; j < len(got); j++ {
			if got[j] < got[j-1] {
				t.Fatalf("%s: out of order at %d: %v", pane, j, got)
			}
		}
	}
	a.mu.Lock()
	if len(a.writes) != 0 {
		t.Errorf("queues left behind: %v", a.writes)
	}
	a.mu.Unlock()
	// A write whose turn never comes within its deadline is refused and
	// lets the next one through.
	first := a.claim(wire.Request{Op: wire.OpInput, Pane: "%9"})
	second := a.claim(wire.Request{Op: wire.OpInput, Pane: "%9"})
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := second.wait(ctx); err == nil {
		t.Fatal("waited past the deadline")
	}
	a.release(second)
	third := a.claim(wire.Request{Op: wire.OpInput, Pane: "%9"})
	a.release(first)
	if err := third.wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	a.release(third)
}

// Twenty reads of panes that keep printing hold at most four permits at
// once and share the listing; a read of a pane that has not moved since
// its capture makes no capture, only a listing when the shared one is
// older than the capture; a write lists afresh.
func TestReadsShareTheListingAndHoldPermits(t *testing.T) {
	now := time.Now().Unix()
	ts, log := fakeTmux(t, []tmux.Pane{
		// Activity in a second to come: the pane never stands still.
		{SessionID: "$1", SessionName: "work", WindowID: "@1", PaneID: "%1", Width: 80, Height: 24, Mode: "write", Activity: now + 1000, CursorX: 1, CursorY: 1},
		{SessionID: "$1", SessionName: "work", WindowID: "@2", PaneID: "%2", PaneIndex: 1, Width: 80, Height: 24, Mode: "read", Activity: now - 10, CursorX: 1, CursorY: 1},
	})
	a := testAgent(t, ts)
	ctx := context.Background()
	var wg sync.WaitGroup
	start := time.Now()
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			r := a.serve(ctx, wire.Request{ID: uint64(i), Op: wire.OpRead, Pane: "%1", Lines: 50}, nil)
			if r.Error != "" || !strings.Contains(r.Content, "a line of %1") {
				t.Errorf("read %d: %q %q", i, r.Error, r.Content)
			}
		}(i)
	}
	wg.Wait()
	// Four captures of a fifth of a second at a time: a second for twenty,
	// and the shared listing, half a second old by then, taken twice.
	if n := len(calls(t, log, "capture start")); n != 20 {
		t.Errorf("%d captures, want 20", n)
	}
	if h := highWater(t, log); h > readPermits {
		t.Errorf("%d captures at once", h)
	}
	if d := time.Since(start); d < 900*time.Millisecond {
		t.Errorf("twenty reads took %v: more than four at once", d)
	}
	if n := len(calls(t, log, "list-panes")); n > 3 {
		t.Errorf("%d listings for twenty reads", n)
	}
	// An idle pane: its first read captures; the next, with the shared
	// listing older than that capture, lists afresh and reuses it.
	lists := len(calls(t, log, "list-panes"))
	r := a.serve(ctx, wire.Request{ID: 21, Op: wire.OpRead, Pane: "%2", Lines: 50}, nil)
	if r.Error != "" || !strings.Contains(r.Content, "a line of %2") {
		t.Fatalf("idle pane: %q %q", r.Error, r.Content)
	}
	captures := len(calls(t, log, "capture start"))
	r = a.serve(ctx, wire.Request{ID: 22, Op: wire.OpRead, Pane: "%2", Lines: 50}, nil)
	if r.Error != "" || !strings.Contains(r.Content, "a line of %2") {
		t.Fatalf("idle pane again: %q %q", r.Error, r.Content)
	}
	if n := len(calls(t, log, "capture start")); n != captures {
		t.Errorf("%d captures after the idle pane's second read, want %d: the kept capture was not reused", n, captures)
	}
	if n := len(calls(t, log, "list-panes")); n < lists+1 {
		t.Errorf("%d listings: the second read did not list afresh", n)
	}
	// A different form of the same pane is its own capture.
	r = a.serve(ctx, wire.Request{ID: 23, Op: wire.OpRead, Pane: "%2", Lines: 50, ANSI: true}, nil)
	if r.Error != "" {
		t.Fatal(r.Error)
	}
	if n := len(calls(t, log, "capture start")); n != captures+1 {
		t.Errorf("%d captures: ansi shares the plain capture", n)
	}
	// A write lists afresh, however young the shared listing.
	lists = len(calls(t, log, "list-panes"))
	text := "x"
	r = a.serve(ctx, wire.Request{ID: 24, Op: wire.OpInput, Pane: "%1", Text: &text}, a.claim(wire.Request{Op: wire.OpInput, Pane: "%1"}))
	if r.Error != "" {
		t.Fatal(r.Error)
	}
	if n := len(calls(t, log, "list-panes")); n != lists+1 {
		t.Errorf("%d listings: the write shared one", n)
	}
	if n := len(calls(t, log, "send-keys")); n != 1 {
		t.Errorf("%d send-keys", n)
	}
	// Without Read the input's answer carries no screen.
	if r.Read || r.Content != "" {
		t.Errorf("an input without read answered a screen: %+v", r)
	}
	// With Read it carries the pane's screen, a capture of its own,
	// after a listing taken once the keys landed.
	captures = len(calls(t, log, "capture start"))
	lists = len(calls(t, log, "list-panes"))
	r = a.serve(ctx, wire.Request{ID: 26, Op: wire.OpInput, Pane: "%1", Text: &text, Read: true, Lines: 50, ANSI: true}, a.claim(wire.Request{Op: wire.OpInput, Pane: "%1"}))
	if r.Error != "" {
		t.Fatal(r.Error)
	}
	if !r.Read || r.Content != "a line of %1" {
		t.Errorf("the input's answer: read=%v content=%q", r.Read, r.Content)
	}
	if n := len(calls(t, log, "capture start")); n != captures+1 {
		t.Errorf("%d captures after the input with read, want %d", n, captures+1)
	}
	if n := len(calls(t, log, "list-panes")); n < lists+2 {
		t.Errorf("%d listings: the echo did not list afresh after the keys", n)
	}
	if n := len(calls(t, log, "send-keys")); n != 2 {
		t.Errorf("%d send-keys", n)
	}
	// An unknown pane, or a read-only one, is not read.
	if r := a.serve(ctx, wire.Request{ID: 25, Op: wire.OpRead, Pane: "%7"}, nil); r.Error != wire.ErrNotExposed {
		t.Errorf("unknown pane: %q", r.Error)
	}
}

func TestCaptureStill(t *testing.T) {
	at := time.Date(2026, 11, 5, 10, 0, 0, 500_000_000, time.UTC)
	c := &capture{at: at, cursorX: 3, cursorY: 4, width: 80, height: 24}
	same := tmux.Pane{Activity: at.Unix() - 1, CursorX: 3, CursorY: 4, Width: 80, Height: 24}
	listed := at.Add(100 * time.Millisecond)
	now := at.Add(time.Second)
	cases := []struct {
		name   string
		p      tmux.Pane
		listed time.Time
		now    time.Time
		want   bool
	}{
		{"unchanged", same, listed, now, true},
		{"output in the capture's own second", with(same, func(p *tmux.Pane) { p.Activity = at.Unix() }), listed, now, false},
		{"output after", with(same, func(p *tmux.Pane) { p.Activity = at.Unix() + 1 }), listed, now, false},
		{"cursor moved", with(same, func(p *tmux.Pane) { p.CursorX = 4 }), listed, now, false},
		{"cursor down", with(same, func(p *tmux.Pane) { p.CursorY = 5 }), listed, now, false},
		{"resized", with(same, func(p *tmux.Pane) { p.Width = 100 }), listed, now, false},
		{"listing older than the capture", same, at.Add(-time.Millisecond), now, false},
		{"listing of the same instant", same, at, now, false},
		{"five seconds old", same, listed, at.Add(captureKept), false},
		{"just under five seconds", same, at.Add(4 * time.Second), at.Add(captureKept - time.Millisecond), true},
	}
	for _, tc := range cases {
		if got := c.still(tc.p, tc.listed, tc.now); got != tc.want {
			t.Errorf("%s: %v", tc.name, got)
		}
	}
}

func with(p tmux.Pane, f func(*tmux.Pane)) tmux.Pane {
	f(&p)
	return p
}

// The store keeps 256 captures, oldest out, and forgets a pane's with the pane.
func TestCaptureStoreBounds(t *testing.T) {
	ts, _ := fakeTmux(t, []tmux.Pane{{SessionID: "$1", SessionName: "work", WindowID: "@1", PaneID: "%5", Width: 80, Height: 24, Mode: "read", Activity: 1, CursorX: 1, CursorY: 1}})
	a := testAgent(t, ts)
	// Captures of the pane in every form, so the listing's sweep keeps them.
	base := time.Now().Add(-time.Minute)
	for i := 0; i < captureMax; i++ {
		a.captures[captureKey{pane: "%5", lines: i}] = &capture{at: base.Add(time.Duration(i) * time.Second)}
	}
	if _, _, code := a.read(context.Background(), "%5", 100, false, true); code != "" {
		t.Fatal(code)
	}
	if len(a.captures) != captureMax {
		t.Fatalf("%d captures kept", len(a.captures))
	}
	if _, ok := a.captures[captureKey{pane: "%5", lines: 0}]; ok {
		t.Error("the oldest capture stayed")
	}
	if _, ok := a.captures[captureKey{pane: "%5", lines: 100, join: true}]; !ok {
		t.Error("the new capture was not kept")
	}
	a.sweepCaptures(map[string]bool{"%6": true})
	if len(a.captures) != 0 {
		t.Errorf("%d captures after the sweep", len(a.captures))
	}
}
