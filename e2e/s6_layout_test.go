//go:build e2e

package e2e

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/notmarkopadjen/muxway/internal/secure"
	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

// Resizing a window from a client, and reading a whole window at once.

func (e *env) resize(tok, pane, body string) resp {
	return e.post(tok, "/v1/panes/"+pane+"/resize", body)
}

func (ts *tmuxServer) windowSize(target string) string {
	return ts.must("display-message", "-p", "-t", target, "#{window_width}x#{window_height}")
}

func (ts *tmuxServer) layout(target string) string {
	return ts.must("display-message", "-p", "-t", target, "#{window_layout}")
}

// 52
func TestSec52_ResizeNeedsWriteGrantAndWriteMark(t *testing.T) {
	e, ts, _ := basic(t)
	ts.split("work:0.0") // 0.1 unexposed
	ts.must("new-window", "-t", "work:1", "-n", "ro", shell())
	ts.title("work:1.0")
	e.expose(ts, "work:1.0") // read-only
	before0, before1 := ts.windowSize("work:0"), ts.windowSize("work:1")
	reader := e.token("reader", []string{host + "/*"}, nil)
	writer := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	expect(t, e.resize(reader, shell0, `{"cols":120,"rows":40}`), http.StatusForbidden, "read-only token")
	expect(t, e.resize(writer, host+"/work/1.0", `{"cols":120,"rows":40}`), http.StatusForbidden, "read-only pane")
	expect(t, e.resize(writer, host+"/work/0.1", `{"cols":120,"rows":40}`), http.StatusNotFound, "unexposed pane")
	expect(t, e.resize(writer, host+"/work/9.0", `{"cols":120,"rows":40}`), http.StatusNotFound, "no such pane")
	time.Sleep(200 * time.Millisecond)
	if ts.windowSize("work:0") != before0 || ts.windowSize("work:1") != before1 {
		t.Fatalf("a refused resize changed a window: %s %s", ts.windowSize("work:0"), ts.windowSize("work:1"))
	}
}

// 53
func TestSec53_ResizeBoundsAndBurst(t *testing.T) {
	e, ts, _ := basic(t)
	tok := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	for _, body := range []string{`{"cols":19,"rows":40}`, `{"cols":501,"rows":40}`, `{"cols":100,"rows":4}`, `{"cols":100,"rows":301}`,
		`{"cols":100}`, `{"rows":30}`, `{}`, `{"fit":"auto","cols":100,"rows":30}`, `{"fit":"big"}`, `{"cols":"100","rows":30}`,
		`{"cols":100,"rows":30,"x":1}`, `nope`, `{"cols":-100,"rows":-30}`,
		`{"cols":100,"rows":30,"scope":"session"}`, `{"fit":"auto","scope":"pane"}`,
		// A layout goes with the window scope only, parses, and names the window's own panes.
		`{"cols":100,"rows":30,"layout":"a87d,100x30,0,0,0"}`,
		`{"cols":100,"rows":30,"scope":"pane","layout":"a87d,100x30,0,0,0"}`,
		`{"cols":100,"rows":30,"scope":"window","layout":"junk"}`,
		`{"cols":100,"rows":30,"scope":"window","layout":"a87d,100x30,0,0,999"}`,
		`{"cols":100,"rows":30,"zoom":true}`, `{"cols":100,"rows":30,"scope":"pane","zoom":true}`,
		`{"cols":100,"rows":30,"scope":"window","zoom":"yes"}`,
		`{"cols":100,"rows":30,"scope":"window","layout":"` + strings.Repeat("1", 3000) + `"}`} {
		r := e.resize(tok, shell0, body)
		if r.status != http.StatusBadRequest {
			t.Fatalf("%s: %d %s", body, r.status, r.body)
		}
	}
	before := ts.windowSize("work:0")
	var statuses []int
	for i := 0; i < 30; i++ {
		statuses = append(statuses, e.resize(tok, shell0, fmt.Sprintf(`{"cols":%d,"rows":31}`, 110+i)).status)
	}
	if statuses[0] != http.StatusOK {
		t.Fatalf("first resize: %d", statuses[0])
	}
	limited := 0
	for _, s := range statuses[1:] {
		if s == http.StatusTooManyRequests {
			limited++
		}
	}
	if limited < 27 {
		t.Fatalf("burst not limited: %v", statuses)
	}
	size := ts.windowSize("work:0")
	if size == before || !strings.HasPrefix(size, "110x") && !strings.HasPrefix(size, "111x") {
		t.Fatalf("window size after the burst: %s (before %s)", size, before)
	}
	logs, _ := os.ReadFile(filepath.Join(e.logs, "agent-"+host+".log"))
	if !strings.Contains(string(logs), "op=resize") || !strings.Contains(string(logs), "cols=110 rows=31 result=ok") ||
		!strings.Contains(string(logs), "result=rate_limited") {
		t.Fatalf("agent audit:\n%s", logs)
	}
}

