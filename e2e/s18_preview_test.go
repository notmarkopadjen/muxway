//go:build e2e

package e2e

import (
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// A file a pane printed the path of, previewed by a writer of the pane,
// under the roots the owner named with --preview.

// previewEnv starts an agent with one or two roots and puts the writable
// pane's shell into the first root's docs directory.
func previewEnv(t *testing.T, roots ...string) (*env, string, string) {
	t.Helper()
	base := t.TempDir()
	root := filepath.Join(base, "work")
	home := filepath.Join(base, "home")
	for _, d := range []string{filepath.Join(root, "docs", "plans"), filepath.Join(root, ".git"), filepath.Join(home, "notes"), filepath.Join(base, "elsewhere")} {
		os.MkdirAll(d, 0o700)
	}
	write := func(p, s string) { os.WriteFile(p, []byte(s), 0o600) }
	write(filepath.Join(root, "docs", "plans", "a.md"), "# plan a\n\nhello\n")
	write(filepath.Join(root, "docs", "shot.png"), string(png2))
	write(filepath.Join(root, "docs", "page.html"), "<script>alert(1)</script>")
	write(filepath.Join(root, "run.sh"), "#!/bin/sh\n")
	write(filepath.Join(root, "key.pem"), "secret")
	write(filepath.Join(root, ".env"), "SECRET=1")
	write(filepath.Join(root, ".git", "config"), "[core]")
	write(filepath.Join(base, "elsewhere", "o.txt"), "outside")
	write(filepath.Join(home, "notes", "todo.txt"), "todo")
	os.Symlink(filepath.Join(base, "elsewhere", "o.txt"), filepath.Join(root, "link.txt"))
	// The agent inherits HOME, so ~ is this one.
	t.Setenv("HOME", home)
	var args []string
	for _, r := range roots {
		args = append(args, "--preview", strings.NewReplacer("ROOT", root, "HOME", home).Replace(r))
	}
	e := newEnv(t)
	ts := newTmux(t)
	e.pairAgent(host, ts, args...)
	ts.split("work:0.0")
	e.expose(ts, "work:0.0", "--write")
	e.expose(ts, "work:0.1")
	ts.must("send-keys", "-t", "work:0.0", "cd "+filepath.Join(root, "docs"), "Enter")
	waitFor(t, "the shell in docs", func() bool {
		return strings.TrimSpace(ts.must("display-message", "-p", "-t", "work:0.0", "#{pane_current_path}")) == filepath.Join(root, "docs")
	})
	return e, root, home
}

func (e *env) preview(tok, pane, path string) resp {
	e.t.Helper()
	return e.get(tok, "/v1/panes/"+pane+"/preview?path="+url.QueryEscape(path))
}

// 140
func TestSec140_PreviewNeedsRootsAndAWriter(t *testing.T) {
	e, _, _ := previewEnv(t)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	expect(t, e.preview(full, shell0, "plans/a.md"), http.StatusNotFound, "no roots")
	if strings.Contains(e.get(full, "/v1/hosts").body, `"preview"`) {
		t.Fatal("preview announced without roots")
	}
	e2, _, _ := previewEnv(t, "ROOT")
	full = e2.token("full", []string{host + "/*"}, []string{host + "/*"})
	reader := e2.token("reader", []string{host + "/*"}, nil)
	if !strings.Contains(e2.get(full, "/v1/hosts").body, `"preview":true`) {
		t.Fatal("preview not announced")
	}
	expect(t, e2.preview("", shell0, "plans/a.md"), http.StatusUnauthorized, "no token")
	expect(t, e2.preview(reader, shell0, "plans/a.md"), http.StatusForbidden, "read-only token")
	expect(t, e2.preview(full, host+"/work/0.1", "plans/a.md"), http.StatusForbidden, "read-only pane")
	expect(t, e2.preview(full, host+"/work/7.0", "plans/a.md"), http.StatusNotFound, "no such pane")
	expect(t, e2.preview(full, shell0, "plans/a.md"), http.StatusOK, "a writer")
}

// 141
func TestSec141_OnlyAFileUnderARootIsServed(t *testing.T) {
	e, root, _ := previewEnv(t, "ROOT")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	for _, path := range []string{
		"../../elsewhere/o.txt", "/etc/passwd", "../link.txt", "../.env", "../.git/config",
		"../key.pem", "plans", "..", "nothere.md", "~/notes/todo.txt", filepath.Join(root, "..", "elsewhere", "o.txt"),
	} {
		r := e.preview(full, shell0, path)
		expect(t, r, http.StatusNotFound, path)
		if !strings.Contains(r.body, "not_found") {
			t.Fatalf("%s: %s", path, r.body)
		}
		time.Sleep(520 * time.Millisecond)
	}
	for _, path := range []string{"", "plans/a.md\n", "a\x00.md", strings.Repeat("a/", 600) + "a.md"} {
		expect(t, e.preview(full, shell0, path), http.StatusBadRequest, fmt.Sprintf("%q", path))
	}
	raw, _ := os.ReadFile(filepath.Join(e.logs, "agent-"+host+".log"))
	if !strings.Contains(string(raw), "op=read-path") || !strings.Contains(string(raw), "result=no_file") {
		t.Fatal("the agent did not audit its refusals")
	}
	if strings.Contains(string(raw), "SECRET=1") || strings.Contains(string(raw), "outside") {
		t.Fatal("content in the log")
	}
}

// 142
func TestSec142_PreviewsAreRateLimitedAndAudited(t *testing.T) {
	e, _, _ := previewEnv(t, "ROOT")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	for i := 0; i < 5; i++ {
		expect(t, e.preview(full, shell0, "plans/a.md"), http.StatusOK, "within the burst")
	}
	expect(t, e.preview(full, shell0, "plans/a.md"), http.StatusTooManyRequests, "the sixth")
	for _, f := range []string{"hub.log", "agent-" + host + ".log"} {
		raw, _ := os.ReadFile(filepath.Join(e.logs, f))
		s := string(raw)
		if !strings.Contains(s, "preview") && !strings.Contains(s, "read-path") {
			t.Fatalf("%s has no audit line", f)
		}
		if !strings.Contains(s, "path=plans/a.md") || !strings.Contains(s, "bytes=") {
			t.Fatalf("%s lacks the path or the size", f)
		}
		if strings.Contains(s, "plan a") {
			t.Fatalf("%s holds the file's content", f)
		}
	}
}

// 143
func TestFlow143_PathsResolveFromThePaneAndHome(t *testing.T) {
	e, root, _ := previewEnv(t, "ROOT", "HOME")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	for _, c := range []struct{ path, typ, body string }{
		{"plans/a.md", "text/plain; charset=utf-8", "# plan a\n\nhello\n"},
		{"./plans/a.md", "text/plain; charset=utf-8", "# plan a\n\nhello\n"},
		{filepath.Join(root, "docs", "plans", "a.md"), "text/plain; charset=utf-8", "# plan a\n\nhello\n"},
		{"shot.png", "image/png", string(png2)},
		{"page.html", "text/plain; charset=utf-8", "<script>alert(1)</script>"},
		{"../run.sh", "text/plain; charset=utf-8", "#!/bin/sh\n"},
		{"~/notes/todo.txt", "text/plain; charset=utf-8", "todo"},
	} {
		r := e.preview(full, shell0, c.path)
		expect(t, r, http.StatusOK, c.path)
		if r.body != c.body || r.header.Get("Content-Type") != c.typ || r.header.Get("X-Content-Type-Options") != "nosniff" {
			t.Fatalf("%s: %q %q", c.path, r.header.Get("Content-Type"), r.body)
		}
		time.Sleep(520 * time.Millisecond)
	}
}
