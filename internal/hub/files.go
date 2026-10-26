package hub

import (
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

// Files for a pane's program: a client sends one, the hub checks it and
// hands the bytes to the agent, which writes it into its inbox and
// answers the path. The hub keeps nothing; the client's own name for the
// file goes nowhere.
const (
	fileRate  = 0.5 // one file every two seconds per principal
	fileBurst = 1
	// Reading one back: a second apart, a few at once.
	fileReadRate  = 1
	fileReadBurst = 3
	// A preview of a file under the host's roots.
	previewRate  = 2
	previewBurst = 5
)

// paneForFiles finds a pane the principal may write and whose agent takes files.
// It answers the refusal itself, and says which, for the audit line.
func (h *Hub) paneForFiles(w http.ResponseWriter, r *http.Request, t Principal, path string) (*agentConn, tmux.Pane, []any, string) {
	host := r.PathValue("host")
	a, p, status := h.locate(r.Context(), t, host, path)
	if status != 0 {
		code := "not_found"
		if status == http.StatusServiceUnavailable {
			code = "host_offline"
		}
		fail(w, status, code)
		return nil, p, nil, code
	}
	attrs := []any{"token", t.ID, "method", t.Method, "host", host, "pane", p.PaneID}
	if !t.canWrite(host, p) || p.Mode != tmux.ModeWrite {
		fail(w, http.StatusForbidden, "read_only")
		return nil, p, attrs, "read_only"
	}
	if !a.takesFiles(r.Context()) {
		fail(w, http.StatusNotFound, "not_found")
		return nil, p, attrs, "no_inbox"
	}
	return a, p, attrs, ""
}

// handleFilesProbe answers 204 when the pane may be sent a file, so a
// client shows its button or not.
func (h *Hub) handleFilesProbe(w http.ResponseWriter, r *http.Request, t Principal, path string) {
	if _, _, _, code := h.paneForFiles(w, r, t, path); code == "" {
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleFileRead serves one inbox file back to a reader of the pane, by
// the name the agent gave it and nothing else. The type is the name's,
// never sniffed, so a file is shown as what the inbox took it as.
func (h *Hub) handleFileRead(w http.ResponseWriter, r *http.Request, t Principal, path, name string) {
	if !wire.ValidFileName(name) {
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
	attrs := []any{"token", t.ID, "method", t.Method, "host", host, "pane", p.PaneID, "name", name}
	if !a.takesFiles(r.Context()) {
		h.log.Info("audit read-file", append(attrs, "result", "no_inbox")...)
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	if !h.limits.allowNamed("read-file:"+t.ID, fileReadRate, fileReadBurst) {
		fail(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	resp, err := a.request(r.Context(), wire.Request{Op: wire.OpReadFile, Actor: t.ID, Pane: p.PaneID, Name: name})
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "host_offline")
		return
	}
	if resp.Error != "" {
		h.log.Info("audit read-file", append(attrs, "result", resp.Error)...)
		status, code := statusFor(resp.Error)
		fail(w, status, code)
		return
	}
	h.log.Info("audit read-file", append(attrs, "result", "ok", "bytes", len(resp.Data))...)
	serveBytes(w, resp.Type, resp.Data)
}

// serveBytes sends a file as the type its name says, to be shown inline
// and never sniffed or cached.
func serveBytes(w http.ResponseWriter, typ string, data []byte) {
	w.Header().Set("Content-Type", typ)
	w.Header().Set("Content-Disposition", "inline")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.Write(data)
}

// handlePreview serves a file a pane printed the path of, to a writer of
// the pane, when the host's agent has it under a root. Every refusal of
// the agent's is one 404, so nothing is learnt of the host.
func (h *Hub) handlePreview(w http.ResponseWriter, r *http.Request, t Principal, path string) {
	asked := r.URL.Query().Get("path")
	if !wire.ValidPath(asked) {
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
		h.log.Info("audit preview", append(attrs, "result", "read_only")...)
		fail(w, http.StatusForbidden, "read_only")
		return
	}
	if !a.previews(r.Context()) {
		h.log.Info("audit preview", append(attrs, "result", "no_roots")...)
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	if !h.limits.allowNamed("preview:"+t.ID, previewRate, previewBurst) {
		fail(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	resp, err := a.request(r.Context(), wire.Request{Op: wire.OpReadPath, Actor: t.ID, Pane: p.PaneID, Path: asked})
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "host_offline")
		return
	}
	if resp.Error != "" {
		h.log.Info("audit preview", append(attrs, "result", resp.Error)...)
		status, code := statusFor(resp.Error)
		fail(w, status, code)
		return
	}
	h.log.Info("audit preview", append(attrs, "result", "ok", "bytes", len(resp.Data))...)
	serveBytes(w, resp.Type, resp.Data)
}

func (h *Hub) handleFile(w http.ResponseWriter, r *http.Request, t Principal) {
	path, _ := strings.CutSuffix(r.PathValue("path"), "/files")
	a, p, attrs, refused := h.paneForFiles(w, r, t, path)
	if refused != "" {
		if attrs != nil {
			h.log.Info("audit file", append(attrs, "result", refused)...)
		}
		return
	}
	typ, data, code := readFilePart(w, r)
	if code != "" {
		status := map[string]int{"too_large": http.StatusRequestEntityTooLarge, "unsupported": http.StatusUnsupportedMediaType}[code]
		if status == 0 {
			status = http.StatusBadRequest
		}
		h.log.Info("audit file", append(attrs, "result", code)...)
		fail(w, status, code)
		return
	}
	// A refused file costs nothing; one that would reach the host takes the slot.
	if !h.limits.allowNamed("file:"+t.ID, fileRate, fileBurst) {
		fail(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	attrs = append(attrs, "type", typ, "bytes", len(data))
	start := time.Now()
	resp, err := a.request(r.Context(), wire.Request{Op: wire.OpFile, Actor: t.ID, Pane: p.PaneID, Type: typ, Data: data})
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "host_offline")
		return
	}
	attrs = append(attrs, "took", time.Since(start).Round(time.Millisecond))
	switch resp.Error {
	case "":
	case wire.ErrInboxFull:
		h.log.Info("audit file", append(attrs, "result", resp.Error)...)
		fail(w, http.StatusInsufficientStorage, "inbox_full")
		return
	case wire.ErrBadInput:
		h.log.Info("audit file", append(attrs, "result", resp.Error)...)
		fail(w, http.StatusUnsupportedMediaType, "unsupported")
		return
	default:
		h.log.Info("audit file", append(attrs, "result", resp.Error)...)
		status, code := statusFor(resp.Error)
		fail(w, status, code)
		return
	}
	h.log.Info("audit file", append(attrs, "result", "ok", "path", resp.Path)...)
	created(w, map[string]any{"path": resp.Path, "bytes": len(data)})
}

// readFilePart takes the request's one part named file: its declared
// type, which must be one the inbox takes and agree with the bytes, and
// at most wire.MaxFile of them.
func readFilePart(w http.ResponseWriter, r *http.Request) (string, []byte, string) {
	mt, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mt != "multipart/form-data" || params["boundary"] == "" {
		return "", nil, "bad_input"
	}
	mr := multipart.NewReader(http.MaxBytesReader(w, r.Body, wire.MaxFile+64<<10), params["boundary"])
	part, err := mr.NextPart()
	if err != nil {
		return "", nil, sizeOr(err, "bad_input")
	}
	if part.FormName() != "file" {
		return "", nil, "bad_input"
	}
	typ, _, err := mime.ParseMediaType(part.Header.Get("Content-Type"))
	if err != nil {
		return "", nil, "unsupported"
	}
	data, err := io.ReadAll(io.LimitReader(part, wire.MaxFile+1))
	if err != nil {
		return "", nil, sizeOr(err, "bad_input")
	}
	if len(data) > wire.MaxFile {
		return "", nil, "too_large"
	}
	if _, err := mr.NextPart(); err != io.EOF {
		return "", nil, sizeOr(err, "bad_input")
	}
	if !wire.ValidFile(typ, data) {
		return "", nil, "unsupported"
	}
	return typ, data, ""
}

func sizeOr(err error, code string) string {
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		return "too_large"
	}
	return code
}
