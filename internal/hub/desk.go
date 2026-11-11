package hub

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/notmarkopadjen/muxway/internal/tmux"
)

// The desk: the view the owner's clients share, kept by the hub. Which
// panes are open as tiles, the focused one, the arrangement, the
// minimised ones, the tab order, or the window the window view shows.
// Every client writes it as the person changes it and opens it when it
// starts, so a client reopened, or another one, shows what the last one
// showed. A write grant writes it, a read-only principal reads it, an
// observer never sees it. Read, it names only the panes the principal
// may read.
const (
	deskBody      = 8 << 10
	deskRate      = 1.0 // writes per second per principal
	deskBurst     = 5.0
	deskPanes     = 4
	deskMinimised = 16
	deskOrder     = 64
	deskKeyLen    = 16
	deskDepth     = 8
)

type Desk struct {
	View        string               `json:"view"`
	Panes       []string             `json:"panes,omitempty"`
	Focused     string               `json:"focused,omitempty"`
	Arrangement string               `json:"arrangement,omitempty"`
	Tree        json.RawMessage      `json:"tree,omitempty"`
	Weights     map[string][]float64 `json:"weights,omitempty"`
	// Minimised is what a client older than the merge of the minimised row
	// into the later mark still sends: the row is the listing's parked
	// panes now, so the field is checked as before and dropped, never kept
	// or answered.
	Minimised []string `json:"minimised,omitempty"`
	Order     []string `json:"order,omitempty"`
	Window    string   `json:"window,omitempty"`
	Updated   int64    `json:"updated"`
	By        string   `json:"by,omitempty"`
	// Rev counts the writes, so a client orders desks a second apart.
	Rev uint64 `json:"rev"`
}

var arrangements = map[string]bool{"row": true, "column": true, "grid": true, "main-left": true, "main-top": true, "custom": true}

// deskAddress takes an address apart: the hub it names (another hub's
// pane, `<hub>~<address>`), the host, and a pane shaped for the grant
// check: its session, window and pane index, or its alias.
func deskAddress(a string) (hub, host string, pane tmux.Pane, ok bool) {
	if i := strings.Index(a, "~"); i >= 0 {
		hub, a = a[:i], a[i+1:]
		if !hostName.MatchString(hub) {
			return "", "", tmux.Pane{}, false
		}
	}
	host, rest, found := strings.Cut(a, "/")
	if !found || !hostName.MatchString(host) {
		return "", "", tmux.Pane{}, false
	}
	if aliasSeg.MatchString(rest) {
		return hub, host, tmux.Pane{Alias: rest[1:]}, true
	}
	session, wp, found := strings.Cut(rest, "/")
	i := strings.LastIndex(wp, ".")
	if !found || i < 0 || !nameSeg.MatchString(session) || !indexSeg.MatchString(wp[i+1:]) {
		return "", "", tmux.Pane{}, false
	}
	window := wp[:i]
	if !nameSeg.MatchString(window) {
		return "", "", tmux.Pane{}, false
	}
	pane.SessionName = session
	pane.PaneIndex, _ = strconv.Atoi(wp[i+1:])
	if indexSeg.MatchString(window) {
		pane.WindowIndex, _ = strconv.Atoi(window)
	} else {
		pane.WindowName, pane.WindowIndex = window, -1
	}
	return hub, host, pane, true
}

// deskWindow is a window address, host/session/window.
func deskWindow(a string) bool {
	parts := strings.Split(a, "/")
	return len(parts) == 3 && hostName.MatchString(parts[0]) && nameSeg.MatchString(parts[1]) && nameSeg.MatchString(parts[2])
}

// mayRead says the principal may read the pane an address names: on this
// hub by its grants, on another hub by that hub's, which the client asks
// itself.
func (t Principal) mayRead(address string) bool {
	hub, host, pane, ok := deskAddress(address)
	if !ok {
		return false
	}
	if hub != "" {
		return true
	}
	return t.canSeeHost(host) && t.canRead(host, pane)
}

// treeLeaves counts the leaves of a tile tree and checks its shape: a
// number, or {kind: h or v, key, children}, nested a few deep.
func treeLeaves(raw json.RawMessage, depth int) (int, error) {
	if depth > deskDepth {
		return 0, errors.New("tree too deep")
	}
	var n int
	if err := json.Unmarshal(raw, &n); err == nil {
		if n < 0 || n >= deskPanes {
			return 0, errors.New("leaf out of range")
		}
		return 1, nil
	}
	var node struct {
		Kind     string            `json:"kind"`
		Key      string            `json:"key"`
		Children []json.RawMessage `json:"children"`
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&node); err != nil {
		return 0, errors.New("tree node")
	}
	if (node.Kind != "h" && node.Kind != "v") || len(node.Key) == 0 || len(node.Key) > deskKeyLen || len(node.Children) < 2 || len(node.Children) > deskPanes {
		return 0, errors.New("tree node")
	}
	total := 0
	for _, c := range node.Children {
		n, err := treeLeaves(c, depth+1)
		if err != nil {
			return 0, err
		}
		total += n
	}
	return total, nil
}

