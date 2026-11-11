package hub

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestDeskAddresses(t *testing.T) {
	for _, a := range []string{"alice-laptop/work/0.0", "alice-laptop/work/logs.3", "alice-laptop/@console", "work~bob-desktop/work/1.2"} {
		if _, _, _, ok := deskAddress(a); !ok {
			t.Errorf("%s refused", a)
		}
	}
	for _, a := range []string{"", "alice-laptop", "alice-laptop/work", "Alice/work/0.0", "alice-laptop/work/0.x", "alice-laptop/@Con sole", "a~b~c/work/0.0", "alice-laptop/../work/0.0", "alice-laptop/work/0.0/extra"} {
		if _, _, _, ok := deskAddress(a); ok {
			t.Errorf("%s taken", a)
		}
	}
	hub, host, pane, _ := deskAddress("work~bob-desktop/work/logs.3")
	if hub != "work" || host != "bob-desktop" || pane.SessionName != "work" || pane.WindowName != "logs" || pane.PaneIndex != 3 {
		t.Fatalf("parts: %s %s %+v", hub, host, pane)
	}
}

func TestValidDeskAgainstGrants(t *testing.T) {
	reader := Principal{Read: []string{"alice-laptop/work/*"}}
	desk := func(s string) *Desk {
		var d Desk
		if err := json.Unmarshal([]byte(s), &d); err != nil {
			t.Fatal(err)
		}
		return &d
	}
	good := `{"view":"panes","panes":["alice-laptop/work/0.0","alice-laptop/work/1.1"],"focused":"alice-laptop/work/1.1","arrangement":"custom","tree":{"kind":"h","key":"r","children":[0,1]},"weights":{"r":[0.6,0.4]},"minimised":["alice-laptop/work/1.2"],"order":["alice-laptop/work/0.0"]}`
	if code, _ := validDesk(desk(good), reader); code != "" {
		t.Fatalf("a good desk refused: %s", code)
	}
	bad := map[string]string{
		"five panes":           `{"view":"panes","panes":["alice-laptop/work/0.0","alice-laptop/work/0.1","alice-laptop/work/0.2","alice-laptop/work/0.3","alice-laptop/work/0.4"]}`,
		"a pane twice":         `{"view":"panes","panes":["alice-laptop/work/0.0","alice-laptop/work/0.0"]}`,
		"a bad address":        `{"view":"panes","panes":["alice laptop/work/0.0"]}`,
		"an unknown view":      `{"view":"board","panes":["alice-laptop/work/0.0"]}`,
		"no panes":             `{"view":"panes"}`,
		"focus elsewhere":      `{"view":"panes","panes":["alice-laptop/work/0.0"],"focused":"alice-laptop/work/0.1"}`,
		"an arrangement":       `{"view":"panes","panes":["alice-laptop/work/0.0"],"arrangement":"spiral"}`,
		"a tree short":         `{"view":"panes","panes":["alice-laptop/work/0.0","alice-laptop/work/0.1"],"tree":{"kind":"h","key":"r","children":[0]}}`,
		"a tree of three":      `{"view":"panes","panes":["alice-laptop/work/0.0","alice-laptop/work/0.1"],"tree":{"kind":"h","key":"r","children":[0,1,2]}}`,
		"a tree kind":          `{"view":"panes","panes":["alice-laptop/work/0.0","alice-laptop/work/0.1"],"tree":{"kind":"x","key":"r","children":[0,1]}}`,
		"a weight of one":      `{"view":"panes","panes":["alice-laptop/work/0.0"],"weights":{"r":[1,0]}}`,
		"a window with panes":  `{"view":"window","window":"alice-laptop/work/0","panes":["alice-laptop/work/0.0"]}`,
		"a window short":       `{"view":"window","window":"alice-laptop/work"}`,
		"a list with panes":    `{"view":"list","panes":["alice-laptop/work/0.0"]}`,
		"a list with a window": `{"view":"list","window":"alice-laptop/work/0"}`,
		"a list with a focus":  `{"view":"list","focused":"alice-laptop/work/0.0"}`,
		"a list arranged":      `{"view":"list","arrangement":"row"}`,
		"many minimised":       `{"view":"panes","panes":["alice-laptop/work/0.0"],"minimised":["alice-laptop/work/1.0","alice-laptop/work/1.1","alice-laptop/work/1.2","alice-laptop/work/1.3","alice-laptop/work/1.4","alice-laptop/work/1.5","alice-laptop/work/1.6","alice-laptop/work/1.7","alice-laptop/work/1.8","alice-laptop/work/1.9","alice-laptop/work/1.10","alice-laptop/work/1.11","alice-laptop/work/1.12","alice-laptop/work/1.13","alice-laptop/work/1.14","alice-laptop/work/1.15","alice-laptop/work/1.16"]}`,
	}
	for name, s := range bad {
		if code, status := validDesk(desk(s), reader); code != "bad_input" || status != http.StatusBadRequest {
			t.Errorf("%s: %s %d", name, code, status)
		}
	}
	for name, s := range map[string]string{
		"another host":           `{"view":"panes","panes":["bob-desktop/work/0.0"]}`,
		"another session":        `{"view":"panes","panes":["alice-laptop/other/0.0"]}`,
		"minimised elsewhere":    `{"view":"panes","panes":["alice-laptop/work/0.0"],"minimised":["bob-desktop/work/0.0"]}`,
		"a window elsewhere":     `{"view":"window","window":"bob-desktop/work/0"}`,
		"a list's row elsewhere": `{"view":"list","minimised":["bob-desktop/work/0.0"]}`,
	} {
		if code, status := validDesk(desk(s), reader); code != "not_yours" || status != http.StatusForbidden {
			t.Errorf("%s: %s %d", name, code, status)
		}
	}
	// A list desk: nothing open, the row and the order kept.
	if code, _ := validDesk(desk(`{"view":"list","minimised":["alice-laptop/work/1.2"],"order":["alice-laptop/work/0.0"]}`), reader); code != "" {
		t.Fatalf("a list desk refused: %s", code)
	}
	// Another hub's pane is that hub's to check.
	if code, _ := validDesk(desk(`{"view":"panes","panes":["work~bob-desktop/work/0.0"]}`), reader); code != "" {
		t.Fatalf("a peer's pane refused: %s", code)
	}
	// Read, the desk names only what the principal may read; a tree for
	// panes not all there goes.
	d := desk(good)
	d.Panes = append(d.Panes, "bob-desktop/work/0.0")
	d.Tree = json.RawMessage(`{"kind":"h","key":"r","children":[0,{"kind":"v","key":"s","children":[1,2]}]}`)
	seen := d.forPrincipal(reader)
	if len(seen.Panes) != 2 || seen.Tree != nil || seen.Arrangement != "" {
		t.Fatalf("filtered: %+v", seen)
	}
	// An older client's minimised row is checked and then dropped: the row
	// is the listing's parked panes now.
	dropped := desk(good)
	if code, _ := validDesk(dropped, reader); code != "" || dropped.Minimised != nil {
		t.Fatalf("minimised kept: %s %+v", code, dropped.Minimised)
	}
}
