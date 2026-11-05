//go:build e2e

package e2e

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// A relative path printed in a pane finds its file where the pane's
// repository has it: up the tree to the repository's top, and across
// its worktrees, under the same rules as a path typed in full.

// relativeEnv makes a repository with two linked worktrees under the
// preview root and a third outside it, and puts the writable pane's shell
// into the main checkout. Files: docs/top.md in the main checkout only;
// docs/both.md in the main checkout and in feature; docs/plans/a.md in
// feature only; docs/plans/b.md in feature and in fix, fix's the newer;
// key.pem in feature only; docs/out.md in the worktree outside the root.
func relativeEnv(t *testing.T) (*env, *tmuxServer, string, string) {
	t.Helper()
	base := t.TempDir()
	root := filepath.Join(base, "work")
	main := filepath.Join(root, "main")
	os.MkdirAll(filepath.Join(main, "docs"), 0o700)
	os.MkdirAll(filepath.Join(main, "web"), 0o700)
	write := func(p, s string) {
		os.MkdirAll(filepath.Dir(p), 0o700)
		os.WriteFile(p, []byte(s), 0o600)
	}
	write(filepath.Join(main, "README"), "a repository\n")
	git(t, main, "init", "-q", "-b", "main")
	git(t, main, "add", ".")
	git(t, main, "commit", "-q", "-m", "first")
	git(t, main, "worktree", "add", "-q", "-b", "feature", filepath.Join(root, "feature"))
	git(t, main, "worktree", "add", "-q", "-b", "fix", filepath.Join(root, "fix"))
	git(t, main, "worktree", "add", "-q", "-b", "outside", filepath.Join(base, "outside"))
	// Written after the checkouts, so each file is where it says and nowhere else.
	write(filepath.Join(main, "docs", "top.md"), "top of main\n")
	write(filepath.Join(main, "docs", "both.md"), "both, main's copy\n")
	write(filepath.Join(root, "feature", "docs", "plans", "a.md"), "plan a, from feature\n")
	write(filepath.Join(root, "feature", "docs", "plans", "b.md"), "plan b, from feature\n")
	write(filepath.Join(root, "feature", "docs", "both.md"), "both, feature's copy\n")
	write(filepath.Join(root, "feature", "key.pem"), "secret")
	write(filepath.Join(root, "fix", "docs", "plans", "b.md"), "plan b, from fix\n")
	write(filepath.Join(base, "outside", "docs", "out.md"), "outside\n")
	old := time.Now().Add(-time.Hour)
	os.Chtimes(filepath.Join(root, "feature", "docs", "plans", "b.md"), old, old)
	// A plain directory under the root, no repository.
	os.MkdirAll(filepath.Join(root, "plain"), 0o700)
	e := newEnv(t)
	ts := newTmux(t)
	e.pairAgent(host, ts, "--preview", root)
	e.expose(ts, "work:0.0", "--write")
	cdPane(t, ts, main)
	return e, ts, root, base
}

// cdPane puts the writable pane's shell into dir and waits until tmux says so.
func cdPane(t *testing.T, ts *tmuxServer, dir string) {
	t.Helper()
	ts.must("send-keys", "-t", "work:0.0", "cd "+dir, "Enter")
	waitFor(t, "the shell in "+dir, func() bool {
		return strings.TrimSpace(ts.must("display-message", "-p", "-t", "work:0.0", "#{pane_current_path}")) == dir
	})
}

// previewSlow asks for a preview inside the limit of two a second.
func (e *env) previewSlow(tok, path string) resp {
	e.t.Helper()
	time.Sleep(520 * time.Millisecond)
	return e.preview(tok, shell0, path)
}

