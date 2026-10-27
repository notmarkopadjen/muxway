//go:build e2e

package e2e

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The changes window's data: git's status of the pane's repository and
// one change's diff, for a writer, when the repository lies under a
// preview root. The agent runs git, read-only, and nothing of the
// repository's own.

// gitRepo makes dir a repository with alice as its author, commits what
// is there, and leaves one change of each kind: src/a.go modified,
// src/gone.go deleted, src/new.go staged, notes.txt untracked, src/old.go
// renamed to src/moved.go and staged, and a few names that need care.
func gitRepo(t *testing.T, dir string) {
	t.Helper()
	write := func(p, s string) {
		os.MkdirAll(filepath.Dir(filepath.Join(dir, p)), 0o700)
		os.WriteFile(filepath.Join(dir, p), []byte(s), 0o600)
	}
	write("src/a.go", "package a\n")
	write("src/gone.go", "package gone\n")
	write("src/old.go", "package old\n")
	write("src/same.go", "package same\n")
	write("src/pic.png", string(png2))
	git(t, dir, "init", "-q", "-b", "main")
	git(t, dir, "add", ".")
	git(t, dir, "commit", "-q", "-m", "first")
	git(t, dir, "commit", "-q", "--allow-empty", "-m", "second")
	write("src/a.go", "package a\n\nfunc A() {}\n")
	os.Remove(filepath.Join(dir, "src", "gone.go"))
	write("src/new.go", "package new\n")
	write("notes.txt", "loose\n")
	write("-rf", "dash\n")
	write("with space.txt", "space\n")
	write("quo\"te\n.txt", "quote\n")
	write("ünï.txt", "utf8\n")
	os.Rename(filepath.Join(dir, "src", "old.go"), filepath.Join(dir, "src", "moved.go"))
	git(t, dir, "add", "src/new.go", "src/old.go", "src/moved.go")
}

func git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=alice", "GIT_AUTHOR_EMAIL=alice@example.com",
		"GIT_COMMITTER_NAME=alice", "GIT_COMMITTER_EMAIL=alice@example.com",
		"GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_NOSYSTEM=1")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return string(out)
}

// changesEnv starts an agent with the work root, a repository in it, a
// repository outside it, and a plain directory; the writable pane's
// shell starts in the repository's src.
func changesEnv(t *testing.T, withRoot bool) (*env, *tmuxServer, string, string) {
	t.Helper()
	base := t.TempDir()
	root := filepath.Join(base, "work")
	repo := filepath.Join(root, "repo")
	outside := filepath.Join(base, "elsewhere", "repo")
	os.MkdirAll(filepath.Join(repo, "src"), 0o700)
	os.MkdirAll(outside, 0o700)
	os.MkdirAll(filepath.Join(root, "plain"), 0o700)
	gitRepo(t, repo)
	gitRepo(t, outside)
	var args []string
	if withRoot {
		args = []string{"--preview", root}
	}
	e := newEnv(t)
	ts := newTmux(t)
	e.pairAgent(host, ts, args...)
	ts.split("work:0.0")
	e.expose(ts, "work:0.0", "--write")
	e.expose(ts, "work:0.1")
	cdTo(t, ts, "work:0.0", filepath.Join(repo, "src"))
	return e, ts, root, base
}

func cdTo(t *testing.T, ts *tmuxServer, target, dir string) {
	t.Helper()
	ts.must("send-keys", "-t", target, "cd "+dir, "Enter")
	waitFor(t, "the shell in "+dir, func() bool {
		return strings.TrimSpace(ts.must("display-message", "-p", "-t", target, "#{pane_current_path}")) == dir
	})
}

func (e *env) changes(tok, pane string) resp { return e.get(tok, "/v1/panes/"+pane+"/git") }
func (e *env) diff(tok, pane, path string) resp {
	return e.get(tok, "/v1/panes/"+pane+"/git/diff?path="+url.QueryEscape(path))
}