// 54
func TestSec54_WindowReadFollowsGrantsPerPane(t *testing.T) {
	e, ts, _ := basic(t)
	ts.split("work:0.0")
	e.expose(ts, "work", "--write")
	one := e.token("one", []string{host + "/work/0.0"}, nil)
	all := e.token("all", []string{host + "/*"}, nil)
	ts.must("send-keys", "-t", "work:0.1", "-l", "echo second-pane-secret")
	ts.must("send-keys", "-t", "work:0.1", "Enter")
	waitFor(t, "second pane output", func() bool { return strings.Contains(ts.capture("work:0.1"), "second-pane-secret") })
	r := e.get(one, "/v1/windows/"+host+"/work/0")
	expect(t, r, http.StatusOK, "window with one grant")
	var win struct {
		Window struct {
			Layout string `json:"layout"`
		} `json:"window"`
		Panes []struct {
			Pane struct {
				Address string `json:"address"`
			} `json:"pane"`
			Content string `json:"content"`
		} `json:"panes"`
	}
	json.Unmarshal([]byte(r.body), &win)
	if len(win.Panes) != 1 || win.Panes[0].Pane.Address != shell0 || win.Window.Layout == "" || strings.Contains(r.body, "second-pane-secret") {
		t.Fatalf("one-grant window: %s", r.body)
	}
	r = e.get(all, "/v1/windows/"+host+"/work/0")
	json.Unmarshal([]byte(r.body), &win)
	if len(win.Panes) != 2 || !strings.Contains(r.body, "second-pane-secret") {
		t.Fatalf("full window: %s", r.body)
	}
	for _, path := range []string{"/v1/windows/bob-desktop/work/0", "/v1/windows/" + host + "/nope/0", "/v1/windows/" + host + "/work/7",
		"/v1/windows/" + host + "/w%2Fork/0", "/v1/windows/" + host + "/work/0?lines=0"} {
		if s := e.get(one, path).status; s != http.StatusNotFound && s != http.StatusBadRequest {
			t.Fatalf("%s: %d", path, s)
		}
	}
}

// 55
func TestSec55_AgentRefusesResizeFromAHostileHub(t *testing.T) {
	e := newEnv(t)
	ts := newTmux(t)
	ts.split("work:0.0")
	e.pairAgent(host, ts)
	e.expose(ts, "work:0.0") // read-only
	hubKey, err := secure.LoadOrCreateKey(filepath.Join(e.hubDir, "hub.key"))
	if err != nil {
		t.Fatal(err)
	}
	agentKey := agentPublicKey(t, e, host)
	e.stopHub()
	before := ts.windowSize("work:0")
	readOnly, hidden := paneIDOf(ts, "work:0.0"), paneIDOf(ts, "work:0.1")
	var got []string
	done := fakeHub(t, e, hubKey, agentKey, func(ctx context.Context, s *secure.Session) {
		for i, req := range []wire.Request{
			{Op: wire.OpResize, Pane: readOnly, Cols: 120, Rows: 40},
			{Op: wire.OpResize, Pane: hidden, Cols: 120, Rows: 40},
			{Op: wire.OpResize, Pane: readOnly, Fit: "auto"},
			{Op: wire.OpResize, Pane: "%999", Cols: 120, Rows: 40},
			{Op: wire.OpResize, Pane: hidden, Cols: 120, Rows: 40, Scope: "session"},
		} {
			req.ID = uint64(i + 1)
			raw, _ := json.Marshal(req)
			s.Write(ctx, raw)
			reply, err := s.Read(ctx)
			if err != nil {
				t.Errorf("no answer: %v", err)
				return
			}
			var r wire.Response
			json.Unmarshal(reply, &r)
			got = append(got, r.Error)
		}
	})
	select {
	case <-done:
	case <-time.After(20 * time.Second):
		t.Fatal("agent never connected to the fake hub")
	}
	want := []string{wire.ErrReadOnly, wire.ErrNotExposed, wire.ErrReadOnly, wire.ErrNotExposed, wire.ErrNotExposed}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("agent answered %v, want %v", got, want)
	}
	if ts.windowSize("work:0") != before {
		t.Fatal("window changed")
	}
	logs, _ := os.ReadFile(filepath.Join(e.logs, "agent-"+host+".log"))
	if strings.Count(string(logs), "op=resize") < 5 {
		t.Fatalf("resizes not audited:\n%s", logs)
	}
}

