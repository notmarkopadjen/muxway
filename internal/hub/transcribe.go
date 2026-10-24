package hub

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"time"
)

// STT is the transcriber a hub forwards spoken clips to: an
// OpenAI-compatible /v1/audio/transcriptions, which whisper.cpp's server
// also speaks. Without a URL the hub has no transcriber.
type STT struct {
	URL    string
	Key    string
	Model  string
	Prompt string // vocabulary the transcriber would otherwise guess at
}

const (
	maxClip        = 4 << 20 // bytes of WAV
	minClipSeconds = 0.5
	clipHz         = 16000
	maxTranscript  = 4096 // bytes, what input takes
	sttTimeout     = 90 * time.Second
	maxSTTAnswer   = 64 << 10
)

func (h *Hub) hasSTT() bool { return h.cfg.STT.URL != "" }

// handleTranscribeProbe says whether there is a transcriber at all, so a
// client can offer the action or not.
func (h *Hub) handleTranscribeProbe(w http.ResponseWriter, r *http.Request, t Principal) {
	if !h.hasSTT() {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleTranscribe takes a 16 kHz mono 16-bit WAV from a principal that
// may write somewhere, has the transcriber turn it into text, and hands
// the text back cleaned. The clip is kept in memory for the request only.
func (h *Hub) handleTranscribe(w http.ResponseWriter, r *http.Request, t Principal) {
	if !h.hasSTT() {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	if len(t.Write) == 0 {
		fail(w, http.StatusForbidden, "read_only")
		return
	}
	clip, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxClip))
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			fail(w, http.StatusRequestEntityTooLarge, "too_large")
			return
		}
		fail(w, http.StatusBadRequest, "bad_input")
		return
	}
	seconds, ok := wavSeconds(clip)
	if !ok || seconds < minClipSeconds {
		fail(w, http.StatusBadRequest, "bad_input")
		return
	}
	// A real clip takes the slot; a refused body costs nothing.
	if !h.limits.allowClip(t.ID) {
		fail(w, http.StatusTooManyRequests, "rate_limited")
		return
	}
	start := time.Now()
	text, err := h.transcribe(r.Context(), clip)
	attrs := []any{"token", t.ID, "method", t.Method, "bytes", len(clip), "seconds", fmt.Sprintf("%.1f", seconds),
		"took", time.Since(start).Round(time.Millisecond)}
	if err != nil {
		h.log.Info("audit transcribe", append(attrs, "result", err.Error())...)
		fail(w, http.StatusBadGateway, "provider_unavailable")
		return
	}
	h.log.Info("audit transcribe", append(attrs, "result", "ok", "text_bytes", len(text))...)
	if wantsText(r) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprintln(w, text)
		return
	}
	reply(w, map[string]string{"text": text})
}

// wavSeconds reads the header of a PCM WAV and answers its length, or
// false when it is not 16 kHz mono 16-bit.
func wavSeconds(b []byte) (float64, bool) {
	if len(b) < 44 || string(b[0:4]) != "RIFF" || string(b[8:12]) != "WAVE" {
		return 0, false
	}
	at := 12
	var dataLen int
	format := false
	for at+8 <= len(b) {
		id := string(b[at : at+4])
		size := int(binary.LittleEndian.Uint32(b[at+4 : at+8]))
		at += 8
		if size < 0 || at+size > len(b) && id != "data" {
			return 0, false
		}
		switch id {
		case "fmt ":
			if size < 16 {
				return 0, false
			}
			f := b[at : at+16]
			if binary.LittleEndian.Uint16(f[0:2]) != 1 || binary.LittleEndian.Uint16(f[2:4]) != 1 ||
				binary.LittleEndian.Uint32(f[4:8]) != clipHz || binary.LittleEndian.Uint16(f[14:16]) != 16 {
				return 0, false
			}
			format = true
		case "data":
			dataLen = min(size, len(b)-at)
		}
		at += size + size%2
	}
	if !format || dataLen == 0 {
		return 0, false
	}
	return float64(dataLen) / (clipHz * 2), true
}

// transcribe posts the clip as the multipart form an OpenAI-compatible
// transcription endpoint takes and reads the text out of its answer.
func (h *Hub) transcribe(ctx context.Context, clip []byte) (string, error) {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, _ := mw.CreateFormFile("file", "clip.wav")
	part.Write(clip)
	mw.WriteField("model", h.cfg.STT.Model)
	mw.WriteField("response_format", "json")
	if h.cfg.STT.Prompt != "" {
		mw.WriteField("prompt", h.cfg.STT.Prompt)
	}
	mw.Close()
	ctx, cancel := context.WithTimeout(ctx, sttTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.cfg.STT.URL, &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if h.cfg.STT.Key != "" {
		req.Header.Set("Authorization", "Bearer "+h.cfg.STT.Key)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", errors.New("transcriber unreachable")
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, maxSTTAnswer))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("transcriber answered %d", resp.StatusCode)
	}
	var out struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", errors.New("transcriber answered no JSON")
	}
	return cleanTranscript(out.Text), nil
}

// cleanTranscript makes the transcriber's text fit for typing: control
// characters become spaces, blanks collapse, the result is trimmed and
// cut to what input takes.
func cleanTranscript(s string) string {
	var b strings.Builder
	space := true
	for _, r := range s {
		if r < 0x20 || r == 0x7f || (r >= 0x80 && r <= 0x9f) || r == 0xfffd || r == ' ' || r == 0x2028 || r == 0x2029 {
			if !space {
				b.WriteByte(' ')
				space = true
			}
			continue
		}
		if b.Len()+len(string(r)) > maxTranscript {
			break
		}
		b.WriteRune(r)
		space = false
	}
	return strings.TrimSpace(b.String())
}