type changesBody struct {
	Root, Branch  string
	Ahead, Behind int
	Truncated     bool
	Entries       []struct {
		Path, From, Kind string
		Staged           bool
	}
}

func parseChanges(t *testing.T, r resp) changesBody {
	t.Helper()
	var c changesBody
	if err := json.Unmarshal([]byte(r.body), &c); err != nil {
		t.Fatalf("%v: %s", err, r.body)
	}
	return c
}

// 160
func TestSec160_ChangesNeedRootsAWriterAndARepositoryUnderThem(t *testing.T) {
	e, _, _, _ := changesEnv(t, false)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	expect(t, e.changes(full, shell0), http.StatusNotFound, "no roots")
	expect(t, e.diff(full, shell0, "src/a.go"), http.StatusNotFound, "no roots, diff")
	raw, _ := os.ReadFile(filepath.Join(e.logs, "hub.log"))
	if !strings.Contains(string(raw), "result=no_roots") {
		t.Fatal("the hub asked the host, or did not audit")
	}

	e2, ts, root, base := changesEnv(t, true)
	full = e2.token("full", []string{host + "/*"}, []string{host + "/*"})
	reader := e2.token("reader", []string{host + "/*"}, nil)
	expect(t, e2.changes("", shell0), http.StatusUnauthorized, "no token")
	expect(t, e2.changes(reader, shell0), http.StatusForbidden, "read-only token")
	expect(t, e2.changes(full, host+"/work/0.1"), http.StatusForbidden, "read-only pane")
	expect(t, e2.changes(full, host+"/work/7.0"), http.StatusNotFound, "no such pane")
	expect(t, e2.diff(reader, shell0, "src/a.go"), http.StatusForbidden, "read-only token, diff")
	expect(t, e2.changes(full, shell0), http.StatusOK, "a writer in a repository under the root")
	// Outside the root, and in no repository: the one code.
	time.Sleep(1100 * time.Millisecond)
	cdTo(t, ts, "work:0.0", filepath.Join(base, "elsewhere", "repo"))
	r := e2.changes(full, shell0)
	expect(t, r, http.StatusNotFound, "a repository outside the root")
	if !strings.Contains(r.body, "not_found") {
		t.Fatal(r.body)
	}
	time.Sleep(1100 * time.Millisecond)
	cdTo(t, ts, "work:0.0", filepath.Join(root, "plain"))
	expect(t, e2.changes(full, shell0), http.StatusNotFound, "no repository")
	raw, _ = os.ReadFile(filepath.Join(e2.logs, "agent-"+host+".log"))
	if !strings.Contains(string(raw), "op=git-status") || !strings.Contains(string(raw), "result=no_file") {
		t.Fatal("the agent did not audit its refusals")
	}
}

// 161
func TestSec161_OnlyAListedChangeIsDiffed(t *testing.T) {
	e, _, _, _ := changesEnv(t, true)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	for _, path := range []string{"../x", "/etc/passwd", "src/same.go", "notes.txt", "-rf", "src", "nothere.go", "~/x"} {
		r := e.diff(full, shell0, path)
		expect(t, r, http.StatusNotFound, path)
		if !strings.Contains(r.body, "not_found") {
			t.Fatalf("%s: %s", path, r.body)
		}
		time.Sleep(520 * time.Millisecond)
	}
	for _, path := range []string{"", "quo\"te\n.txt", "a\x00.go", strings.Repeat("a/", 600) + "a.go"} {
		expect(t, e.diff(full, shell0, path), http.StatusBadRequest, path)
	}
	raw, _ := os.ReadFile(filepath.Join(e.logs, "agent-"+host+".log"))
	if strings.Contains(string(raw), "root:") || strings.Contains(string(raw), "loose") {
		t.Fatal("content in the log")
	}
}

