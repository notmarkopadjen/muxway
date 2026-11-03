package hub

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

// handleAlias names a pane for a writer: POST /v1/panes/{address}/alias.
// The name is the pane's alias, so it is also how the pane is addressed;
// an empty one takes the name away. The pane comes back as the listing
// shows it after the change.
func (h *Hub) handleAlias(w http.ResponseWriter, r *http.Request, t Principal) {
	host := r.PathValue("host")
	path, _ := strings.CutSuffix(r.PathValue("path"), "/alias")
	var in struct {
		Alias string `json:"alias"`
	}
	if !decodeBody(w, r, &in) {
		return
	}
	if in.Alias != "" && !wire.ValidAlias(in.Alias) {
		fail(w, http.StatusBadRequest, "bad_alias")
		return
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
	attrs := []any{"token", t.ID, "method", t.Method, "host", host, "pane", p.PaneID, "alias", in.Alias, "was", p.Alias}
	if !t.canWrite(host, p) || p.Mode != tmux.ModeWrite {
		h.log.Info("audit alias", append(attrs, "result", "read_only")...)
		fail(w, http.StatusForbidden, "read_only")
		return
	}
	if !a.renames(r.Context()) {
		fail(w, http.StatusNotFound, "not_supported")
		return
	}
	resp, err := a.request(r.Context(), wire.Request{Op: wire.OpAlias, Actor: t.ID, Pane: p.PaneID, Alias: in.Alias})
	a.forget()
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "host_offline")
		return
	}
	if resp.Error != "" {
		h.log.Info("audit alias", append(attrs, "result", resp.Error)...)
		status, code := statusFor(resp.Error)
		fail(w, status, code)
		return
	}
	h.log.Info("audit alias", append(attrs, "result", "ok")...)
	// The listing after the change names the pane; the pane id finds it
	// whatever it was addressed by.
	after := p
	after.Alias = in.Alias
	if panes, _, err := h.readable(r.Context(), t, host); err == nil {
		for _, q := range panes {
			if q.PaneID == p.PaneID {
				after = q
			}
		}
	}
	if wantsText(r) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprintf(w, "%s/%s\t%s\n", host, after.Address(), after.Alias)
		return
	}
	vs := []PaneView{view(host, t, after)}
	h.withTalk(r.Context(), t, vs)
	reply(w, map[string]any{"pane": vs[0]})
}
