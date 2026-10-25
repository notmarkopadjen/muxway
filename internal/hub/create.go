package hub

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

// A client may make a pane where it may already type, and a session where
// the host's owner allowed that. Both go through the agent like input; the
// hub checks the grants, and undoes a split whose pane they do not cover.

// decodeBody reads one strict JSON object into v.
func decodeBody(w http.ResponseWriter, r *http.Request, v any) bool {
	return decodeLimited(w, r, v, maxBody)
}

func decodeLimited(w http.ResponseWriter, r *http.Request, v any, limit int64) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			fail(w, http.StatusRequestEntityTooLarge, "too_large")
			return false
		}
		fail(w, http.StatusBadRequest, "bad_json")
		return false
	}
	if _, err := dec.Token(); err != io.EOF {
		fail(w, http.StatusBadRequest, "bad_json")
		return false
	}
	return true
}

// handleSplit adds a pane to a window, beside or below one the principal
// may type into.
func (h *Hub) handleSplit(w http.ResponseWriter, r *http.Request, t Principal) {
	host, session, window := r.PathValue("host"), r.PathValue("session"), r.PathValue("window")
	var in struct {
		Direction string `json:"direction"`
	}
	if !decodeBody(w, r, &in) {
		return
	}
	if !wire.ValidDirection(in.Direction) {
		fail(w, http.StatusBadRequest, "bad_input")
		return
	}
	if !hostName.MatchString(host) || !t.canSeeHost(host) || !nameSeg.MatchString(session) || !nameSeg.MatchString(window) {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	if !h.limits.allowCreate(t.ID) {
		fail(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	panes, a, err := h.readable(r.Context(), t, host)
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "host_offline")
		return
	}
	// The source is the window's active pane when the principal may type
	// there, else the first pane of the window it may.
	var src *tmux.Pane
	found := false
	for i := range panes {
		p := &panes[i]
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
		found = true
		if !t.canWrite(host, *p) || p.Mode != tmux.ModeWrite {
			continue
		}
		if src == nil || p.PaneActive {
			src = p
		}
	}
	attrs := []any{"token", t.ID, "method", t.Method, "host", host, "session", session, "window", window, "direction", in.Direction}
	if !found {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	if src == nil {
		h.log.Info("audit split", append(attrs, "result", "read_only")...)
		fail(w, http.StatusForbidden, "read_only")
		return
	}
	resp, err := a.request(r.Context(), wire.Request{Op: wire.OpSplit, Actor: t.ID, Pane: src.PaneID, Direction: in.Direction})
	a.forget()
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "host_offline")
		return
	}
	if resp.Error != "" || resp.Pane == nil {
		code := resp.Error
		if code == "" {
			code = wire.ErrTmux
		}
		h.log.Info("audit split", append(attrs, "result", code)...)
		status, code := statusFor(code)
		fail(w, status, code)
		return
	}
	p := *resp.Pane
	attrs = append(attrs, "made", p.PaneID)
	// A grant for one pane does not reach its new sibling: the pane goes.
	if !t.canWrite(host, p) || p.Mode != tmux.ModeWrite {
		a.request(r.Context(), wire.Request{Op: wire.OpKillPane, Actor: t.ID, Pane: p.PaneID})
		a.forget()
		h.log.Info("audit split", append(attrs, "result", "read_only", "undone", true)...)
		fail(w, http.StatusForbidden, "read_only")
		return
	}
	h.log.Info("audit split", append(attrs, "result", "ok")...)
	created(w, map[string]any{"pane": view(host, t, p)})
}

// handleClose closes a pane on its host: the principal may type into it,
// the pane is marked for writing and the agent runs with --allow-close.
// Whatever runs in the pane ends; the client asked its person first.
func (h *Hub) handleClose(w http.ResponseWriter, r *http.Request, t Principal) {
	host := r.PathValue("host")
	path, _ := strings.CutSuffix(r.PathValue("path"), "/close")
	if r.ContentLength > 0 {
		var in struct{}
		if !decodeBody(w, r, &in) {
			return
		}
	}
	a, p, status := h.locate(r.Context(), t, host, path)
	if status != 0 {
		if status == http.StatusServiceUnavailable {
			fail(w, status, "host_offline")
		} else {
			fail(w, status, "not_found")
		}
		return
	}
	attrs := []any{"token", t.ID, "method", t.Method, "host", host, "pane", p.PaneID}
	if !t.canWrite(host, p) || p.Mode != tmux.ModeWrite {
		h.log.Info("audit close", append(attrs, "result", "read_only")...)
		fail(w, http.StatusForbidden, "read_only")
		return
	}
	if !h.limits.allowCreate(t.ID) {
		fail(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	resp, err := a.request(r.Context(), wire.Request{Op: wire.OpClosePane, Actor: t.ID, Pane: p.PaneID})
	a.forget()
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "host_offline")
		return
	}
	if resp.Error != "" {
		h.log.Info("audit close", append(attrs, "result", resp.Error)...)
		status, code := statusFor(resp.Error)
		fail(w, status, code)
		return
	}
	h.log.Info("audit close", append(attrs, "result", "ok")...)
	w.WriteHeader(http.StatusNoContent)
}

// handleNewSession starts a session on a host whose agent allows it, for a
// principal with a write grant on the session's name.
func (h *Hub) handleNewSession(w http.ResponseWriter, r *http.Request, t Principal) {
	host := r.PathValue("host")
	var in struct {
		Name string `json:"name"`
	}
	if !decodeBody(w, r, &in) {
		return
	}
	if !wire.ValidSessionName(in.Name) {
		fail(w, http.StatusBadRequest, "bad_input")
		return
	}
	if !hostName.MatchString(host) || !t.canSeeHost(host) {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	a := h.agent(host)
	if a == nil {
		fail(w, http.StatusServiceUnavailable, "host_offline")
		return
	}
	if !a.startsSessions(r.Context()) {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	if !h.limits.allowCreate(t.ID) {
		fail(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	attrs := []any{"token", t.ID, "method", t.Method, "host", host, "name", in.Name}
	// The session's first pane will be 0.0 or thereabouts; the grant is
	// checked on the name before asking and on the pane after.
	first := tmux.Pane{SessionName: in.Name}
	if !t.canWrite(host, first) {
		h.log.Info("audit session", append(attrs, "result", "read_only")...)
		fail(w, http.StatusForbidden, "read_only")
		return
	}
	resp, err := a.request(r.Context(), wire.Request{Op: wire.OpNewSession, Actor: t.ID, Name: in.Name})
	a.forget()
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "host_offline")
		return
	}
	if resp.Error != "" || resp.Pane == nil {
		code := resp.Error
		if code == "" {
			code = wire.ErrTmux
		}
		h.log.Info("audit session", append(attrs, "result", code)...)
		status, code := statusFor(code)
		fail(w, status, code)
		return
	}
	p := *resp.Pane
	attrs = append(attrs, "made", p.PaneID)
	if !t.canWrite(host, p) || p.Mode != tmux.ModeWrite {
		a.request(r.Context(), wire.Request{Op: wire.OpKillPane, Actor: t.ID, Pane: p.PaneID})
		a.forget()
		h.log.Info("audit session", append(attrs, "result", "read_only", "undone", true)...)
		fail(w, http.StatusForbidden, "read_only")
		return
	}
	h.log.Info("audit session", append(attrs, "result", "ok")...)
	created(w, map[string]any{"pane": view(host, t, p)})
}