// 162
func TestSec162_NamesThatNeedCareAreNames(t *testing.T) {
	e, _, _, _ := changesEnv(t, true)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	c := parseChanges(t, e.changes(full, shell0))
	kinds := map[string]string{}
	for _, en := range c.Entries {
		kinds[en.Path] = en.Kind
	}
	for _, name := range []string{"-rf", "with space.txt", "quo\"te\n.txt", "ünï.txt"} {
		if kinds[name] != "untracked" {
			t.Fatalf("%q: %q in %v", name, kinds[name], kinds)
		}
	}
	// A dash is a path after --: the diff of a tracked one is its diff.
	root := c.Root
	git(t, root, "add", "--", "-rf", "with space.txt")
	time.Sleep(1100 * time.Millisecond)
	for _, name := range []string{"-rf", "with space.txt"} {
		r := e.diff(full, shell0, name)
		expect(t, r, http.StatusOK, name)
		var d struct{ Diff string }
		json.Unmarshal([]byte(r.body), &d)
		if !strings.Contains(d.Diff, "+"+strings.TrimSuffix(string(mustRead(t, filepath.Join(root, name))), "\n")) {
			t.Fatalf("%q: %s", name, d.Diff)
		}
	}
}

func mustRead(t *testing.T, p string) []byte {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// 163
func TestSec163_GitWritesNothingAndRunsNothingOfTheRepository(t *testing.T) {
	e, _, root, _ := changesEnv(t, true)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	repo := filepath.Join(root, "repo")
	mark := filepath.Join(root, "ran")
	hook := "#!/bin/sh\ntouch " + mark + "\n"
	for _, h := range []string{"pre-commit", "post-index-change", "fsmonitor-watchman"} {
		os.WriteFile(filepath.Join(repo, ".git", "hooks", h), []byte(hook), 0o700)
	}
	script := filepath.Join(repo, "script.sh")
	os.WriteFile(script, []byte(hook), 0o700)
	os.WriteFile(filepath.Join(repo, ".gitattributes"), []byte("*.go diff=run\n"), 0o600)
	os.WriteFile(filepath.Join(repo, ".git", "config"), []byte("[core]\n\trepositoryformatversion = 0\n\tfsmonitor = "+script+"\n[diff \"run\"]\n\tcommand = "+script+"\n\ttextconv = "+script+"\n[pager]\n\tdiff = "+script+"\n[alias]\n\tstatus = !"+script+"\n\tdiff = !"+script+"\n"), 0o600)
	index, _ := os.Stat(filepath.Join(repo, ".git", "index"))
	expect(t, e.changes(full, shell0), http.StatusOK, "status")
	r := e.diff(full, shell0, "src/a.go")
	expect(t, r, http.StatusOK, "diff")
	if !strings.Contains(r.body, "+func A() {}") {
		t.Fatal(r.body)
	}
	if _, err := os.Stat(mark); err == nil {
		t.Fatal("a program of the repository ran")
	}
	after, _ := os.Stat(filepath.Join(repo, ".git", "index"))
	if index == nil || after == nil || !index.ModTime().Equal(after.ModTime()) || index.Size() != after.Size() {
		t.Fatal("the index was written")
	}
	if _, err := os.Stat(filepath.Join(repo, ".git", "index.lock")); err == nil {
		t.Fatal("index.lock left")
	}
	if string(mustRead(t, filepath.Join(repo, "src", "a.go"))) != "package a\n\nfunc A() {}\n" {
		t.Fatal("the working tree changed")
	}
}

// 164
func TestSec164_ChangesAreRateLimitedAndAudited(t *testing.T) {
	e, _, _, _ := changesEnv(t, true)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	for i := 0; i < 6; i++ {
		expect(t, e.changes(full, shell0), http.StatusOK, "within the burst")
	}
	expect(t, e.changes(full, shell0), http.StatusTooManyRequests, "the seventh status")
	for i := 0; i < 5; i++ {
		expect(t, e.diff(full, shell0, "src/a.go"), http.StatusOK, "within the burst")
	}
	expect(t, e.diff(full, shell0, "src/a.go"), http.StatusTooManyRequests, "the sixth diff")
	for _, f := range []string{"hub.log", "agent-" + host + ".log"} {
		s := string(mustRead(t, filepath.Join(e.logs, f)))
		if !strings.Contains(s, "path=src/a.go") || !strings.Contains(s, "bytes=") || !strings.Contains(s, "entries=") {
			t.Fatalf("%s lacks the path, the size or the count", f)
		}
		if strings.Contains(s, "func A()") || strings.Contains(s, "package a") {
			t.Fatalf("%s holds the diff's content", f)
		}
	}
}

// 165
func TestFlow165_EveryKindOfChangeAndTheBranch(t *testing.T) {
	e, _, root, _ := changesEnv(t, true)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	repo := filepath.Join(root, "repo")
	// A commit ahead of an upstream.
	git(t, repo, "branch", "base", "main~1")
	git(t, repo, "branch", "--set-upstream-to=base", "main")
	r := e.changes(full, shell0)
	expect(t, r, http.StatusOK, "status")
	if r.header.Get("Cache-Control") != "private, no-store" {
		t.Fatal(r.header)
	}
	c := parseChanges(t, r)
	if c.Root != repo || c.Branch != "main" || c.Ahead != 1 || c.Behind != 0 || c.Truncated {
		t.Fatalf("%+v", c)
	}
	want := map[string][2]string{
		"src/a.go": {"modified", ""}, "src/gone.go": {"deleted", ""}, "src/new.go": {"added", "staged"},
		"src/moved.go": {"renamed", "staged"}, "notes.txt": {"untracked", ""},
	}
	for _, en := range c.Entries {
		w, ok := want[en.Path]
		if !ok {
			continue
		}
		if en.Kind != w[0] || en.Staged != (w[1] == "staged") {
			t.Fatalf("%s: %+v", en.Path, en)
		}
		if en.Path == "src/moved.go" && en.From != "src/old.go" {
			t.Fatalf("rename from %q", en.From)
		}
		delete(want, en.Path)
	}
	if len(want) > 0 {
		t.Fatalf("not listed: %v", want)
	}
	for path, has := range map[string]string{
		"src/a.go": "+func A() {}", "src/gone.go": "-package gone", "src/new.go": "+package new", "src/moved.go": "rename from src/old.go",
	} {
		r := e.diff(full, shell0, path)
		expect(t, r, http.StatusOK, path)
		var d struct {
			Diff   string
			Binary bool
		}
		json.Unmarshal([]byte(r.body), &d)
		if !strings.Contains(d.Diff, has) || d.Binary {
			t.Fatalf("%s: %+v", path, d)
		}
		time.Sleep(520 * time.Millisecond)
	}
}

// 166
func TestFlow166_ABinaryDiffAndALongOne(t *testing.T) {
	e, _, root, _ := changesEnv(t, true)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	repo := filepath.Join(root, "repo")
	os.WriteFile(filepath.Join(repo, "src", "pic.png"), append(png2, 1, 2, 3), 0o600)
	os.WriteFile(filepath.Join(repo, "src", "same.go"), []byte(strings.Repeat("a line of some length to fill the diff\n", 40000)), 0o600)
	r := e.diff(full, shell0, "src/pic.png")
	expect(t, r, http.StatusOK, "binary")
	var d struct {
		Diff   string
		Binary bool
		Cut    bool
	}
	json.Unmarshal([]byte(r.body), &d)
	if !d.Binary || d.Cut {
		t.Fatalf("%+v", d)
	}
	r = e.diff(full, shell0, "src/same.go")
	expect(t, r, http.StatusOK, "long")
	d = struct {
		Diff   string
		Binary bool
		Cut    bool
	}{}
	json.Unmarshal([]byte(r.body), &d)
	if !d.Cut || len(d.Diff) != 1<<20 || d.Binary {
		t.Fatalf("cut %v, %d bytes", d.Cut, len(d.Diff))
	}
}
