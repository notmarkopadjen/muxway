//go:build e2e

package e2e

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Files for a pane's program: written into the agent's inbox, where its
// owner enabled one, under a name the agent chooses.

var (
	png2      = []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x02\x00\x00\x00\x02\x08\x06\x00\x00\x00r\xb6\r$\x00\x00\x00\x16IDATx\x9cc\xf8\xcf\xc0\xf0\x9f\x81\xe1?\x03\xc3\x7f\x06\x00\x1a\xf6\x05\xfd\x95\x8b\xd8\x1d\x00\x00\x00\x00IEND\xaeB`\x82")
	inboxName = regexp.MustCompile(`^\d{8}-\d{6}-[a-z0-9]{6}\.(png|txt|json|pdf|zip)$`)
	// The smallest archive: one empty file, stored.
	zip2 = []byte("PK\x03\x04\x0a\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x01\x00\x00\x00aPK\x01\x02\x0a\x00\x0a\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00aPK\x05\x06\x00\x00\x00\x00\x01\x00\x01\x00\x2f\x00\x00\x00\x1f\x00\x00\x00\x00\x00")
)

func filesEnv(t *testing.T, agentArgs ...string) (*env, *agentProc, string) {
	e := newEnv(t)
	ts := newTmux(t)
	a := e.pairAgent(host, ts, agentArgs...)
	ts.split("work:0.0")
	e.expose(ts, "work:0.0", "--write")
	e.expose(ts, "work:0.1")
	return e, a, filepath.Join(a.dir, "inbox")
}

// sendFile posts one file part; name is what the client calls it.
func (e *env) sendFile(tok, pane, name, typ string, data []byte) resp {
	e.t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	h := textproto.MIMEHeader{}
	h.Set("Content-Disposition", `form-data; name="file"; filename="`+strings.ReplaceAll(name, `"`, `\"`)+`"`)
	h.Set("Content-Type", typ)
	p, _ := mw.CreatePart(h)
	p.Write(data)
	mw.Close()
	return e.do("POST", tok, "/v1/panes/"+pane+"/files", "", body.String(), "Content-Type", mw.FormDataContentType())
}

func inboxFiles(t *testing.T, dir string) []os.DirEntry {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	return entries
}

// 114
func TestSec114_FilesNeedAWriteGrantAndAWritablePane(t *testing.T) {
	e, _, inbox := filesEnv(t, "--inbox", "default")
	reader := e.token("reader", []string{host + "/*"}, nil)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	expect(t, e.sendFile("", shell0, "a.png", "image/png", png2), http.StatusUnauthorized, "no token")
	expect(t, e.sendFile(reader, shell0, "a.png", "image/png", png2), http.StatusForbidden, "read-only token")
	expect(t, e.get(reader, "/v1/panes/"+shell0+"/files"), http.StatusForbidden, "probe, read-only token")
	expect(t, e.sendFile(full, host+"/work/0.1", "a.png", "image/png", png2), http.StatusForbidden, "read-only pane")
	expect(t, e.sendFile(full, host+"/work/7.0", "a.png", "image/png", png2), http.StatusNotFound, "no such pane")
	if n := len(inboxFiles(t, inbox)); n != 0 {
		t.Fatalf("%d files written", n)
	}
	expect(t, e.get(full, "/v1/panes/"+shell0+"/files"), http.StatusNoContent, "probe")
}

// 115
func TestSec115_NoInboxNoFiles(t *testing.T) {
	e, a, _ := filesEnv(t)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	expect(t, e.get(full, "/v1/panes/"+shell0+"/files"), http.StatusNotFound, "probe")
	expect(t, e.sendFile(full, shell0, "a.png", "image/png", png2), http.StatusNotFound, "send")
	if _, err := os.Stat(filepath.Join(a.dir, "inbox")); !os.IsNotExist(err) {
		t.Fatal("an inbox exists without --inbox")
	}
}

// 116
func TestSec116_AFileMustBeWhatItsTypeSays(t *testing.T) {
	e, _, inbox := filesEnv(t, "--inbox", "default")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	for _, c := range []struct{ typ, data string }{
		{"image/png", "\x7fELF\x02\x01\x01\x00 a binary"},
		{"text/plain", "red\x1b[31m text"},
		{"application/json", `{"a": `},
		{"image/svg+xml", "<svg onload=alert(1)/>"},
		{"application/x-sh", "#!/bin/sh\nrm -rf /\n"},
		{"text/html", "<script>alert(1)</script>"},
		{"application/zip", "\x7fELF\x02\x01\x01\x00 not an archive"},
		{"application/zip", string(png2)},
	} {
		r := e.sendFile(full, shell0, "x", c.typ, []byte(c.data))
		expect(t, r, http.StatusUnsupportedMediaType, c.typ)
		if !strings.Contains(r.body, "unsupported") {
			t.Fatalf("%s: %s", c.typ, r.body)
		}
	}
	expect(t, e.do("POST", full, "/v1/panes/"+shell0+"/files", "", "plain", "Content-Type", "text/plain"), http.StatusBadRequest, "not multipart")
	if n := len(inboxFiles(t, inbox)); n != 0 {
		t.Fatalf("%d files written", n)
	}
	// An archive that is one is kept as it is, named .zip whatever the client called it.
	r := e.sendFile(full, shell0, "tool.exe", "application/zip", zip2)
	expect(t, r, http.StatusCreated, "zip")
	if !strings.HasSuffix(r.body, `.zip", "bytes": `+strconv.Itoa(len(zip2))+`}`) && !strings.Contains(r.body, `.zip"`) {
		t.Fatalf("zip: %s", r.body)
	}
	entries := inboxFiles(t, inbox)
	if len(entries) != 1 || !strings.HasSuffix(entries[0].Name(), ".zip") {
		t.Fatalf("zip written as %v", entries)
	}
	data, _ := os.ReadFile(filepath.Join(inbox, entries[0].Name()))
	if !bytes.Equal(data, zip2) {
		t.Fatal("the archive was changed")
	}
}

// 117
func TestSec117_EightMiBAtMost(t *testing.T) {
	e, _, inbox := filesEnv(t, "--inbox", "default")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	big := bytes.Repeat([]byte("a"), 8<<20+1)
	expect(t, e.sendFile(full, shell0, "big.txt", "text/plain", big), http.StatusRequestEntityTooLarge, "8 MiB + 1")
	if n := len(inboxFiles(t, inbox)); n != 0 {
		t.Fatalf("%d files written", n)
	}
	// Exactly 8 MiB goes through, as one message to the agent.
	r := e.sendFile(full, shell0, "fits.txt", "text/plain", big[:8<<20])
	expect(t, r, http.StatusCreated, "8 MiB")
}

// 118
func TestSec118_TheAgentNamesTheFile(t *testing.T) {
	e, _, inbox := filesEnv(t, "--inbox", "default")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	for i, name := range []string{"../../etc/passwd", "a;rm -rf x.png"} {
		if i > 0 {
			time.Sleep(2100 * time.Millisecond)
		}
		r := e.sendFile(full, shell0, name, "image/png", png2)
		expect(t, r, http.StatusCreated, name)
		var out struct {
			Path  string `json:"path"`
			Bytes int    `json:"bytes"`
		}
		json.Unmarshal([]byte(r.body), &out)
		if filepath.Dir(out.Path) != inbox || !inboxName.MatchString(filepath.Base(out.Path)) || out.Bytes != len(png2) {
			t.Fatalf("answer for %q: %s", name, r.body)
		}
		info, err := os.Stat(out.Path)
		if err != nil || info.Mode().Perm() != 0o600 {
			t.Fatalf("%s: %v %v", out.Path, info.Mode(), err)
		}
		raw, _ := os.ReadFile(out.Path)
		if !bytes.Equal(raw, png2) {
			t.Fatal("the file differs from what was sent")
		}
	}
	if n := len(inboxFiles(t, inbox)); n != 2 {
		t.Fatalf("%d files, want 2", n)
	}
	if info, _ := os.Stat(inbox); info.Mode().Perm() != 0o700 {
		t.Fatalf("inbox mode %v", info.Mode())
	}
	if _, err := os.Stat("/etc/passwd.png"); err == nil {
		t.Fatal("a name reached outside the inbox")
	}
}

// 119
func TestSec119_OneFileEveryTwoSeconds(t *testing.T) {
	e, _, _ := filesEnv(t, "--inbox", "default")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	expect(t, e.sendFile(full, shell0, "a.txt", "text/plain", []byte("one")), http.StatusCreated, "first")
	expect(t, e.sendFile(full, shell0, "b.txt", "text/plain", []byte("two")), http.StatusTooManyRequests, "second at once")
	// A refused file costs no slot.
	time.Sleep(2100 * time.Millisecond)
	expect(t, e.sendFile(full, shell0, "c.txt", "text/plain", []byte("\x1b")), http.StatusUnsupportedMediaType, "refused")
	expect(t, e.sendFile(full, shell0, "d.txt", "text/plain", []byte("three")), http.StatusCreated, "after the refusal")
}

// 120
func TestSec120_AFullInboxRefuses(t *testing.T) {
	e, _, inbox := filesEnv(t, "--inbox", "default", "--inbox-max-files", "1")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	expect(t, e.sendFile(full, shell0, "a.txt", "text/plain", []byte("one")), http.StatusCreated, "first")
	time.Sleep(2100 * time.Millisecond)
	r := e.sendFile(full, shell0, "b.txt", "text/plain", []byte("two"))
	expect(t, r, http.StatusInsufficientStorage, "full")
	if !strings.Contains(r.body, "inbox_full") || len(inboxFiles(t, inbox)) != 1 {
		t.Fatalf("full inbox: %s, %d files", r.body, len(inboxFiles(t, inbox)))
	}
}

// 121
func TestSec121_TheLogsHaveSizeAndPathNotContent(t *testing.T) {
	e, _, _ := filesEnv(t, "--inbox", "default")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	secret := "mxt_" + strings.Repeat("Z9", 20)
	remember(secret)
	r := e.sendFile(full, shell0, "notes-"+secret+".txt", "text/plain", []byte("the token is "+secret+"\n"))
	expect(t, r, http.StatusCreated, "text")
	var out struct{ Path string }
	json.Unmarshal([]byte(r.body), &out)
	for _, f := range []string{"hub.log", "agent-" + host + ".log"} {
		raw, _ := os.ReadFile(filepath.Join(e.logs, f))
		s := string(raw)
		if !strings.Contains(s, "file") || !strings.Contains(s, out.Path) || !strings.Contains(s, "bytes=") {
			t.Fatalf("%s has no audit line with size and path", f)
		}
		if strings.Contains(s, secret) || strings.Contains(s, base64.StdEncoding.EncodeToString([]byte("the token is "))) {
			t.Fatalf("%s holds the file's content or its name", f)
		}
	}
}

// 122
func TestFlow122_FilesOlderThanADayAreSweptAtStart(t *testing.T) {
	e := newEnv(t)
	ts := newTmux(t)
	a := e.pairAgent(host, ts, "--inbox", "default")
	inbox := filepath.Join(a.dir, "inbox")
	stop(a.cmd)
	e.waitOnline(host, false)
	old := filepath.Join(inbox, "20261023-090000-oldone.txt")
	fresh := filepath.Join(inbox, "20261025-090000-freshy.txt")
	os.WriteFile(old, []byte("old"), 0o600)
	os.WriteFile(fresh, []byte("new"), 0o600)
	then := time.Now().Add(-25 * time.Hour)
	os.Chtimes(old, then, then)
	e.runAgent(a, ts)
	e.waitOnline(host, true)
	waitFor(t, "the old file swept", func() bool {
		_, err := os.Stat(old)
		return os.IsNotExist(err)
	})
	if _, err := os.Stat(fresh); err != nil {
		t.Fatal("a fresh file was swept")
	}
}