// 210
func TestSec210_TheFallbackNeverLeavesTheRoots(t *testing.T) {
	e, ts, root, base := relativeEnv(t)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	for _, path := range []string{
		"docs/out.md",                   // only in the worktree outside the root
		"key.pem",                       // a secret that only a worktree has
		".git/worktrees/feature/gitdir", // git's own file, asked by name
		"docs/plans/c.md",               // nowhere
	} {
		r := e.previewSlow(full, path)
		expect(t, r, http.StatusNotFound, path)
		if !strings.Contains(r.body, "not_found") || r.header.Get("Muxway-File") != "" {
			t.Fatalf("%s: %s %q", path, r.body, r.header.Get("Muxway-File"))
		}
	}
	// A gitdir file of 100 KiB of noise is ignored, and a forged .git file
	// whose line points at a repository outside the roots reaches nothing.
	os.MkdirAll(filepath.Join(root, "main", ".git", "worktrees", "noise"), 0o700)
	os.WriteFile(filepath.Join(root, "main", ".git", "worktrees", "noise", "gitdir"), []byte(strings.Repeat("x", 100<<10)), 0o600)
	expect(t, e.previewSlow(full, "docs/plans/c.md"), http.StatusNotFound, "noise gitdir")
	expect(t, e.previewSlow(full, "docs/plans/a.md"), http.StatusOK, "the other worktrees still answer")
	outRepo := filepath.Join(base, "outrepo")
	os.MkdirAll(filepath.Join(outRepo, ".git", "worktrees", "forged"), 0o700)
	os.WriteFile(filepath.Join(outRepo, ".git", "worktrees", "forged", "gitdir"), []byte(filepath.Join(root, "forged", ".git")+"\n"), 0o600)
	os.MkdirAll(filepath.Join(outRepo, "docs"), 0o700)
	os.WriteFile(filepath.Join(outRepo, "docs", "o.md"), []byte("outside\n"), 0o600)
	os.MkdirAll(filepath.Join(root, "forged"), 0o700)
	os.WriteFile(filepath.Join(root, "forged", ".git"), []byte("gitdir: "+filepath.Join(outRepo, ".git", "worktrees", "forged")+"\n"), 0o600)
	cdPane(t, ts, filepath.Join(root, "forged"))
	r := e.previewSlow(full, "docs/o.md")
	expect(t, r, http.StatusNotFound, "a forged .git file pointing outside the roots")
	if strings.Contains(r.body, "outside") {
		t.Fatal("served from outside the roots")
	}
	// The log never has the content of anything.
	for _, f := range []string{"hub.log", "agent-" + host + ".log"} {
		raw, _ := os.ReadFile(filepath.Join(e.logs, f))
		if strings.Contains(string(raw), "secret") || strings.Contains(string(raw), "plan a, from") {
			t.Fatalf("%s: content in the log", f)
		}
	}
}

// 211
func TestSec211_TheAuditNamesWhereTheFileWasFound(t *testing.T) {
	e, _, root, _ := relativeEnv(t)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	expect(t, e.previewSlow(full, "docs/plans/a.md"), http.StatusOK, "a worktree's file")
	expect(t, e.previewSlow(full, "docs/top.md"), http.StatusOK, "the pane's own file")
	expect(t, e.previewSlow(full, "docs/out.md"), http.StatusNotFound, "a refused fallback")
	log := e.agentLog(host)
	found := filepath.Join(root, "feature", "docs", "plans", "a.md")
	if !strings.Contains(log, "found=worktree") || !strings.Contains(log, "file="+found) {
		t.Fatalf("no found=worktree with the file in the agent's log:\n%s", log)
	}
	// The pane's own file carries no found, and the refusal is logged as every refusal is.
	for _, line := range strings.Split(log, "\n") {
		if strings.Contains(line, "path=docs/top.md") && strings.Contains(line, "found=") {
			t.Fatalf("the pane's own file says found: %s", line)
		}
		if strings.Contains(line, "path=docs/out.md") && !strings.Contains(line, "result=no_file") {
			t.Fatalf("the refusal is not no_file: %s", line)
		}
	}
	if strings.Contains(log, "plan a, from") || strings.Contains(log, "top of main") {
		t.Fatal("content in the log")
	}
	hub, _ := os.ReadFile(filepath.Join(e.logs, "hub.log"))
	if !strings.Contains(string(hub), "file="+found) {
		t.Fatal("the hub's audit does not name the file found")
	}
}

