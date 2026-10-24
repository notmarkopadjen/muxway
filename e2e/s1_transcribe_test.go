//go:build e2e

package e2e

import (
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// A stand-in transcriber: what whisper.cpp's server or an OpenAI-compatible
// endpoint answers, with knobs for the security tests.
type stt struct {
	srv    *httptest.Server
	calls  atomic.Int32
	answer func(w http.ResponseWriter)
}

func sttOK(w http.ResponseWriter) {
	json.NewEncoder(w).Encode(map[string]string{"text": "run the tests again"})
}

func newSTT(t *testing.T) *stt {
	s := &stt{answer: sttOK}
	s.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.calls.Add(1)
		if err := r.ParseMultipartForm(8 << 20); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if r.FormValue("model") == "" || r.FormValue("prompt") != "alice-laptop, muxway" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		f, _, err := r.FormFile("file")
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		raw, _ := io.ReadAll(f)
		if len(raw) < 44 || string(raw[0:4]) != "RIFF" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		s.answer(w)
	}))
	t.Cleanup(s.srv.Close)
	return s
}

func clip(seconds float64) []byte {
	n := int(seconds * 16000)
	data := make([]byte, n*2)
	for i := 0; i < n; i++ {
		binary.LittleEndian.PutUint16(data[i*2:], uint16(int16(3000*((i/20)%2*2-1))))
	}
	b := make([]byte, 44+len(data))
	copy(b[0:4], "RIFF")
	binary.LittleEndian.PutUint32(b[4:8], uint32(36+len(data)))
	copy(b[8:12], "WAVE")
	copy(b[12:16], "fmt ")
	binary.LittleEndian.PutUint32(b[16:20], 16)
	binary.LittleEndian.PutUint16(b[20:22], 1)
	binary.LittleEndian.PutUint16(b[22:24], 1)
	binary.LittleEndian.PutUint32(b[24:28], 16000)
	binary.LittleEndian.PutUint32(b[28:32], 32000)
	binary.LittleEndian.PutUint16(b[32:34], 2)
	binary.LittleEndian.PutUint16(b[34:36], 16)
	copy(b[36:40], "data")
	binary.LittleEndian.PutUint32(b[40:44], uint32(len(data)))
	copy(b[44:], data)
	return b
}

func (e *env) transcribe(token string, body []byte, accept string) resp {
	e.t.Helper()
	req, _ := http.NewRequest("POST", e.url()+"/v1/transcribe", strings.NewReader(string(body)))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Content-Type", "audio/wav")
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	r, err := e.client.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer r.Body.Close()
	raw, _ := io.ReadAll(r.Body)
	return resp{r.StatusCode, string(raw), r.Header}
}

func sttEnv(t *testing.T) (*env, *stt) {
	s := newSTT(t)
	dir, _ := os.MkdirTemp("", "mxw-stt-")
	t.Cleanup(func() { os.RemoveAll(dir) })
	keyFile := filepath.Join(dir, "stt.key")
	os.WriteFile(keyFile, []byte("stt-test-key-0000\n"), 0o600)
	remember("stt-test-key-0000")
	e := newEnv(t, "--stt-url", s.srv.URL+"/v1/audio/transcriptions", "--stt-key-file", keyFile,
		"--stt-model", "whisper-base.en", "--stt-prompt", "alice-laptop, muxway")
	e.stt = s
	return e, s
}

// 20 to 24: the transcriber is the owner's; only writers reach it, and only with real clips.
func TestSec20_TranscribeNeedsAWriter(t *testing.T) {
	e, s := sttEnv(t)
	ts := newTmux(t)
	e.pairAgent(host, ts)
	e.expose(ts, "work:0.0", "--write")
	reader := e.token("reader", []string{host + "/*"}, nil)
	writer := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	revoked := e.token("gone", []string{host + "/*"}, []string{host + "/*"})
	for _, line := range strings.Split(e.mustCLI("hub", "token", "list", "--dir", e.hubDir), "\n") {
		if strings.Contains(line, "gone") {
			e.mustCLI("hub", "token", "revoke", "--dir", e.hubDir, strings.Fields(line)[0])
		}
	}
	expect(t, e.transcribe("", clip(1), ""), http.StatusUnauthorized, "no token")
	expect(t, e.transcribe(revoked, clip(1), ""), http.StatusUnauthorized, "revoked")
	expect(t, e.transcribe(reader, clip(1), ""), http.StatusForbidden, "reader")
	expect(t, e.get(reader, "/v1/transcribe"), http.StatusNoContent, "a reader may still ask whether there is one")
	if s.calls.Load() != 0 {
		t.Fatal("the transcriber was reached without a writer")
	}
	r := e.transcribe(writer, clip(1), "")
	expect(t, r, http.StatusOK, "writer")
	if strings.TrimSpace(r.body) != `{"text":"run the tests again"}` {
		t.Fatalf("answer: %s", r.body)
	}
	r = e.transcribe(writer, clip(1), "text/plain")
	expect(t, r, http.StatusTooManyRequests, "a second clip within five seconds")
	time.Sleep(5100 * time.Millisecond)
	r = e.transcribe(writer, clip(1), "text/plain")
	expect(t, r, http.StatusOK, "text mode")
	if r.body != "run the tests again\n" {
		t.Fatalf("text mode: %q", r.body)
	}
	logs, _ := os.ReadFile(filepath.Join(e.logs, "hub.log"))
	if !strings.Contains(string(logs), "audit transcribe") || strings.Contains(string(logs), "run the tests again") {
		t.Fatalf("hub log: %s", logs)
	}
}

