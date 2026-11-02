//go:build e2e

package e2e

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// A writer of a shell pane lists the names in the pane's directory, so a
// client can make the names on the screen links; the host lists only
// what lies under a root, and tells a writer where a shell pane sits.

func (e *env) listing(tok, pane, path string) resp {
	e.t.Helper()
	q := ""
	if path != "" {
		q = "?path=" + url.QueryEscape(path)
	}
	return e.get(tok, "/v1/panes/"+pane+"/dir"+q)
}

type dirListing struct {
	Path      string `json:"path"`
	Truncated bool   `json:"truncated"`
	Entries   []struct {
		Name string `json:"name"`
		Kind string `json:"kind"`
	} `json:"entries"`
}

func (e *env) dirOf(tok, pane, path string) dirListing {
	e.t.Helper()
	r := e.listing(tok, pane, path)
	expect(e.t, r, http.StatusOK, path)
	var l dirListing
	if err := json.Unmarshal([]byte(r.body), &l); err != nil {
		e.t.Fatalf("%s: %v: %s", path, err, r.body)
	}
	return l
}

func (l dirListing) kind(name string) string {
	for _, en := range l.Entries {
		if en.Name == name {
			return en.Kind
		}
	}
	return ""
}

// 184
func TestSec184_ListingNeedsRootsAndAWriter(t *testing.T) {
	e, _, _ := previewEnv(t)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	expect(t, e.listing(full, shell0, ""), http.StatusNotFound, "no roots")
	if strings.Contains(e.get(full, "/v1/hosts").body, `"dir"`) {
		t.Fatal("dir announced without roots")
	}
	if strings.Contains(e.get(full, "/v1/panes").body, `"cwd"`) {
		t.Fatal("a directory said without roots")
	}
	e2, root, _ := previewEnv(t, "ROOT")
	full = e2.token("full", []string{host + "/*"}, []string{host + "/*"})
	reader := e2.token("reader", []string{host + "/*"}, nil)
	if !strings.Contains(e2.get(full, "/v1/hosts").body, `"dir":true`) {
		t.Fatal("dir not announced")
	}
	expect(t, e2.listing("", shell0, ""), http.StatusUnauthorized, "no token")
	expect(t, e2.listing(reader, shell0, ""), http.StatusForbidden, "read-only token")
	expect(t, e2.listing(full, host+"/work/0.1", ""), http.StatusForbidden, "read-only pane")
	expect(t, e2.listing(full, host+"/work/7.0", ""), http.StatusNotFound, "no such pane")
	expect(t, e2.listing(full, shell0, ""), http.StatusOK, "a writer")
	// The directory: the writer's shell pane under the root says it, once
	// (the read-only pane's shell sits outside the root); a reader never
	// hears it.
	docs := filepath.Join(root, "docs")
	body := e2.get(full, "/v1/panes").body
	if strings.Count(body, `"cwd"`) != 1 || !strings.Contains(body, `"cwd":"`+docs+`"`) {
		t.Fatalf("the writer's listing: %s", body)
	}
	if strings.Contains(e2.get(reader, "/v1/panes").body, `"cwd"`) {
		t.Fatal("a reader hears the directory")
	}
	one := e2.get(full, "/v1/panes/"+shell0).body
	if !strings.Contains(one, `"cwd":"`+docs+`"`) {
		t.Fatalf("the pane read: %s", one)
	}
	// A pane whose program is not a shell says nothing, even under a root.
	expect(t, e2.input(full, shell0, map[string]any{"text": "sleep 30"}), http.StatusNoContent, "sleep")
	expect(t, e2.input(full, shell0, map[string]any{"key": "Enter"}), http.StatusNoContent, "enter")
	waitFor(t, "sleep in the pane", func() bool {
		return strings.Contains(e2.get(full, "/v1/panes").body, `"command":"sleep"`)
	})
	if strings.Contains(e2.get(full, "/v1/panes").body, `"cwd"`) {
		t.Fatal("a directory said for a pane that is not a shell")
	}
	expect(t, e2.input(full, shell0, map[string]any{"key": "C-c"}), http.StatusNoContent, "C-c")
	waitFor(t, "the shell back", func() bool {
		return strings.Contains(e2.get(full, "/v1/panes").body, `"cwd":"`+docs+`"`)
	})
	// A shell outside the roots says nothing either.
	expect(t, e2.input(full, shell0, map[string]any{"text": "cd /"}), http.StatusNoContent, "cd")
	expect(t, e2.input(full, shell0, map[string]any{"key": "Enter"}), http.StatusNoContent, "enter")
	waitFor(t, "the shell outside", func() bool {
		return !strings.Contains(e2.get(full, "/v1/panes").body, `"cwd"`)
	})
	time.Sleep(520 * time.Millisecond)
	expect(t, e2.listing(full, shell0, ""), http.StatusNotFound, "outside the roots")
}