// 212
func TestFlow212_ARelativePathFindsItsFileInTheRepository(t *testing.T) {
	e, ts, root, _ := relativeEnv(t)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	main := filepath.Join(root, "main")
	// Only a worktree has it: served from there, and the header says so.
	r := e.previewSlow(full, "docs/plans/a.md")
	expect(t, r, http.StatusOK, "a worktree's file")
	if r.body != "plan a, from feature\n" || r.header.Get("Muxway-File") != filepath.Join(root, "feature", "docs", "plans", "a.md") {
		t.Fatalf("worktree hit: %q %q", r.body, r.header.Get("Muxway-File"))
	}
	if r.header.Get("Content-Type") != "text/plain; charset=utf-8" {
		t.Fatalf("type: %q", r.header.Get("Content-Type"))
	}
	// Both have it: the pane's own copy, no header, as before.
	r = e.previewSlow(full, "docs/both.md")
	expect(t, r, http.StatusOK, "the pane's own copy")
	if r.body != "both, main's copy\n" || r.header.Get("Muxway-File") != "" {
		t.Fatalf("own copy: %q %q", r.body, r.header.Get("Muxway-File"))
	}
	// Two worktrees have it: the newest.
	r = e.previewSlow(full, "docs/plans/b.md")
	expect(t, r, http.StatusOK, "the newest of two")
	if r.body != "plan b, from fix\n" || r.header.Get("Muxway-File") != filepath.Join(root, "fix", "docs", "plans", "b.md") {
		t.Fatalf("newest: %q %q", r.body, r.header.Get("Muxway-File"))
	}
	// The shell in a subdirectory: the top's file is found above.
	cdPane(t, ts, filepath.Join(main, "web"))
	r = e.previewSlow(full, "docs/top.md")
	expect(t, r, http.StatusOK, "an ancestor's file")
	if r.body != "top of main\n" || r.header.Get("Muxway-File") != filepath.Join(main, "docs", "top.md") {
		t.Fatalf("ancestor: %q %q", r.body, r.header.Get("Muxway-File"))
	}
	// The shell in no repository: a missing file is missing.
	cdPane(t, ts, filepath.Join(root, "plain"))
	expect(t, e.previewSlow(full, "docs/top.md"), http.StatusNotFound, "no repository")
	// The CORS answer lets a browser on another origin read the header.
	r = e.do("GET", full, "/v1/panes/"+shell0+"/preview?path=docs%2Ftop.md", "", "", "Origin", "https://app.example.com")
	if !strings.Contains(r.header.Get("Access-Control-Expose-Headers"), "Muxway-File") {
		t.Fatalf("Muxway-File not exposed: %q", r.header.Get("Access-Control-Expose-Headers"))
	}
}

// 213
func TestFlow213_AWorktreesShellFindsTheMainCheckoutsFile(t *testing.T) {
	e, ts, root, _ := relativeEnv(t)
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	cdPane(t, ts, filepath.Join(root, "feature"))
	r := e.previewSlow(full, "docs/top.md")
	expect(t, r, http.StatusOK, "the main checkout's file from a worktree")
	if r.body != "top of main\n" || r.header.Get("Muxway-File") != filepath.Join(root, "main", "docs", "top.md") {
		t.Fatalf("from a worktree: %q %q", r.body, r.header.Get("Muxway-File"))
	}
	// Its own file first, and the sibling's when it alone has it.
	r = e.previewSlow(full, "docs/both.md")
	expect(t, r, http.StatusOK, "its own copy")
	if r.body != "both, feature's copy\n" || r.header.Get("Muxway-File") != "" {
		t.Fatalf("own copy from a worktree: %q %q", r.body, r.header.Get("Muxway-File"))
	}
	cdPane(t, ts, filepath.Join(root, "fix"))
	r = e.previewSlow(full, "docs/plans/a.md")
	expect(t, r, http.StatusOK, "a sibling's file")
	if r.header.Get("Muxway-File") != filepath.Join(root, "feature", "docs", "plans", "a.md") {
		t.Fatalf("sibling: %q", r.header.Get("Muxway-File"))
	}
}
