package hub

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"

	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

// A writer of a shell pane lists the names in the pane's directory, or
// in a directory under the host's roots, so a client can make the names
// on the screen links. The preview's grant, limit and one refusal, so
// nothing is learnt of the host.
func (h *Hub) handleListing(w http.ResponseWriter, r *http.Request, t Principal, path string) {
	asked := r.URL.Query().Get("path")
	if asked != "" && !wire.ValidPath(asked) {
		fail(w, http.StatusBadRequest, "bad_input")
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
	attrs := []any{"token", t.ID, "method", t.Method, "host", host, "pane", p.PaneID, "path", asked}
	if !t.canWrite(host, p) || p.Mode != tmux.ModeWrite {
		h.log.Info("audit dir", append(attrs, "result", "read_only")...)
		fail(w, http.StatusForbidden, "read_only")
		return
	}
	if !a.listsDirs(r.Context()) {
		h.log.Info("audit dir", append(attrs, "result", "no_roots")...)
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	if !h.limits.allowNamed("preview:"+t.ID, previewRate, previewBurst) {
		fail(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	resp, err := a.request(r.Context(), wire.Request{Op: wire.OpListDir, Actor: t.ID, Pane: p.PaneID, Path: asked})
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "host_offline")
		return
	}
	if resp.Error != "" || resp.Listing == nil {
		code := resp.Error
		if code == "" {
			code = wire.ErrNoFile
		}
		h.log.Info("audit dir", append(attrs, "result", code)...)
		status, code := statusFor(code)
		fail(w, status, code)
		return
	}
	l := resp.Listing
	if l.Entries == nil {
		l.Entries = []wire.Entry{}
	}
	h.log.Info("audit dir", append(attrs, "result", "ok", "dir", l.Path, "entries", len(l.Entries))...)
	body, _ := json.Marshal(l)
	sum := sha256.Sum256(body)
	etag := `"` + hex.EncodeToString(sum[:8]) + `"`
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(body)
}