// 56
func TestFlow56_ResizeAndRelease(t *testing.T) {
	e, ts, _ := basic(t)
	tok := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	before := ts.windowSize("work:0")
	r := e.resize(tok, shell0, `{"cols":140,"rows":32}`)
	expect(t, r, http.StatusOK, "resize")
	if !strings.Contains(r.body, `"width":140`) || !strings.Contains(r.body, `"height":32`) {
		t.Fatalf("resize answer: %s", r.body)
	}
	if got := ts.windowSize("work:0"); got != "140x32" {
		t.Fatalf("window is %s", got)
	}
	// A release right after a resize is accepted: it is how a client leaves.
	expect(t, e.resize(tok, shell0, `{"fit":"auto"}`), http.StatusOK, "release")
	if got := ts.windowSize("work:0"); got != before {
		t.Fatalf("after release the window is %s, before %s", got, before)
	}
	if opt := ts.must("show-options", "-w", "-t", "work:0", "window-size"); opt != "" {
		t.Fatalf("window-size still set: %s", opt)
	}
	logs, _ := os.ReadFile(filepath.Join(e.logs, "hub.log"))
	if !strings.Contains(string(logs), "audit resize") || !strings.Contains(string(logs), "cols=140 rows=32") {
		t.Fatalf("hub audit:\n%s", logs)
	}
}

// 58
func TestFlow58_PaneFitInASplitWindow(t *testing.T) {
	e, ts, _ := basic(t)
	ts.split("work:0.0") // 0.1 below it: the window is 100x30, the panes 100x15 and 100x14
	e.expose(ts, "work", "--write")
	tok := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	layout, size := ts.layout("work:0"), ts.windowSize("work:0")
	paneSize := func(r resp) string {
		var v struct {
			Pane struct {
				Width, Height int
			} `json:"pane"`
		}
		json.Unmarshal([]byte(r.body), &v)
		return fmt.Sprintf("%dx%d", v.Pane.Width, v.Pane.Height)
	}
	// Narrower and shorter than the pane: the window keeps its height,
	// the neighbour takes the rows; the width is the window's own.
	r := e.resize(tok, shell0, `{"cols":60,"rows":10}`)
	expect(t, r, http.StatusOK, "pane resize")
	if got := paneSize(r); got != "60x10" {
		t.Fatalf("pane is %s after 60x10", got)
	}
	if got := ts.windowSize("work:0"); got != "60x30" {
		t.Fatalf("window is %s after 60x10", got)
	}
	time.Sleep(1100 * time.Millisecond)
	// Taller than the window can give: the window grows by the difference.
	r = e.resize(tok, shell0, `{"cols":120,"rows":40,"scope":"pane"}`)
	expect(t, r, http.StatusOK, "pane resize beyond the window")
	if got := paneSize(r); got != "120x40" {
		t.Fatalf("pane is %s after 120x40", got)
	}
	if got := ts.windowSize("work:0"); got != "120x60" {
		t.Fatalf("window is %s after 120x40", got)
	}
	time.Sleep(1100 * time.Millisecond)
	// The window scope sizes the window; the panes keep their proportions
	// (40 and 19 rows of 60 become 16 and 8 of 25), which tmux alone would not.
	wide := ts.layout("work:0")
	r = e.resize(tok, shell0, `{"cols":90,"rows":25,"scope":"window"}`)
	expect(t, r, http.StatusOK, "window resize")
	if got := ts.windowSize("work:0"); got != "90x25" {
		t.Fatalf("window is %s after 90x25", got)
	}
	if got := paneSize(r); got != "90x16" {
		t.Fatalf("pane is %s after the window went to 90x25", got)
	}
	if want, err := tmux.ScaleLayout(wide, 90, 25); err != nil || ts.layout("work:0") != want {
		t.Fatalf("layout after the window resize: %s, want %s (%v)", ts.layout("work:0"), want, err)
	}
	time.Sleep(1100 * time.Millisecond)
	// With a layout, the window takes the client's proportions instead:
	// the top pane three quarters of the rows.
	ids, _ := tmux.LayoutPanes(ts.layout("work:0"))
	sent := fmt.Sprintf("0000,100x40,0,0[100x30,0,0,%s,100x9,0,31,%s]", ids[0][1:], ids[1][1:])
	r = e.resize(tok, shell0, fmt.Sprintf(`{"cols":90,"rows":25,"scope":"window","layout":"%s"}`, sent))
	expect(t, r, http.StatusOK, "window resize with a layout")
	if want, err := tmux.ScaleLayout(sent, 90, 25); err != nil || ts.layout("work:0") != want {
		t.Fatalf("layout after the resize with a layout: %s, want %s (%v)", ts.layout("work:0"), want, err)
	}
	if got := paneSize(r); got != "90x18" {
		t.Fatalf("pane is %s after the window took the layout", got)
	}
	time.Sleep(1100 * time.Millisecond)
	// With zoom, the pane is shown alone: the whole window is its size,
	// and the layout underneath is kept.
	r = e.resize(tok, shell0, fmt.Sprintf(`{"cols":90,"rows":25,"scope":"window","layout":"%s","zoom":true}`, sent))
	expect(t, r, http.StatusOK, "window resize with zoom")
	if got := paneSize(r); got != "90x25" || !strings.Contains(r.body, `"zoomed":true`) {
		t.Fatalf("zoomed pane: %s %s", got, r.body)
	}
	if ts.must("display-message", "-p", "-t", "work:0", "#{window_zoomed_flag}") != "1" {
		t.Fatal("window not zoomed")
	}
	if want, _ := tmux.ScaleLayout(sent, 90, 25); ts.layout("work:0") != want {
		t.Fatalf("layout under the zoom: %s, want %s", ts.layout("work:0"), want)
	}
	time.Sleep(1100 * time.Millisecond)
	// Without zoom, the next resize undoes it.
	r = e.resize(tok, shell0, fmt.Sprintf(`{"cols":90,"rows":25,"scope":"window","layout":"%s"}`, sent))
	expect(t, r, http.StatusOK, "window resize without zoom")
	if got := paneSize(r); got != "90x18" || strings.Contains(r.body, `"zoomed"`) {
		t.Fatalf("pane after the zoom was undone: %s %s", got, r.body)
	}
	time.Sleep(1100 * time.Millisecond)
	// A release undoes a zoom too.
	expect(t, e.resize(tok, shell0, fmt.Sprintf(`{"cols":90,"rows":25,"scope":"window","zoom":true}`)), http.StatusOK, "zoom again")
	// The release puts the window and its panes back as they were.
	expect(t, e.resize(tok, shell0, `{"fit":"auto"}`), http.StatusOK, "release")
	if got := ts.windowSize("work:0"); got != size {
		t.Fatalf("after release the window is %s, before %s", got, size)
	}
	if got := ts.layout("work:0"); got != layout {
		t.Fatalf("after release the layout is %s, before %s", got, layout)
	}
	if ts.must("display-message", "-p", "-t", "work:0", "#{window_zoomed_flag}") != "0" {
		t.Fatal("still zoomed after the release")
	}
	if opt := ts.must("show-options", "-w", "-t", "work:0", "window-size"); opt != "" {
		t.Fatalf("window-size still set: %s", opt)
	}
	logs, _ := os.ReadFile(filepath.Join(e.logs, "agent-"+host+".log"))
	if !strings.Contains(string(logs), "cols=90 rows=25 scope=window result=ok") {
		t.Fatalf("agent audit:\n%s", logs)
	}
}

