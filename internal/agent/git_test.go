package agent

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// A repository made here, with alice as its author and one of each kind
// of change.
func makeRepo(t *testing.T, dir string) {
	t.Helper()
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=alice", "GIT_AUTHOR_EMAIL=alice@example.com",
			"GIT_COMMITTER_NAME=alice", "GIT_COMMITTER_EMAIL=alice@example.com",
			"GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_NOSYSTEM=1")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	write := func(p, s string) {
		os.MkdirAll(filepath.Dir(filepath.Join(dir, p)), 0o700)
		os.WriteFile(filepath.Join(dir, p), []byte(s), 0o600)
	}
	run("init", "-q", "-b", "main")
	write("src/a.go", "package a\n")
	write("src/b.go", "package b\n")
	write("src/gone.go", "package gone\n")
	write("src/old.go", "package old\nvar x = 1\nvar y = 2\n")
	write("docs/same.md", "# same\n")
	run("add", ".")
	run("commit", "-q", "-m", "first")
	write("src/a.go", "package a\n\nfunc A() {}\n")
	os.Remove(filepath.Join(dir, "src", "gone.go"))
	write("src/new.go", "package new\n")
	write("notes.txt", "loose\n")
	write("-rf", "dash\n")
	write("with space.txt", "space\n")
	write("quo\"te\n.txt", "quote\n")
	os.Rename(filepath.Join(dir, "src", "old.go"), filepath.Join(dir, "src", "moved.go"))
	run("add", "src/new.go", "src/old.go", "src/moved.go")
}

func TestRepoRoot(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "work")
	os.MkdirAll(filepath.Join(root, "repo", "src"), 0o700)
	os.MkdirAll(filepath.Join(root, ".hidden", "repo"), 0o700)
	os.MkdirAll(filepath.Join(base, "elsewhere", "repo"), 0o700)
	os.MkdirAll(filepath.Join(root, "plain"), 0o700)
	for _, r := range []string{filepath.Join(root, "repo"), filepath.Join(root, ".hidden", "repo"), filepath.Join(base, "elsewhere", "repo")} {
		os.MkdirAll(filepath.Join(r, ".git"), 0o700)
	}
	os.Symlink(filepath.Join(base, "elsewhere", "repo"), filepath.Join(root, "link"))
	roots := []string{root}
	// A root that is itself a repository is shown, from any directory in it.
	self := filepath.Join(base, "self")
	os.MkdirAll(filepath.Join(self, ".git"), 0o700)
	os.MkdirAll(filepath.Join(self, "docs"), 0o700)
	for _, cwd := range []string{self, filepath.Join(self, "docs")} {
		if got, err := repoRoot([]string{self}, cwd); err != nil || got != self {
			t.Fatalf("the root itself from %s: %q %v", cwd, got, err)
		}
	}
	if got, err := repoRoot(roots, filepath.Join(root, "repo", "src")); err != nil || got != filepath.Join(root, "repo") {
		t.Fatalf("from a subdirectory: %q %v", got, err)
	}
	if got, err := repoRoot(roots, filepath.Join(root, "repo")); err != nil || got != filepath.Join(root, "repo") {
		t.Fatalf("from the root: %q %v", got, err)
	}
	for _, cwd := range []string{
		filepath.Join(root, "plain"), filepath.Join(root, "link"), filepath.Join(root, ".hidden", "repo"),
		filepath.Join(base, "elsewhere", "repo"), base, "", "relative", filepath.Join(root, "nothere"),
	} {
		if got, err := repoRoot(roots, cwd); err == nil {
			t.Fatalf("%s: shown as %q", cwd, got)
		}
	}
	if _, err := repoRoot(nil, filepath.Join(root, "repo")); err == nil {
		t.Fatal("no roots, a repository shown")
	}
}

