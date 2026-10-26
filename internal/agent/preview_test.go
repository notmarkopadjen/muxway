package agent

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
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
		"~/notes/todo.txt":                     "text/plain; charset=utf-8",
	}
	for path, typ := range good {
		file, got, err := resolvePreview(roots, cwd, home, path)
		if err != nil || got != typ || !strings.HasPrefix(file, base) {
			t.Errorf("%s: %v %q %q", path, err, got, file)
		}
	}
	bad := []string{
		"", "../../elsewhere/o.txt", filepath.Join(other, "o.txt"), "../link.txt", "../dir/o.txt",
		"../.env", "../.git/config", "../run.sh", "../key.pem", "plans", "..", "nothere.md",
		"plans/a.md\n", strings.Repeat("a/", 600) + "a.md", "~/../elsewhere/o.txt", "/etc/passwd",
	}
	for _, path := range bad {
		if file, _, err := resolvePreview(roots, cwd, home, path); err == nil {
			t.Errorf("%q served as %s", path, file)
		}
	}
	if _, _, err := resolvePreview(roots, "", home, "plans/a.md"); err == nil {
		t.Error("no cwd, served")
	}
	if _, _, err := resolvePreview(nil, cwd, home, "plans/a.md"); err == nil {
		t.Error("no roots, served")
	}
	big := filepath.Join(root, "docs", "big.log")
	os.WriteFile(big, make([]byte, 8<<20+1), 0o600)
	if _, _, err := resolvePreview(roots, cwd, home, "big.log"); err == nil {
		t.Error("9 MiB served")
	}
}