// 57
func TestFlow57_WindowReadWithETag(t *testing.T) {
	e, ts, _ := basic(t)
	ts.split("work:0.0")
	e.expose(ts, "work", "--write")
	tok := e.token("all", []string{host + "/*"}, nil)
	ts.must("send-keys", "-t", "work:0.1", "-l", "echo in-the-split")
	ts.must("send-keys", "-t", "work:0.1", "Enter")
	waitFor(t, "split output", func() bool { return strings.Contains(ts.capture("work:0.1"), "in-the-split") })
	r := e.get(tok, "/v1/windows/"+host+"/work/shell?ansi=1&lines=50")
	expect(t, r, http.StatusOK, "window by name")
	var win struct {
		Host   string `json:"host"`
		Window struct {
			Index  int    `json:"index"`
			Name   string `json:"name"`
			Layout string `json:"layout"`
		} `json:"window"`
		Panes []struct {
			Pane struct {
				PaneID string `json:"pane_id"`
				Width  int    `json:"width"`
			} `json:"pane"`
			Content string `json:"content"`
		} `json:"panes"`
	}
	json.Unmarshal([]byte(r.body), &win)
	if win.Host != host || win.Window.Name != "shell" || len(win.Panes) != 2 || !strings.Contains(win.Window.Layout, "x") ||
		!strings.Contains(win.Panes[1].Content, "in-the-split") || win.Panes[0].Pane.Width == 0 {
		t.Fatalf("window: %s", r.body)
	}
	for _, pc := range win.Panes {
		if !strings.Contains(win.Window.Layout, strings.TrimPrefix(pc.Pane.PaneID, "%")) {
			t.Fatalf("layout %s lacks pane %s", win.Window.Layout, pc.Pane.PaneID)
		}
	}
	etag := r.header.Get("ETag")
	again := e.do("GET", tok, "/v1/windows/"+host+"/work/shell?ansi=1&lines=50", "", "", "If-None-Match", etag)
	expect(t, again, http.StatusNotModified, "etag")
}