func TestGitStatusAndDiff(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("no git")
	}
	dir := filepath.Join(t.TempDir(), "repo")
	os.MkdirAll(dir, 0o700)
	makeRepo(t, dir)
	ctx := context.Background()
	c, err := gitStatus(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}
	if c.Branch != "main" || c.Root != dir || c.Truncated {
		t.Fatalf("%+v", c)
	}
	got := map[string]string{}
	for _, e := range c.Entries {
		got[e.Path] = e.Kind
		if e.Staged != (e.Path == "src/new.go" || e.Path == "src/moved.go") {
			t.Fatalf("%s staged %v", e.Path, e.Staged)
		}
		if e.Path == "src/moved.go" && e.From != "src/old.go" {
			t.Fatalf("rename from %q", e.From)
		}
	}
	want := map[string]string{
		"src/a.go": "modified", "src/gone.go": "deleted", "src/new.go": "added", "notes.txt": "untracked",
		"-rf": "untracked", "with space.txt": "untracked", "quo\"te\n.txt": "untracked", "src/moved.go": "renamed",
	}
	for p, k := range want {
		if got[p] != k {
			t.Fatalf("%q: %q, want %q (all: %v)", p, got[p], k, got)
		}
	}
	if len(got) != len(want) {
		t.Fatalf("%d entries: %v", len(got), got)
	}
	d, binary, cut, err := gitDiff(ctx, dir, "src/a.go")
	if err != nil || binary || cut || !strings.Contains(d, "+func A() {}") || !strings.Contains(d, "--- a/src/a.go") {
		t.Fatalf("diff: %v %v %v\n%s", err, binary, cut, d)
	}
	d, _, _, err = gitDiff(ctx, dir, "src/gone.go")
	if err != nil || !strings.Contains(d, "-package gone") {
		t.Fatalf("deleted: %v\n%s", err, d)
	}
	d, _, _, err = gitDiff(ctx, dir, "src/new.go")
	if err != nil || !strings.Contains(d, "+package new") {
		t.Fatalf("added: %v\n%s", err, d)
	}
	d, _, _, err = gitDiff(ctx, dir, "src/moved.go")
	if err != nil || !strings.Contains(d, "rename from src/old.go") {
		t.Fatalf("renamed: %v\n%s", err, d)
	}
	for _, p := range []string{"notes.txt", "-rf", "docs/same.md", "../x", "/etc/passwd", "src", "", "nothere"} {
		if d, _, _, err := gitDiff(ctx, dir, p); err == nil {
			t.Fatalf("%q diffed:\n%s", p, d)
		}
	}
	// Binary, and a long diff cut.
	os.WriteFile(filepath.Join(dir, "src", "b.go"), []byte("\x00\x01\x02binary\n"), 0o600)
	if _, binary, _, err := gitDiff(ctx, dir, "src/b.go"); err != nil || !binary {
		t.Fatalf("binary: %v %v", err, binary)
	}
	os.WriteFile(filepath.Join(dir, "docs", "same.md"), []byte(strings.Repeat("a line of some length to fill the diff\n", 40000)), 0o600)
	if d, _, cut, err := gitDiff(ctx, dir, "docs/same.md"); err != nil || !cut || len(d) != 1<<20 {
		t.Fatalf("long: %v %v %d", err, cut, len(d))
	}
	// Nothing was written: no index refresh, no hook, no lock.
	if _, err := os.Stat(filepath.Join(dir, ".git", "index.lock")); err == nil {
		t.Fatal("index.lock left")
	}
}

// A hook that would write, and a configuration that would run a
// program, do nothing for status and diff.
func TestGitRunsNothingOfTheRepository(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("no git")
	}
	dir := filepath.Join(t.TempDir(), "repo")
	os.MkdirAll(dir, 0o700)
	makeRepo(t, dir)
	mark := filepath.Join(t.TempDir(), "ran")
	hook := "#!/bin/sh\ntouch " + mark + "\n"
	for _, h := range []string{"pre-commit", "post-index-change", "post-checkout", "fsmonitor-watchman"} {
		os.WriteFile(filepath.Join(dir, ".git", "hooks", h), []byte(hook), 0o700)
	}
	os.WriteFile(filepath.Join(dir, "script.sh"), []byte(hook), 0o700)
	os.WriteFile(filepath.Join(dir, ".gitattributes"), []byte("*.go diff=run\n"), 0o600)
	os.WriteFile(filepath.Join(dir, ".git", "config"), []byte("[core]\n\trepositoryformatversion = 0\n\tfsmonitor = "+filepath.Join(dir, "script.sh")+"\n[diff \"run\"]\n\tcommand = "+filepath.Join(dir, "script.sh")+"\n\ttextconv = "+filepath.Join(dir, "script.sh")+"\n[pager]\n\tdiff = "+filepath.Join(dir, "script.sh")+"\n[alias]\n\tstatus = !"+filepath.Join(dir, "script.sh")+"\n\tdiff = !"+filepath.Join(dir, "script.sh")+"\n"), 0o600)
	ctx := context.Background()
	if _, err := gitStatus(ctx, dir); err != nil {
		t.Fatal(err)
	}
	if d, _, _, err := gitDiff(ctx, dir, "src/a.go"); err != nil || !strings.Contains(d, "+func A() {}") {
		t.Fatalf("%v\n%s", err, d)
	}
	if _, err := os.Stat(mark); err == nil {
		t.Fatal("a program of the repository ran")
	}
}
