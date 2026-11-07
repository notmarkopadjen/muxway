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
// owner, across hosts, oldest first, the panes the owner parked for later
// after them; an answer is one of the choices a question offered, a write
// like any input; and later is the owner's own mark on a pane, a write
// too.

// textKind is the kind column of a text-mode row: what the pane waits
// for, or later once the owner parked it.
func textKind(p tmux.Pane) string {
	if p.Later {
		return "later"
	}
	if p.Attention != nil {
		return p.Attention.Kind
	}
	return ""
}

// textPending is the column after the ones a 0.8 phone knows: what waits
// under a parked pane, so a row can read "zz · !"; empty for an awake
// pane, whose kind column says it.
func textPending(p tmux.Pane) string {
	if p.Later && p.Attention != nil {
		return p.Attention.Kind
	}
	return ""
}

// textFlags is the third column of a text-mode host row: the features
// the host's agent takes, named as the JSON flags are, joined by |, in a
// fixed order, so a small client finds one with a substring search.
func textFlags(v hostView) string {
	var f []string
	for _, x := range []struct {
		on   bool
		name string
	}{{v.Sessions, "sessions"}, {v.Close, "close"}, {v.Preview, "preview"}, {v.Repeat, "repeat"}, {v.Ask, "ask"}, {v.Mail, "mail"}, {v.Later, "later"}, {v.Dir, "dir"}, {v.Rename, "rename"}, {v.Keys == 2, "keys2"}} {
		if x.on {
			f = append(f, x.name)
		}
	}
	return strings.Join(f, "|")
}

// sortInbox puts the awake panes first, then the parked ones, each
// oldest first.
func sortInbox(out []PaneView) {
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Later != out[j].Later {
			return !out[i].Later
		}
		return inboxAt(out[i].Pane) < inboxAt(out[j].Pane)
	})
}

// inboxAt is when an inbox entry began waiting: its attention, or its
// parking for a pane with none.
func inboxAt(p tmux.Pane) int64 {
	if p.Attention != nil {
		return p.Attention.At
	}
	return p.LaterAt
}

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
			if p.Attention != nil || p.Later {
				out = append(out, view(host, t, p))
			}
		}
	}
	sortInbox(out)
	if wantsText(r) {
		w.Header().Set("Content-Type", text.ContentType(charset))
		var b strings.Builder
		for _, v := range out {
			att := v.Attention
			if att == nil {
				att = &tmux.Attention{}
			}
			fmt.Fprintf(&b, "%s\t%s\t%d\t%s\t%s\t%s\t%s\n", v.Address, textKind(v.Pane), inboxAt(v.Pane),
				text.Fold(att.Text, charset), text.Fold(strings.Join(att.Choices, "|"), charset), textPending(v.Pane), v.PaneID)
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
		Choice string  `json:"choice"`
		From   *origin `json:"from"`
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
	var from tmux.Pane
	req := wire.Request{Op: wire.OpAnswer, Actor: t.ID, Pane: p.PaneID, Choice: in.Choice}
	if in.From != nil {
		var status int
		var code string
		if from, status, code = h.origin(r.Context(), t, in.From); status != 0 {
			h.log.Info("audit answer", append(attrs, "from", in.From.Host+"/"+in.From.PaneID, "result", "bad_origin")...)
			fail(w, status, code)
			return
		}
		req.From = in.From.Host + "/" + from.PaneID
		attrs = append(attrs, "from", req.From)
	}
	resp, err := a.request(r.Context(), req)
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
	if in.From != nil {
		h.said(t, in.From, from, host, p, "answer", in.Choice, 0)
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleLater parks a pane for later, or wakes it: the owner's own mark,
// kept by the host beside the pane's attention.
func (h *Hub) handleLater(w http.ResponseWriter, r *http.Request, t Principal) {
	host := r.PathValue("host")
	path, _ := strings.CutSuffix(r.PathValue("path"), "/later")
	var in struct {
		Later *bool `json:"later"`
	}
	if !decodeBody(w, r, &in) {
		return
	}
	if in.Later == nil {
		fail(w, http.StatusBadRequest, "bad_input")
		return
	}
	if !h.limits.allowLater(t.ID) {
		fail(w, http.StatusTooManyRequests, "rate_limited")
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
	attrs := []any{"token", t.ID, "method", t.Method, "host", host, "pane", p.PaneID, "later", *in.Later}
	if !t.canWrite(host, p) || p.Mode != tmux.ModeWrite {
		h.log.Info("audit later", append(attrs, "result", "read_only")...)
		fail(w, http.StatusForbidden, "read_only")
		return
	}
	if !a.parks(r.Context()) {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	resp, err := a.request(r.Context(), wire.Request{Op: wire.OpLater, Actor: t.ID, Pane: p.PaneID, Later: in.Later})
	a.forget()
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "host_offline")
		return
	}
	if resp.Error != "" {
		h.log.Info("audit later", append(attrs, "result", resp.Error)...)
		status, code := statusFor(resp.Error)
		fail(w, status, code)
		return
	}
	h.log.Info("audit later", append(attrs, "result", "ok")...)
	w.WriteHeader(http.StatusNoContent)
}
