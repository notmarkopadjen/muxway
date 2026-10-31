package hub

import (
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/notmarkopadjen/muxway/internal/text"
	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

// The inbox is every pane the principal may read that waits for its
// owner, across hosts, oldest first; and an answer is one of the choices
// a question offered, a write like any input.

func (h *Hub) handleInbox(w http.ResponseWriter, r *http.Request, t Principal) {
	charset, ok := charsetParam(r)
	if !ok {
		fail(w, http.StatusBadRequest, "bad_parameter")
		return
	}
	var out []PaneView
	for _, host := range h.visibleHosts(t) {
		panes, _, err := h.readable(r.Context(), t, host)
		if err != nil {
			continue
		}
		for _, p := range panes {
			if p.Attention != nil {
				out = append(out, view(host, t, p))
			}
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Attention.At < out[j].Attention.At })
	if wantsText(r) {
		w.Header().Set("Content-Type", text.ContentType(charset))
		var b strings.Builder
		for _, v := range out {
			fmt.Fprintf(&b, "%s\t%s\t%d\t%s\t%s\n", v.Address, v.Attention.Kind, v.Attention.At,
				text.Fold(v.Attention.Text, charset), text.Fold(strings.Join(v.Attention.Choices, "|"), charset))
		}
		w.Write(text.Encode(b.String(), charset))
		return
	}
	if out == nil {
		out = []PaneView{}
	}
	reply(w, map[string]any{"inbox": out, "count": len(out)})
}

func (h *Hub) handleAnswer(w http.ResponseWriter, r *http.Request, t Principal) {
	host := r.PathValue("host")
	path, _ := strings.CutSuffix(r.PathValue("path"), "/answer")
	var in struct {
		Choice string `json:"choice"`
	}
	if !decodeBody(w, r, &in) {
		return
	}
	if !wire.ValidChoice(in.Choice) {
		fail(w, http.StatusBadRequest, "bad_input")
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
	attrs := []any{"token", t.ID, "method", t.Method, "host", host, "pane", p.PaneID, "choice_bytes", len(in.Choice)}
	if !t.canWrite(host, p) || p.Mode != tmux.ModeWrite {
		h.log.Info("audit answer", append(attrs, "result", "read_only")...)
		fail(w, http.StatusForbidden, "read_only")
		return
	}
	resp, err := a.request(r.Context(), wire.Request{Op: wire.OpAnswer, Actor: t.ID, Pane: p.PaneID, Choice: in.Choice})
	a.forget()
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "host_offline")
		return
	}
	if resp.Error != "" {
		h.log.Info("audit answer", append(attrs, "result", resp.Error)...)
		status, code := statusFor(resp.Error)
		fail(w, status, code)
		return
	}
	h.log.Info("audit answer", append(attrs, "result", "ok")...)
	w.WriteHeader(http.StatusNoContent)
}
