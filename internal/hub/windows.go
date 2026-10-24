package hub

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

// A window in one request: its layout and every pane the principal may
// read, with content. Resizing goes through the agent like input.

// handleResize changes the size of a pane's window on the host, or gives
// it back to tmux. It is a write.
func (h *Hub) handleResize(w http.ResponseWriter, r *http.Request, t Principal) {
	path := strings.TrimSuffix(r.PathValue("path"), "/resize")
	var in struct {
		Cols int    `json:"cols"`
		Rows int    `json:"rows"`
		Fit  string `json:"fit"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			fail(w, http.StatusRequestEntityTooLarge, "too_large")
			return
		}
		fail(w, http.StatusBadRequest, "bad_json")
		return
	}
	if _, err := dec.Token(); err != io.EOF {
		fail(w, http.StatusBadRequest, "bad_json")
		return
	}
	release := in.Fit == "auto" && in.Cols == 0 && in.Rows == 0
	if !release && (in.Fit != "" || !wire.ValidSize(in.Cols, in.Rows)) {
		fail(w, http.StatusBadRequest, "bad_parameter")
		return
	}
	host := r.PathValue("host")
	a, p, status := h.locate(r.Context(), t, host, path)
	if status == http.StatusServiceUnavailable {
		fail(w, status, "host_offline")
		return
	}
	if status != 0 {
		fail(w, status, "not_found")
		return
	}
	if !t.canWrite(host, p) || p.Mode != tmux.ModeWrite {
		fail(w, http.StatusForbidden, "read_only")
		return
	}
	resp, err := a.request(r.Context(), wire.Request{Op: wire.OpResize, Actor: t.ID, Pane: p.PaneID, Cols: in.Cols, Rows: in.Rows, Fit: in.Fit})
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "host_offline")
		return
	}
	a.forget()
	attrs := []any{"token", t.ID, "method", t.Method, "host", host, "pane", p.PaneID, "cols", in.Cols, "rows", in.Rows, "fit", in.Fit}
	if resp.Error != "" {
		h.log.Info("audit resize", append(attrs, "result", resp.Error)...)
		status, code := statusFor(resp.Error)
		fail(w, status, code)
		return
	}
	h.log.Info("audit resize", append(attrs, "result", "ok")...)
	// The pane as tmux has it now.
	panes, _, err := h.readable(r.Context(), t, host)
	if err == nil {
		for _, q := range panes {
			if q.PaneID == p.PaneID {
				p = q
			}
		}
	}
	reply(w, map[string]any{"pane": view(host, t, p)})
}

type paneContent struct {
	Pane    PaneView `json:"pane"`
	Content string   `json:"content"`
}

// handleWindow reads every readable pane of one window.
func (h *Hub) handleWindow(w http.ResponseWriter, r *http.Request, t Principal) {
	lines, ok := intParam(r, "lines", 100, 1, wire.MaxLines)
	ansi := r.URL.Query().Get("ansi") == "1"
	host, session, window := r.PathValue("host"), r.PathValue("session"), r.PathValue("window")
	if !ok {
		fail(w, http.StatusBadRequest, "bad_parameter")
		return
	}
	if !hostName.MatchString(host) || !t.canSeeHost(host) || !nameSeg.MatchString(session) || !nameSeg.MatchString(window) {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	panes, a, err := h.readable(r.Context(), t, host)
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "host_offline")
		return
	}
	var mine []tmux.Pane
	for _, p := range panes {
		if p.SessionName != session {
			continue
		}
		if indexSeg.MatchString(window) {
			if n, _ := strconv.Atoi(window); p.WindowIndex != n {
				continue
			}
		} else if p.WindowName != window {
			continue
		}
		mine = append(mine, p)
	}
	if len(mine) == 0 {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	out := make([]paneContent, len(mine))
	var wg sync.WaitGroup
	var failed error
	var mu sync.Mutex
	for i, p := range mine {
		wg.Add(1)
		go func(i int, p tmux.Pane) {
			defer wg.Done()
			resp, err := a.request(r.Context(), wire.Request{Op: wire.OpRead, Actor: t.ID, Pane: p.PaneID, Lines: lines, ANSI: ansi})
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				failed = errOffline
				return
			}
			if resp.Error != "" {
				failed = errors.New(resp.Error)
				return
			}
			out[i] = paneContent{Pane: view(host, t, p), Content: resp.Content}
		}(i, p)
	}
	wg.Wait()
	if failed != nil {
		a.forget()
		if errors.Is(failed, errOffline) {
			fail(w, http.StatusServiceUnavailable, "host_offline")
			return
		}
		status, code := statusFor(failed.Error())
		fail(w, status, code)
		return
	}
	first := mine[0]
	body, _ := json.Marshal(map[string]any{
		"host": host, "session": session,
		"window": map[string]any{"index": first.WindowIndex, "name": first.WindowName, "layout": first.WindowLayout, "active": first.WindowActive},
		"panes":  out,
	})
	sum := sha256.Sum256(body)
	etag := `"` + hex.EncodeToString(sum[:8]) + `"`
	w.Header().Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(body)
}