// validDesk checks a desk a client sent, against the principal's grants.
func validDesk(d *Desk, t Principal) (code string, status int) {
	noTwice := func(list []string) bool {
		seen := map[string]bool{}
		for _, a := range list {
			if seen[a] {
				return false
			}
			seen[a] = true
		}
		return true
	}
	addresses := func(list []string, limit int) (string, int) {
		if len(list) > limit || !noTwice(list) {
			return "bad_input", http.StatusBadRequest
		}
		for _, a := range list {
			if _, _, _, ok := deskAddress(a); !ok {
				return "bad_input", http.StatusBadRequest
			}
			if !t.mayRead(a) {
				return "not_yours", http.StatusForbidden
			}
		}
		return "", 0
	}
	switch d.View {
	case "panes":
		if len(d.Panes) == 0 || d.Window != "" {
			return "bad_input", http.StatusBadRequest
		}
		if code, status := addresses(d.Panes, deskPanes); code != "" {
			return code, status
		}
		if d.Focused != "" && !contains(d.Panes, d.Focused) {
			return "bad_input", http.StatusBadRequest
		}
		if d.Arrangement != "" && !arrangements[d.Arrangement] {
			return "bad_input", http.StatusBadRequest
		}
		if len(d.Tree) > 0 {
			if n, err := treeLeaves(d.Tree, 0); err != nil || n != len(d.Panes) {
				return "bad_input", http.StatusBadRequest
			}
		}
		if len(d.Weights) > deskPanes*2 {
			return "bad_input", http.StatusBadRequest
		}
		for k, ws := range d.Weights {
			if len(k) == 0 || len(k) > deskKeyLen || len(ws) < 2 || len(ws) > deskPanes {
				return "bad_input", http.StatusBadRequest
			}
			for _, w := range ws {
				if !(w > 0 && w < 1) {
					return "bad_input", http.StatusBadRequest
				}
			}
		}
	case "window":
		if d.Window == "" || !deskWindow(d.Window) || len(d.Panes) > 0 || d.Arrangement != "" || len(d.Tree) > 0 || len(d.Weights) > 0 {
			return "bad_input", http.StatusBadRequest
		}
		host := strings.SplitN(d.Window, "/", 2)[0]
		if !t.canSeeHost(host) {
			return "not_yours", http.StatusForbidden
		}
		if d.Focused != "" && !t.mayRead(d.Focused) {
			return "not_yours", http.StatusForbidden
		}
	case "list":
		// Nothing open: the last tile minimised with no other pane awake.
		// Only the order says anything.
		if len(d.Panes) > 0 || d.Window != "" || d.Focused != "" || d.Arrangement != "" || len(d.Tree) > 0 || len(d.Weights) > 0 {
			return "bad_input", http.StatusBadRequest
		}
	default:
		return "bad_input", http.StatusBadRequest
	}
	if code, status := addresses(d.Minimised, deskMinimised); code != "" {
		return code, status
	}
	d.Minimised = nil
	if code, status := addresses(d.Order, deskOrder); code != "" {
		return code, status
	}
	if len(d.By) > 64 {
		return "bad_input", http.StatusBadRequest
	}
	return "", 0
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// forPrincipal is the desk with the panes the principal may not read left
// out, the focus with them.
func (d Desk) forPrincipal(t Principal) Desk {
	keep := func(list []string) []string {
		var out []string
		for _, a := range list {
			if t.mayRead(a) {
				out = append(out, a)
			}
		}
		return out
	}
	d.Panes, d.Order = keep(d.Panes), keep(d.Order)
	if d.Focused != "" && !t.mayRead(d.Focused) {
		d.Focused = ""
	}
	if d.View == "window" && d.Window != "" && !t.canSeeHost(strings.SplitN(d.Window, "/", 2)[0]) {
		d.Window, d.View = "", "panes"
	}
	// A tree for panes that are not all there is no tree.
	if d.View == "panes" && len(d.Tree) > 0 {
		if n, err := treeLeaves(d.Tree, 0); err != nil || n != len(d.Panes) {
			d.Tree, d.Weights = nil, nil
			if d.Arrangement == "custom" {
				d.Arrangement = ""
			}
		}
	}
	return d
}

func (h *Hub) handleDesk(w http.ResponseWriter, r *http.Request, t Principal) {
	d, ok := h.store.desk()
	if !ok {
		d = Desk{View: "panes"}
	}
	raw, _ := json.Marshal(map[string]any{"desk": d.forPrincipal(t)})
	sum := sha256.Sum256(raw)
	etag := `"` + hex.EncodeToString(sum[:8]) + `"`
	w.Header().Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(raw)
}

func (h *Hub) handlePutDesk(w http.ResponseWriter, r *http.Request, t Principal) {
	attrs := []any{"token", t.ID, "method", t.Method}
	if len(t.Write) == 0 {
		h.log.Info("audit desk", append(attrs, "result", "read_only")...)
		fail(w, http.StatusForbidden, "read_only")
		return
	}
	var d Desk
	if !decodeLimited(w, r, &d, deskBody) {
		return
	}
	if code, status := validDesk(&d, t); code != "" {
		h.log.Info("audit desk", append(attrs, "result", code)...)
		fail(w, status, code)
		return
	}
	// The limit is on desks taken; a refused body costs the principal's
	// own rate only.
	if !h.limits.allowDesk(t.ID) {
		fail(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	d.Updated, d.By = time.Now().Unix(), t.Name
	stored, err := h.store.setDesk(d)
	if err != nil {
		h.log.Error("desk not saved", "err", err)
		fail(w, http.StatusInternalServerError, "error")
		return
	}
	h.log.Info("audit desk", append(attrs, "view", d.View, "panes", len(d.Panes), "rev", stored.Rev, "result", "ok")...)
	h.events.add("", wireDeskEvent(stored.Rev))
	reply(w, map[string]any{"desk": stored})
}
