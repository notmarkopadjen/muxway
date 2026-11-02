package agent

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

// A root with the shapes a listing must handle: a directory, a file, a
// name with a space, one with a quote, secrets, hidden entries, links in
// and out, and names a client could never type.
func listingRoot(t *testing.T) (root, home, other string) {
	t.Helper()
	base := t.TempDir()
	root = filepath.Join(base, "work")
	home = filepath.Join(base, "home")
	other = filepath.Join(base, "elsewhere")
	for _, d := range []string{
		filepath.Join(root, "docs", "plans"), filepath.Join(root, "a b"), filepath.Join(root, ".git"),
		filepath.Join(root, ".github"), filepath.Join(root, ".ssh"), filepath.Join(home, "notes"), other,
	} {
		os.MkdirAll(d, 0o700)
	}
	write := func(p string) { os.WriteFile(p, []byte("x\n"), 0o600) }
	write(filepath.Join(root, "notes.md"))
	write(filepath.Join(root, "it's.txt"))
	write(filepath.Join(root, "key.pem"))
	write(filepath.Join(root, ".env"))
	write(filepath.Join(root, ".github", "ci.yml"))
	write(filepath.Join(root, "docs", "plans", "a.md"))
	write(filepath.Join(root, "bad\nname"))
	write(filepath.Join(root, strings.Repeat("n", 300)))
	write(filepath.Join(home, "notes", "todo.txt"))
	write(filepath.Join(other, "o.txt"))
	os.Symlink(filepath.Join(root, "docs"), filepath.Join(root, "link-in"))
	os.Symlink(other, filepath.Join(root, "link-out"))
	os.Symlink(filepath.Join(other, "o.txt"), filepath.Join(root, "file-out"))
	return root, home, other
}

func TestResolveDir(t *testing.T) {
	root, home, other := listingRoot(t)
	roots := []string{root}
	cwd := filepath.Join(root, "docs")
	for _, c := range []struct {
		path, want string
		hidden     bool
	}{
		{"", cwd, false},
		{".", cwd, false},
		{"plans", filepath.Join(cwd, "plans"), false},
		{"./plans/", filepath.Join(cwd, "plans"), false},
		{"..", root, false},
		{root, root, false},
		{"../link-in", cwd, false},
		{"../.github", filepath.Join(root, ".github"), true},
		{"~/notes", filepath.Join(home, "notes"), false},
	} {
		rs := roots
		if strings.HasPrefix(c.path, "~") {
			rs = []string{root, home}
		}
		got, err := resolveDir(rs, c.hidden, cwd, home, c.path)
		if err != nil || got != c.want {
			t.Errorf("%q: got %q, %v; want %q", c.path, got, err, c.want)
		}
	}
	for _, c := range []struct {
		path   string
		hidden bool
	}{
		{"../..", false}, {"/etc", false}, {other, false}, {"../.git", true}, {"../.ssh", true},
		{"../.github", false}, {"plans/a.md", false}, {"../link-out", false}, {"../file-out", false},
		{"nothere", false}, {"~/notes", false}, {"a\x00b", false}, {strings.Repeat("a/", 600), false},
	} {
		if got, err := resolveDir(roots, c.hidden, cwd, home, c.path); err == nil {
			t.Errorf("%q: resolved to %q", c.path, got)
		}
	}
	if _, err := resolveDir(roots, false, "", home, ""); err == nil {
		t.Error("no cwd resolved")
	}
}

func kinds(entries []wire.Entry) map[string]string {
	m := map[string]string{}
	for _, e := range entries {
		m[e.Name] = e.Kind
	}
	return m
}

func TestReadDir(t *testing.T) {
	root, _, _ := listingRoot(t)
	roots := []string{root}
	entries, truncated := readDir(roots, false, root)
	if truncated {
		t.Fatal("truncated")
	}
	want := map[string]string{
		"a b": "dir", "docs": "dir", "it's.txt": "file", "notes.md": "file",
		"link-in": "dir", "link-out": "other", "file-out": "other",
	}
	got := kinds(entries)
	if len(got) != len(want) {
		t.Fatalf("got %v", got)
	}
	for n, k := range want {
		if got[n] != k {
			t.Errorf("%s: %q, want %q", n, got[n], k)
		}
	}
	for i := 1; i < len(entries); i++ {
		if entries[i-1].Name >= entries[i].Name {
			t.Fatalf("not sorted: %v", entries)
		}
	}
	// Hidden entries need the flag; the secret ones never show.
	got = kinds(must(readDir(roots, true, root)))
	if got[".github"] != "dir" || got[".git"] != "" || got[".env"] != "" || got["key.pem"] != "" || got[".ssh"] != "" {
		t.Errorf("with hidden: %v", got)
	}
	// Past the cap the listing says so.
	many := filepath.Join(root, "many")
	os.MkdirAll(many, 0o700)
	for i := 0; i <= wire.MaxEntries; i++ {
		os.WriteFile(filepath.Join(many, fmt.Sprintf("f%04d", i)), nil, 0o600)
	}
	entries, truncated = readDir(roots, false, many)
	if len(entries) != wire.MaxEntries || !truncated {
		t.Fatalf("%d entries, truncated %v", len(entries), truncated)
	}
	if entries, _ := readDir(roots, false, filepath.Join(root, "nothere")); entries != nil {
		t.Fatal("a missing directory listed")
	}
}

func must(entries []wire.Entry, _ bool) []wire.Entry { return entries }

func TestCwdFor(t *testing.T) {
	root, _, other := listingRoot(t)
	a := &Agent{cfg: Config{Preview: []string{root}}}
	docs := filepath.Join(root, "docs")
	for _, c := range []struct {
		command, path, want string
	}{
		{"bash", docs, docs},
		{"zsh", root, root},
		{"fish", filepath.Join(root, "link-in"), docs},
		{"vim", docs, ""},
		{"claude", docs, ""},
		{"bash", other, ""},
		{"bash", filepath.Join(root, ".git"), ""},
		{"bash", "", ""},
	} {
		if got := a.cwdFor(tmux.Pane{Command: c.command, Path: c.path}); got != c.want {
			t.Errorf("%s in %q: %q, want %q", c.command, c.path, got, c.want)
		}
	}
	none := &Agent{}
	if got := none.cwdFor(tmux.Pane{Command: "bash", Path: docs}); got != "" {
		t.Errorf("without roots: %q", got)
	}
}
