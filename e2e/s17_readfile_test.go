//go:build e2e

package e2e

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// A file of the inbox read back by name, by a reader of the pane.

// pathOf uploads a PNG as the full token and answers the path the agent gave it.
func pathOf(t *testing.T, e *env, tok string, typ string, data []byte) string {
	t.Helper()
	r := e.sendFile(tok, shell0, "shot.png", typ, data)
	expect(t, r, http.StatusCreated, "upload")
	var out struct{ Path string }
	json.Unmarshal([]byte(r.body), &out)
	return out.Path
}

// 130
func TestSec130_ReadingAFileNeedsAReadGrant(t *testing.T) {
	e, _, _ := filesEnv(t, "--inbox", "default")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	reader := e.token("reader", []string{host + "/*"}, nil)
	other := e.token("other", []string{"elsewhere/*"}, nil)
	name := filepath.Base(pathOf(t, e, full, "image/png", png2))
	expect(t, e.get("", "/v1/panes/"+shell0+"/files/"+name), http.StatusUnauthorized, "no token")
	expect(t, e.get(other, "/v1/panes/"+shell0+"/files/"+name), http.StatusNotFound, "no grant on the host")
	r := e.get(reader, "/v1/panes/"+shell0+"/files/"+name)
	expect(t, r, http.StatusOK, "read grant")
	if r.body != string(png2) {
		t.Fatal("the bytes differ")
	}
	expect(t, e.get(reader, "/v1/panes/"+host+"/work/0.1/files/"+name), http.StatusOK, "a read-only pane of the host")
	expect(t, e.get(reader, "/v1/panes/"+host+"/work/7.0/files/"+name), http.StatusNotFound, "no such pane")
}

// 131
func TestSec131_OnlyAnInboxNameIsLookedAt(t *testing.T) {
	e, a, inbox := filesEnv(t, "--inbox", "default")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	pathOf(t, e, full, "image/png", png2)
	for _, name := range []string{
		"..%2Fagent.key", "..%2F..%2Fagent.key", "agent.key", "20261025-102235-56fwge.png.exe",
		"20261025-102235-56fwge.PNG", "20261025-102235-56fwge.svg", strings.Repeat("a", 300) + ".png",
		"%2Fetc%2Fpasswd", "20261025-102235-56fwge.png%00",
	} {
		expect(t, e.get(full, "/v1/panes/"+shell0+"/files/"+name), http.StatusBadRequest, name)
	}
	raw, _ := os.ReadFile(filepath.Join(e.logs, "agent-"+host+".log"))
	if strings.Contains(string(raw), "op=read-file") {
		t.Fatal("a bad name reached the agent")
	}
	// A well-formed name that is not there, and a symlink of the right shape.
	expect(t, e.get(full, "/v1/panes/"+shell0+"/files/20261025-102235-56fwge.png"), http.StatusNotFound, "absent")
	link := filepath.Join(inbox, "20261025-102235-linkyy.png")
	if err := os.Symlink(filepath.Join(a.dir, "agent.key"), link); err != nil {
		t.Fatal(err)
	}
	expect(t, e.get(full, "/v1/panes/"+shell0+"/files/20261025-102235-linkyy.png"), http.StatusNotFound, "symlink")
	os.WriteFile(filepath.Join(inbox, "20261025-102235-dirrrr.png"), nil, 0o600)
	os.Remove(filepath.Join(inbox, "20261025-102235-dirrrr.png"))
	os.Mkdir(filepath.Join(inbox, "20261025-102235-dirrrr.png"), 0o700)
	expect(t, e.get(full, "/v1/panes/"+shell0+"/files/20261025-102235-dirrrr.png"), http.StatusNotFound, "directory")
}

// 132
func TestSec132_NoInboxNothingToRead(t *testing.T) {
	e, _, _ := filesEnv(t)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	expect(t, e.get(full, "/v1/panes/"+shell0+"/files/20261025-102235-56fwge.png"), http.StatusNotFound, "no inbox")
}

// 133
func TestSec133_ReadsAreRateLimited(t *testing.T) {
	e, _, _ := filesEnv(t, "--inbox", "default")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	name := filepath.Base(pathOf(t, e, full, "image/png", png2))
	for i := 0; i < 3; i++ {
		expect(t, e.get(full, "/v1/panes/"+shell0+"/files/"+name), http.StatusOK, "within the burst")
	}
	expect(t, e.get(full, "/v1/panes/"+shell0+"/files/"+name), http.StatusTooManyRequests, "the fourth")
	time.Sleep(1100 * time.Millisecond)
	expect(t, e.get(full, "/v1/panes/"+shell0+"/files/"+name), http.StatusOK, "a second later")
}

// 134
func TestSec134_ReadsAreAuditedWithoutContent(t *testing.T) {
	e, _, _ := filesEnv(t, "--inbox", "default")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	secret := "mxt_" + strings.Repeat("Q7", 20)
	remember(secret)
	name := filepath.Base(pathOf(t, e, full, "text/plain", []byte("the token is "+secret+"\n")))
	r := e.get(full, "/v1/panes/"+shell0+"/files/"+name)
	expect(t, r, http.StatusOK, "read")
	for _, f := range []string{"hub.log", "agent-" + host + ".log"} {
		raw, _ := os.ReadFile(filepath.Join(e.logs, f))
		s := string(raw)
		if !strings.Contains(s, "read-file") || !strings.Contains(s, "name="+name) || !strings.Contains(s, "bytes=") {
			t.Fatalf("%s has no audit line with the name and size", f)
		}
		if strings.Contains(s, secret) {
			t.Fatalf("%s holds the file's content", f)
		}
	}
}

// 135
func TestFlow135_AFileComesBackAsWhatItIs(t *testing.T) {
	e, _, _ := filesEnv(t, "--inbox", "default")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	name := filepath.Base(pathOf(t, e, full, "image/png", png2))
	r := e.get(full, "/v1/panes/"+shell0+"/files/"+name)
	expect(t, r, http.StatusOK, "png")
	for k, v := range map[string]string{
		"Content-Type":           "image/png",
		"Content-Disposition":    "inline",
		"X-Content-Type-Options": "nosniff",
		"Cache-Control":          "private, no-store",
	} {
		if got := r.header.Get(k); got != v {
			t.Fatalf("%s: %q, want %q", k, got, v)
		}
	}
	if r.body != string(png2) {
		t.Fatal("the bytes differ")
	}
	time.Sleep(2100 * time.Millisecond)
	name = filepath.Base(pathOf(t, e, full, "application/json", []byte(`{"html": "<script>alert(1)</script>"}`)))
	r = e.get(full, "/v1/panes/"+shell0+"/files/"+name)
	expect(t, r, http.StatusOK, "json")
	if got := r.header.Get("Content-Type"); got != "text/plain; charset=utf-8" {
		t.Fatalf("json served as %q", got)
	}
}
