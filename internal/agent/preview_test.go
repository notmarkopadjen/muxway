package agent

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestResolvePreview(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "work")
	other := filepath.Join(base, "elsewhere")
	home := filepath.Join(base, "home")
	for _, d := range []string{filepath.Join(root, "docs", "plans"), filepath.Join(root, ".git"), other, filepath.Join(home, "notes")} {
		os.MkdirAll(d, 0o700)
	}
	write := func(p, s string) { os.WriteFile(p, []byte(s), 0o600) }
	write(filepath.Join(root, "docs", "plans", "a.md"), "# a\n")
	write(filepath.Join(root, "docs", "shot.PNG"), "png")
	write(filepath.Join(root, "run.sh"), "#!/bin/sh\n")
	write(filepath.Join(root, "key.pem"), "secret")
	write(filepath.Join(root, "id.crt"), "cert")
	write(filepath.Join(root, "a.exe"), "MZ")
	write(filepath.Join(root, "x.env"), "SECRET=1")
	write(filepath.Join(root, "Makefile"), "all:\n")
	write(filepath.Join(root, "Makefile.am"), "all:\n")
	write(filepath.Join(root, "docs", "tx.py"), "x = 1\n")
	write(filepath.Join(root, "docs", "a.diff"), "--- a\n+++ b\n")
	write(filepath.Join(root, "docs", "a.zip"), "PK")
	write(filepath.Join(root, "docs", "README"), "read me")
	os.MkdirAll(filepath.Join(root, ".github", "workflows"), 0o700)
	os.MkdirAll(filepath.Join(root, ".ssh"), 0o700)
	write(filepath.Join(root, ".github", "workflows", "ci.yml"), "on: push\n")
	write(filepath.Join(root, ".ssh", "id_ed25519"), "secret")
	write(filepath.Join(root, "docs", "id_rsa"), "secret")
	write(filepath.Join(root, "docs", ".env.local"), "SECRET=1")
	write(filepath.Join(root, "docs", "credentials.json"), "{}")
	write(filepath.Join(root, "docs", "notes.db"), "sqlite")
	write(filepath.Join(root, ".env"), "SECRET=1")
	write(filepath.Join(root, ".git", "config"), "[core]")
	write(filepath.Join(other, "o.txt"), "outside")
	write(filepath.Join(home, "notes", "todo.txt"), "todo")
	os.Symlink(filepath.Join(other, "o.txt"), filepath.Join(root, "link.txt"))
	os.Symlink(other, filepath.Join(root, "dir"))
	// A root reached through a symlink still counts.
	os.Symlink(root, filepath.Join(base, "work-link"))
	roots := []string{filepath.Join(base, "work-link"), home}
	cwd := filepath.Join(root, "docs")
	good := map[string]string{
		"plans/a.md":                           "text/plain; charset=utf-8",
		"./plans/a.md":                         "text/plain; charset=utf-8",
		"../docs/plans/a.md":                   "text/plain; charset=utf-8",
		filepath.Join(root, "docs/plans/a.md"): "text/plain; charset=utf-8",
		"shot.PNG":                             "image/png",
		"../run.sh":                            "text/plain; charset=utf-8",
		"~/notes/todo.txt":                     "text/plain; charset=utf-8",
		"tx.py":                                "text/plain; charset=utf-8",
		"a.diff":                               "text/plain; charset=utf-8",
		"README":                               "text/plain; charset=utf-8",
		"../Makefile":                          "text/plain; charset=utf-8",
		"a.zip":                                "application/octet-stream",
		"../a.exe":                             "application/octet-stream",
		"../Makefile.am":                       "application/octet-stream",
		"notes.db":                             "application/octet-stream",
	}
	for path, typ := range good {
		file, got, found, err := resolvePreview(roots, false, cwd, home, path)
		if err != nil || got != typ || found != "" || !strings.HasPrefix(file, base) {
			t.Errorf("%s: %v %q %q %q", path, err, got, found, file)
		}
	}
	bad := []string{
		"", "../../elsewhere/o.txt", filepath.Join(other, "o.txt"), "../link.txt", "../dir/o.txt",
		"../.env", "../.git/config", "../key.pem", "../id.crt", "../x.env", "plans", "..", "nothere.md",
		"../.github/workflows/ci.yml", "../.ssh/id_ed25519", "id_rsa", ".env.local", "credentials.json",
		"plans/a.md\n", strings.Repeat("a/", 600) + "a.md", "~/../elsewhere/o.txt", "/etc/passwd",
	}
	for _, path := range bad {
		if file, _, _, err := resolvePreview(roots, false, cwd, home, path); err == nil {
			t.Errorf("%q served as %s", path, file)
		}
	}
	// With hidden allowed, .github opens; the secrets stay shut.
	if _, got, _, err := resolvePreview(roots, true, cwd, home, "../.github/workflows/ci.yml"); err != nil || got != "text/plain; charset=utf-8" {
		t.Errorf("hidden allowed, ci.yml: %v %q", err, got)
	}
	for _, path := range []string{"../.ssh/id_ed25519", "../.git/config", "../.env", ".env.local", "credentials.json", "../key.pem"} {
		if file, _, _, err := resolvePreview(roots, true, cwd, home, path); err == nil {
			t.Errorf("hidden allowed, %q served as %s", path, file)
		}
	}
	if _, _, _, err := resolvePreview(roots, false, "", home, "plans/a.md"); err == nil {
		t.Error("no cwd, served")
	}
	if _, _, _, err := resolvePreview(nil, false, cwd, home, "plans/a.md"); err == nil {
		t.Error("no roots, served")
	}
	big := filepath.Join(root, "docs", "big.log")
	os.WriteFile(big, make([]byte, 8<<20+1), 0o600)
	if _, _, _, err := resolvePreview(roots, false, cwd, home, "big.log"); err == nil {
		t.Error("9 MiB served")
	}
}

