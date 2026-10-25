//go:build e2e

package e2e

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Arranging a window from a client: a layout that moves panes, not only
// sizes them. tmux fills a layout's places in its own pane order, so the
// agent swaps the panes into the layout's order first.

func arrangeEnv(t *testing.T, thirdWritable bool) (*env, *tmuxServer) {
	e := newEnv(t)
	ts := newTmux(t)
	e.pairAgent(host, ts)
	ts.split("work:0.0")
	ts.split("work:0.0")
	e.expose(ts, "work:0.0", "--write")
	e.expose(ts, "work:0.1", "--write")
	if thirdWritable {
		e.expose(ts, "work:0.2", "--write")
	} else {
		e.expose(ts, "work:0.2")
	}
	return e, ts
}

// The reported layout: .1 over .2 on the left, .0 down the right.
func movedLayout(a, b, c string) string {
	n := func(id string) string { return strings.TrimPrefix(id, "%") }
	return fmt.Sprintf("0000,1000x1000,0,0{500x1000,0,0[500x500,0,0,%s,500x499,0,501,%s],499x1000,501,0,%s}", n(b), n(c), n(a))
}

type place struct{ id, at string }

func places(ts *tmuxServer) []place {
	var out []place
	for _, l := range strings.Split(ts.must("list-panes", "-t", "work:0", "-F", "#{pane_id} #{pane_left},#{pane_top} #{pane_height}"), "\n") {
		f := strings.Fields(l)
		out = append(out, place{f[0], f[1] + " " + f[2]})
	}
	return out
}

// 123
func TestSec123_MovingPanesNeedsWriteOnEveryPane(t *testing.T) {
	e, ts := arrangeEnv(t, false)
	a, b, c := paneIDOf(ts, "work:0.0"), paneIDOf(ts, "work:0.1"), paneIDOf(ts, "work:0.2")
	full := e.token("browser", []string{"*"}, []string{"*"})
	reader := e.token("reader", []string{host + "/*"}, nil)
	before := ts.layout("work:0")
	body := `{"scope":"window","layout":"` + movedLayout(a, b, c) + `"}`
	expect(t, e.resize(full, shell0, body), http.StatusForbidden, "a read-only pane in the window")
	expect(t, e.resize(reader, shell0, body), http.StatusForbidden, "a read-only token")
	if ts.layout("work:0") != before {
		t.Fatalf("a refused arrangement changed the window: %s", ts.layout("work:0"))
	}
	// The same shape, other sizes: a write on the pane is enough, as before.
	expect(t, e.resize(full, shell0, `{"cols":120,"rows":40,"scope":"window","layout":"`+before+`"}`), http.StatusOK, "same shape")
	// A zoom does not go with a layout alone.
	expect(t, e.resize(full, shell0, `{"scope":"window","zoom":true,"layout":"`+before+`"}`), http.StatusBadRequest, "zoom without a size")
	// Every pane writable: a pane not of the window is still refused, and a
	// second arrangement inside the second.
	e.expose(ts, "work:0.2", "--write")
	waitFor(t, "the third pane writable", func() bool {
		return strings.Contains(e.get(full, "/v1/panes/"+host+"/work/0.2").body, `"mode":"write"`)
	})
	foreign := `{"scope":"window","layout":"` + movedLayout(a, b, "%999") + `"}`
	expect(t, e.resize(full, shell0, foreign), http.StatusBadRequest, "a pane not of the window")
	time.Sleep(1100 * time.Millisecond)
	expect(t, e.resize(full, shell0, body), http.StatusOK, "every pane writable")
	expect(t, e.resize(full, shell0, `{"scope":"window","layout":"`+movedLayout(b, c, a)+`"}`), http.StatusTooManyRequests, "within the second")
}

// 124
func TestFlow124_ArrangeMovesPanesWhereTheLayoutSays(t *testing.T) {
	e, ts := arrangeEnv(t, true)
	a, b, c := paneIDOf(ts, "work:0.0"), paneIDOf(ts, "work:0.1"), paneIDOf(ts, "work:0.2")
	full := e.token("browser", []string{"*"}, []string{"*"})
	size := ts.windowSize("work:0")
	r := e.resize(full, shell0, `{"scope":"window","layout":"`+movedLayout(a, b, c)+`"}`)
	expect(t, r, http.StatusOK, "arrange")
	got := map[string]string{}
	for _, p := range places(ts) {
		got[p.id] = p.at
	}
	h := strings.Split(size, "x")[1]
	if !strings.HasPrefix(got[b], "0,0 ") || !strings.HasSuffix(got[a], ",0 "+h) || strings.HasPrefix(got[a], "0,") {
		t.Fatalf("panes not where the layout put them: %v (window %s)", got, size)
	}
	if ts.windowSize("work:0") != size {
		t.Fatalf("a layout alone resized the window: %s, was %s", ts.windowSize("work:0"), size)
	}
	// The answer lists the window's panes at their new addresses.
	var out struct {
		Panes []struct {
			Address string `json:"address"`
			PaneID  string `json:"pane_id"`
		} `json:"panes"`
	}
	if err := json.Unmarshal([]byte(r.body), &out); err != nil || len(out.Panes) != 3 {
		t.Fatalf("answer: %v %s", err, r.body)
	}
	for _, p := range out.Panes {
		idx := ts.must("display-message", "-p", "-t", p.PaneID, "#{pane_index}")
		if p.Address != host+"/work/0."+idx {
			t.Fatalf("%s listed as %s, tmux has index %s", p.PaneID, p.Address, idx)
		}
	}
	// A fit and its release keep the arrangement, and give the size back.
	time.Sleep(1100 * time.Millisecond)
	moved := places(ts)
	lay := ts.layout("work:0")
	expect(t, e.resize(full, host+"/work/0.0", `{"cols":150,"rows":44,"scope":"window","layout":"`+lay+`"}`), http.StatusOK, "fit")
	expect(t, e.resize(full, host+"/work/0.0", `{"fit":"auto"}`), http.StatusOK, "release")
	after := places(ts)
	for i := range moved {
		if after[i].id != moved[i].id {
			t.Fatalf("release moved the panes back: %v, was %v", after, moved)
		}
	}
	for _, f := range []string{"hub.log", "agent-" + host + ".log"} {
		raw, _ := os.ReadFile(filepath.Join(e.logs, f))
		if !strings.Contains(string(raw), `arrange=true`) {
			t.Fatalf("%s has no audit line for the arrangement", f)
		}
	}
}
