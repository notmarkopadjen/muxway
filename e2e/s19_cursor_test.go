//go:build e2e

package e2e

import (
	"encoding/json"
	"testing"
)

// The listing carries the cursor's cell, where the program waits.

// 150
func TestFlow150_TheListingHasTheCursor(t *testing.T) {
	e := newEnv(t)
	ts := newTmux(t)
	e.pairAgent(host, ts)
	e.expose(ts, "work:0.0", "--write")
	tok := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	ts.must("send-keys", "-t", "work:0.0", "clear", "Enter")
	var got struct {
		Pane struct {
			Width, Height int
			CX            int `json:"cursor_x"`
			CY            int `json:"cursor_y"`
		}
		Trimmed int
	}
	// The hub lists a pane from a listing up to a second old.
	waitFor(t, "the cursor after clear", func() bool {
		r := e.get(tok, "/v1/panes/"+shell0)
		json.Unmarshal([]byte(r.body), &got)
		return got.Pane.CY == 1
	})
	p := got.Pane
	if p.CX < 1 || p.CX > p.Width {
		t.Fatalf("cursor at %d,%d in a %dx%d pane after clear", p.CX, p.CY, p.Width, p.Height)
	}
	// The screen's blank rows below the prompt are left out, and counted.
	if got.Trimmed != p.Height-1 {
		t.Fatalf("trimmed %d of a %d-row screen with one row used", got.Trimmed, p.Height)
	}
	// A line typed moves it along the row; the listing agrees.
	ts.must("send-keys", "-t", "work:0.0", "echo one", "Enter")
	ts.must("send-keys", "-t", "work:0.0", "abc")
	var list struct {
		Panes []struct {
			Address string
			CX      int `json:"cursor_x"`
			CY      int `json:"cursor_y"`
		}
	}
	waitFor(t, "the cursor after a typed line", func() bool {
		r := e.get(tok, "/v1/panes")
		json.Unmarshal([]byte(r.body), &list)
		for _, q := range list.Panes {
			if q.Address == shell0 {
				return q.CY == 3 && q.CX >= 4
			}
		}
		return false
	})
	ts.must("send-keys", "-t", "work:0.0", "C-u")
}