// repo makes a repository at dir with n linked worktrees beside it, as
// git lays them out: .git/worktrees/<name>/gitdir in the main checkout,
// a .git file in each worktree. No git is run.
func repo(t *testing.T, dir string, names ...string) []string {
	t.Helper()
	os.MkdirAll(filepath.Join(dir, ".git", "worktrees"), 0o700)
	var out []string
	for _, n := range names {
		w := filepath.Join(filepath.Dir(dir), n)
		os.MkdirAll(w, 0o700)
		os.MkdirAll(filepath.Join(dir, ".git", "worktrees", n), 0o700)
		os.WriteFile(filepath.Join(dir, ".git", "worktrees", n, "gitdir"), []byte(filepath.Join(w, ".git")+"\n"), 0o600)
		os.WriteFile(filepath.Join(w, ".git"), []byte("gitdir: "+filepath.Join(dir, ".git", "worktrees", n)+"\n"), 0o600)
		out = append(out, w)
	}
	return out
}

func dirs(bs []base) []string {
	var out []string
	for _, b := range bs {
		out = append(out, b.dir+":"+b.found)
	}
	return out
}

func TestBases(t *testing.T) {
	top := t.TempDir()
	plain := filepath.Join(top, "plain", "sub")
	os.MkdirAll(plain, 0o700)
	if got := dirs(bases(plain)); strings.Join(got, " ") != plain+":" {
		t.Errorf("plain: %v", got)
	}
	if got := bases(""); len(got) != 1 || got[0].dir != "" {
		t.Errorf("no cwd: %v", got)
	}
	main := filepath.Join(top, "repos", "main")
	os.MkdirAll(filepath.Join(main, "web", "src"), 0o700)
	wts := repo(t, main, "feature", "fix")
	// A subdirectory of the main checkout: itself, its ancestors to the top, then the worktrees.
	want := []string{filepath.Join(main, "web", "src") + ":", filepath.Join(main, "web") + ":ancestor", main + ":ancestor", wts[0] + ":worktree", wts[1] + ":worktree"}
	if got := dirs(bases(filepath.Join(main, "web", "src"))); strings.Join(got, " ") != strings.Join(want, " ") {
		t.Errorf("subdirectory:\n got %v\nwant %v", got, want)
	}
	// The top itself: no ancestors.
	want = []string{main + ":", wts[0] + ":worktree", wts[1] + ":worktree"}
	if got := dirs(bases(main)); strings.Join(got, " ") != strings.Join(want, " ") {
		t.Errorf("top:\n got %v\nwant %v", got, want)
	}
	// From a linked worktree (.git is a file): the main checkout, then the sibling.
	os.MkdirAll(filepath.Join(wts[1], "docs"), 0o700)
	want = []string{filepath.Join(wts[1], "docs") + ":", wts[1] + ":ancestor", main + ":worktree", wts[0] + ":worktree"}
	if got := dirs(bases(filepath.Join(wts[1], "docs"))); strings.Join(got, " ") != strings.Join(want, " ") {
		t.Errorf("worktree:\n got %v\nwant %v", got, want)
	}
	// A worktree removed by hand is skipped; a gitdir with a relative line too.
	os.RemoveAll(wts[0])
	os.MkdirAll(filepath.Join(main, ".git", "worktrees", "rel"), 0o700)
	os.WriteFile(filepath.Join(main, ".git", "worktrees", "rel", "gitdir"), []byte("../../somewhere/.git\n"), 0o600)
	os.MkdirAll(filepath.Join(main, ".git", "worktrees", "noise"), 0o700)
	os.WriteFile(filepath.Join(main, ".git", "worktrees", "noise", "gitdir"), make([]byte, 100<<10), 0o600)
	want = []string{main + ":", wts[1] + ":worktree"}
	if got := dirs(bases(main)); strings.Join(got, " ") != strings.Join(want, " ") {
		t.Errorf("removed and relative:\n got %v\nwant %v", got, want)
	}
	// A .git file whose line points nowhere, or not at a worktrees entry: the directory alone.
	odd := filepath.Join(top, "odd")
	os.MkdirAll(odd, 0o700)
	os.WriteFile(filepath.Join(odd, ".git"), []byte("gitdir: /nowhere/at/all\n"), 0o600)
	if got := dirs(bases(odd)); strings.Join(got, " ") != odd+":" {
		t.Errorf("dangling .git file: %v", got)
	}
	// Seventy worktrees: 64 are read.
	many := filepath.Join(top, "many", "main")
	os.MkdirAll(many, 0o700)
	var names []string
	for i := 0; i < 70; i++ {
		names = append(names, "w"+strings.Repeat("0", 2-len(itoa(i)))+itoa(i))
	}
	repo(t, many, names...)
	if got := bases(many); len(got) != 1+maxWorktrees {
		t.Errorf("seventy worktrees: %d bases", len(got))
	}
}