// 185
func TestSec185_OnlyADirectoryUnderARootIsListed(t *testing.T) {
	e, root, _ := previewEnv(t, "ROOT")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	docs := filepath.Join(root, "docs")
	os.WriteFile(filepath.Join(docs, "bad\nname"), []byte("x"), 0o600)
	os.WriteFile(filepath.Join(docs, strings.Repeat("n", 300)), []byte("x"), 0o600)
	os.MkdirAll(filepath.Join(root, ".ssh"), 0o700)
	os.Symlink(filepath.Join(root, "..", "elsewhere"), filepath.Join(docs, "out"))
	for _, path := range []string{
		"../../elsewhere", "/etc", "../.git", "../.ssh", "../.github", "plans/a.md", "out", "../link.txt",
		"nothere", "~/notes", "..//..", filepath.Join(root, "..", "elsewhere"),
	} {
		r := e.listing(full, shell0, path)
		expect(t, r, http.StatusNotFound, path)
		if !strings.Contains(r.body, "not_found") {
			t.Fatalf("%s: %s", path, r.body)
		}
		time.Sleep(520 * time.Millisecond)
	}
	for _, path := range []string{"plans\n", "a\x00", strings.Repeat("a/", 600)} {
		expect(t, e.listing(full, shell0, path), http.StatusBadRequest, fmt.Sprintf("%q", path))
	}
	l := e.dirOf(full, shell0, "")
	if l.Path != docs || l.kind("plans") != "dir" || l.kind("shot.png") != "file" || l.kind("out") != "other" {
		t.Fatalf("docs: %+v", l)
	}
	for _, en := range l.Entries {
		if strings.Contains(en.Name, "\n") || len(en.Name) > 255 {
			t.Fatalf("listed: %q", en.Name)
		}
	}
	raw, _ := os.ReadFile(filepath.Join(e.logs, "agent-"+host+".log"))
	s := string(raw)
	if !strings.Contains(s, "op=list-dir") || !strings.Contains(s, "result=no_file") {
		t.Fatal("the agent did not audit its refusals")
	}
	if strings.Contains(s, "shot.png") || strings.Contains(s, "bad") {
		t.Fatal("a name in the log")
	}
}

// 186
func TestSec186_ListingsAreRateLimitedAndAudited(t *testing.T) {
	e, _, _ := previewEnv(t, "ROOT")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	for i := 0; i < 5; i++ {
		expect(t, e.listing(full, shell0, ""), http.StatusOK, "within the burst")
	}
	expect(t, e.listing(full, shell0, ""), http.StatusTooManyRequests, "the sixth")
	for _, f := range []string{"hub.log", "agent-" + host + ".log"} {
		raw, _ := os.ReadFile(filepath.Join(e.logs, f))
		s := string(raw)
		if !strings.Contains(s, "audit dir") && !strings.Contains(s, "op=list-dir") {
			t.Fatalf("%s has no audit line", f)
		}
		if !strings.Contains(s, "entries=") || !strings.Contains(s, "dir=") {
			t.Fatalf("%s lacks the directory or the count", f)
		}
		if strings.Contains(s, "shot.png") {
			t.Fatalf("%s holds a name", f)
		}
	}
}