func TestSec21_TranscribeRefusesBadClips(t *testing.T) {
	e, s := sttEnv(t)
	writer := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	expect(t, e.transcribe(writer, make([]byte, 5<<20), ""), http.StatusRequestEntityTooLarge, "5 MiB")
	expect(t, e.transcribe(writer, []byte(strings.Repeat("x", 1000)), ""), http.StatusBadRequest, "not a wav")
	expect(t, e.transcribe(writer, clip(0.2), ""), http.StatusBadRequest, "0.2 s")
	stereo := clip(1)
	binary.LittleEndian.PutUint16(stereo[22:24], 2)
	expect(t, e.transcribe(writer, stereo, ""), http.StatusBadRequest, "stereo")
	expect(t, e.transcribe(writer, nil, ""), http.StatusBadRequest, "empty")
	if s.calls.Load() != 0 {
		t.Fatal("a bad clip reached the transcriber")
	}
}

func TestSec22_TranscriberMisbehaves(t *testing.T) {
	e, s := sttEnv(t)
	writer := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	cases := []struct {
		name   string
		answer func(w http.ResponseWriter)
		status int
		body   string
	}{
		{"control characters", func(w http.ResponseWriter) {
			json.NewEncoder(w).Encode(map[string]string{"text": "run\x1b[31m the\x00 tests\n\n again"})
		}, http.StatusOK, `{"text":"run [31m the tests again"}`},
		{"ten kilobytes of text", func(w http.ResponseWriter) {
			json.NewEncoder(w).Encode(map[string]string{"text": strings.Repeat("a", 10<<10)})
		}, http.StatusOK, ""},
		{"a megabyte of text", func(w http.ResponseWriter) {
			json.NewEncoder(w).Encode(map[string]string{"text": strings.Repeat("a", 1<<20)})
		}, http.StatusBadGateway, `{"error":"provider_unavailable"}`},
		{"no JSON", func(w http.ResponseWriter) { w.Write([]byte("<html>")) }, http.StatusBadGateway, `{"error":"provider_unavailable"}`},
		{"500", func(w http.ResponseWriter) { w.WriteHeader(500) }, http.StatusBadGateway, `{"error":"provider_unavailable"}`},
	}
	for i, c := range cases {
		if i > 0 {
			time.Sleep(5100 * time.Millisecond)
		}
		s.answer = c.answer
		r := e.transcribe(writer, clip(1), "")
		expect(t, r, c.status, c.name)
		if c.body != "" && strings.TrimSpace(r.body) != c.body {
			t.Fatalf("%s: %s", c.name, r.body)
		}
		if c.name == "ten kilobytes of text" && (len(r.body) > 4200 || len(r.body) < 4000) {
			t.Fatalf("long text not cut: %d bytes", len(r.body))
		}
	}
	expect(t, e.get(writer, "/v1/panes"), http.StatusOK, "the hub is still up")
}

func TestSec24_NoTranscriberNoEndpoint(t *testing.T) {
	e, _, _ := basic(t)
	writer := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	expect(t, e.get(writer, "/v1/transcribe"), http.StatusNotFound, "probe")
	expect(t, e.transcribe(writer, clip(1), ""), http.StatusNotFound, "post")
	logs, _ := os.ReadFile(filepath.Join(e.logs, "hub.log"))
	if strings.Contains(string(logs), "transcribe") {
		t.Fatal("something was logged")
	}
}