func itoa(i int) string {
	if i < 10 {
		return string(rune('0' + i))
	}
	return string(rune('0'+i/10)) + string(rune('0'+i%10))
}

func TestResolvePreviewOverBases(t *testing.T) {
	top := t.TempDir()
	root := filepath.Join(top, "src")
	main := filepath.Join(root, "main")
	os.MkdirAll(filepath.Join(main, "web"), 0o700)
	wts := repo(t, main, "feature", "fix")
	write := func(p, s string) {
		os.MkdirAll(filepath.Dir(p), 0o700)
		os.WriteFile(p, []byte(s), 0o600)
	}
	write(filepath.Join(main, "docs", "top.md"), "top")
	write(filepath.Join(wts[0], "docs", "plans", "a.md"), "feature")
	write(filepath.Join(wts[0], "key.pem"), "secret")
	write(filepath.Join(wts[1], "docs", "plans", "b.md"), "fix")
	write(filepath.Join(wts[1], "docs", "plans", "a.md"), "fix a")
	// The fix copy of a.md is the newer one.
	old := time.Now().Add(-time.Hour)
	os.Chtimes(filepath.Join(wts[0], "docs", "plans", "a.md"), old, old)
	roots := []string{root}
	home := filepath.Join(top, "home")
	type want struct{ file, found string }
	cases := map[string]want{
		"docs/top.md":       {filepath.Join(main, "docs", "top.md"), ""},
		"docs/plans/b.md":   {filepath.Join(wts[1], "docs", "plans", "b.md"), "worktree"},
		"docs/plans/a.md":   {filepath.Join(wts[1], "docs", "plans", "a.md"), "worktree"},
		"./docs/plans/b.md": {filepath.Join(wts[1], "docs", "plans", "b.md"), "worktree"},
	}
	for path, w := range cases {
		file, _, found, err := resolvePreview(roots, false, main, home, path)
		if err != nil || file != w.file || found != w.found {
			t.Errorf("from main, %s: %v %q %q", path, err, file, found)
		}
	}
	// From a subdirectory: the top's file is an ancestor hit, the worktree's a worktree hit.
	file, _, found, err := resolvePreview(roots, false, filepath.Join(main, "web"), home, "docs/top.md")
	if err != nil || file != filepath.Join(main, "docs", "top.md") || found != "ancestor" {
		t.Errorf("from web, docs/top.md: %v %q %q", err, file, found)
	}
	// The pane's own copy wins over a newer worktree's.
	write(filepath.Join(main, "docs", "plans", "a.md"), "main a")
	if file, _, found, err := resolvePreview(roots, false, main, home, "docs/plans/a.md"); err != nil || file != filepath.Join(main, "docs", "plans", "a.md") || found != "" {
		t.Errorf("own copy: %v %q %q", err, file, found)
	}
	// From a worktree whose .git is a file: the main checkout's file is found.
	if file, _, found, err := resolvePreview(roots, false, wts[0], home, "docs/top.md"); err != nil || file != filepath.Join(main, "docs", "top.md") || found != "worktree" {
		t.Errorf("from a worktree: %v %q %q", err, file, found)
	}
	// Every refusal holds from a fallback base: a secret, git's own files, a directory, nothing.
	for _, path := range []string{"key.pem", ".git/worktrees/feature/gitdir", "docs/plans", "nothere.md", ".git", "../docs/top.md"} {
		if file, _, _, err := resolvePreview(roots, false, main, home, path); err == nil {
			t.Errorf("%q served as %s", path, file)
		}
	}
	// A worktree outside every root is a base, not a file: its files are not served.
	out := filepath.Join(top, "outside")
	os.MkdirAll(filepath.Join(main, ".git", "worktrees", "out"), 0o700)
	os.WriteFile(filepath.Join(main, ".git", "worktrees", "out", "gitdir"), []byte(filepath.Join(out, ".git")+"\n"), 0o600)
	write(filepath.Join(out, ".git"), "gitdir: "+filepath.Join(main, ".git", "worktrees", "out")+"\n")
	write(filepath.Join(out, "docs", "only.md"), "outside")
	if file, _, _, err := resolvePreview(roots, false, main, home, "docs/only.md"); err == nil {
		t.Errorf("outside the roots, served as %s", file)
	}
	// An absolute path and one from home are taken as they are, never from a base.
	write(filepath.Join(home, "n.txt"), "n")
	if _, _, found, err := resolvePreview([]string{root, home}, false, main, home, "~/n.txt"); err != nil || found != "" {
		t.Errorf("from home: %v %q", err, found)
	}
	if _, _, found, err := resolvePreview(roots, false, main, home, filepath.Join(wts[1], "docs", "plans", "b.md")); err != nil || found != "" {
		t.Errorf("absolute: %v %q", err, found)
	}
}
