package hub

import (
	"net/http"

	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

// Changes: a writer of a pane asks for git's view of the repository the
// pane works in, and for one change's diff. The agent runs both only for
// a repository under its preview roots; the hub asks nothing of a host
// without roots, and every refusal of the agent's is one 404.
const (
	changesRate  = 1
	changesBurst = 6
	diffRate     = 2
	diffBurst    = 5
)

// paneForChanges finds the pane for a changes request: a writer's,
// writable, on a host with roots. It answers the refusal itself.
func (h *Hub) paneForChanges(w http.ResponseWriter, r *http.Request, t Principal, path, what string, attrs []any) (*agentConn, tmux.Pane, []any, bool) {
	host := r.PathValue("host")
	a, p, status := h.locate(r.Context(), t, host, path)
	if status == http.StatusServiceUnavailable {
		fail(w, status, "host_offline")
		return nil, p, nil, false
	}
	if status != 0 {
		fail(w, status, "not_found")
		return nil, p, nil, false
	}
	attrs = append([]any{"token", t.ID, "method", t.Method, "host", host, "pane", p.PaneID}, attrs...)
	if !t.canWrite(host, p) || p.Mode != tmux.ModeWrite {
		h.log.Info("audit "+what, append(attrs, "result", "read_only")...)
		fail(w, http.StatusForbidden, "read_only")
		return nil, p, nil, false
	}
	if !a.previews(r.Context()) {
		h.log.Info("audit "+what, append(attrs, "result", "no_roots")...)
		fail(w, http.StatusNotFound, "not_found")
		return nil, p, nil, false
	}
	return a, p, attrs, true
}

// handleChanges answers the repository's status.
func (h *Hub) handleChanges(w http.ResponseWriter, r *http.Request, t Principal, path string) {
	a, p, attrs, ok := h.paneForChanges(w, r, t, path, "changes", nil)
	if !ok {
		return
	}
	if !h.limits.allowNamed("changes:"+t.ID, changesRate, changesBurst) {
		fail(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	resp, err := a.request(r.Context(), wire.Request{Op: wire.OpGitStatus, Actor: t.ID, Pane: p.PaneID})
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "host_offline")
		return
	}
	if resp.Error != "" || resp.Changes == nil {
		code := resp.Error
		if code == "" {
			code = wire.ErrNoFile
		}
		h.log.Info("audit changes", append(attrs, "result", code)...)
		status, code := statusFor(code)
		fail(w, status, code)
		return
	}
	h.log.Info("audit changes", append(attrs, "result", "ok", "root", resp.Changes.Root, "entries", len(resp.Changes.Entries))...)
	w.Header().Set("Cache-Control", "private, no-store")
	reply(w, resp.Changes)
}

// handleDiff answers one change's diff, as text in JSON, so a client
// draws it as runs of text and never as a page.
func (h *Hub) handleDiff(w http.ResponseWriter, r *http.Request, t Principal, path string) {
	asked := r.URL.Query().Get("path")
	if !wire.ValidPath(asked) {
		fail(w, http.StatusBadRequest, "bad_input")
		return
	}
	a, p, attrs, ok := h.paneForChanges(w, r, t, path, "diff", []any{"path", asked})
	if !ok {
		return
	}
	if !h.limits.allowNamed("diff:"+t.ID, diffRate, diffBurst) {
		fail(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	resp, err := a.request(r.Context(), wire.Request{Op: wire.OpGitDiff, Actor: t.ID, Pane: p.PaneID, Path: asked})
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "host_offline")
		return
	}
	if resp.Error != "" {
		h.log.Info("audit diff", append(attrs, "result", resp.Error)...)
		status, code := statusFor(resp.Error)
		fail(w, status, code)
		return
	}
	h.log.Info("audit diff", append(attrs, "result", "ok", "bytes", len(resp.Diff), "binary", resp.Binary, "cut", resp.Cut)...)
	w.Header().Set("Cache-Control", "private, no-store")
	reply(w, map[string]any{"diff": resp.Diff, "binary": resp.Binary, "cut": resp.Cut})
}