// 187
func TestFlow187_ListingsResolveFromThePaneWithKinds(t *testing.T) {
	e, root, home := previewEnv(t, "ROOT", "HOME")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	docs := filepath.Join(root, "docs")
	os.Symlink(filepath.Join(docs, "plans"), filepath.Join(docs, "inlink"))
	os.Symlink(filepath.Join(home, "notes"), filepath.Join(docs, "homelink"))
	os.Symlink(filepath.Join(root, "..", "elsewhere"), filepath.Join(docs, "outlink"))
	os.MkdirAll(filepath.Join(docs, "a b"), 0o700)
	many := filepath.Join(root, "many")
	os.MkdirAll(many, 0o700)
	for i := 0; i <= 2000; i++ {
		os.WriteFile(filepath.Join(many, fmt.Sprintf("f%04d", i)), nil, 0o600)
	}
	l := e.dirOf(full, shell0, "")
	want := map[string]string{
		"plans": "dir", "a b": "dir", "inlink": "dir", "homelink": "dir", "outlink": "other",
		"shot.png": "file", "page.html": "file", "tx.py": "file", "a.diff": "file", "a.zip": "file",
	}
	if l.Path != docs || l.Truncated {
		t.Fatalf("docs: %+v", l)
	}
	for n, k := range want {
		if l.kind(n) != k {
			t.Errorf("%s: %q, want %q", n, l.kind(n), k)
		}
	}
	time.Sleep(520 * time.Millisecond)
	if l = e.dirOf(full, shell0, "plans"); l.Path != filepath.Join(docs, "plans") || len(l.Entries) != 1 || l.kind("a.md") != "file" {
		t.Fatalf("plans: %+v", l)
	}
	time.Sleep(520 * time.Millisecond)
	l = e.dirOf(full, shell0, "../")
	if l.Path != root || l.kind("docs") != "dir" || l.kind("run.sh") != "file" || l.kind("link.txt") != "other" ||
		l.kind("Makefile") != "file" || l.kind(".env") != "" || l.kind(".git") != "" || l.kind("key.pem") != "" || l.kind(".github") != "" {
		t.Fatalf("root: %+v", l)
	}
	time.Sleep(520 * time.Millisecond)
	if l = e.dirOf(full, shell0, "~/notes"); l.Path != filepath.Join(home, "notes") || l.kind("todo.txt") != "file" {
		t.Fatalf("home: %+v", l)
	}
	time.Sleep(520 * time.Millisecond)
	if l = e.dirOf(full, shell0, root); l.Path != root {
		t.Fatalf("absolute: %+v", l)
	}
	time.Sleep(520 * time.Millisecond)
	if l = e.dirOf(full, shell0, "../many"); len(l.Entries) != 2000 || !l.Truncated {
		t.Fatalf("many: %d entries, truncated %v", len(l.Entries), l.Truncated)
	}
	time.Sleep(520 * time.Millisecond)
	r := e.listing(full, shell0, "")
	expect(t, r, http.StatusOK, "for the tag")
	etag := r.header.Get("ETag")
	if etag == "" || r.header.Get("Cache-Control") != "private, no-store" {
		t.Fatalf("headers: %v", r.header)
	}
	time.Sleep(520 * time.Millisecond)
	expect(t, e.do("GET", full, "/v1/panes/"+shell0+"/dir", "", "", "If-None-Match", etag), http.StatusNotModified, "unchanged")
	os.WriteFile(filepath.Join(docs, "new.txt"), nil, 0o600)
	time.Sleep(520 * time.Millisecond)
	expect(t, e.do("GET", full, "/v1/panes/"+shell0+"/dir", "", "", "If-None-Match", etag), http.StatusOK, "changed")
}
