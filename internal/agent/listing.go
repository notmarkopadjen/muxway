package agent

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

// Listing: a writer of a shell pane sees the names in the pane's
// directory, or in any directory under the roots, so a client can make
// the names on the screen links. The rules are the preview's: under a
// root once symlinks are followed, nothing hidden unless the owner
// allows it, never a secret by name. Names and kinds travel, never
// content.

// resolveDir turns a path as printed into the directory it names, from
// the pane's directory; "" is the pane's directory itself. A root is a
// directory a pane may sit in, so it resolves too.
func resolveDir(roots []string, hidden bool, cwd, home, path string) (string, error) {
	if path == "" {
		path = "."
	}
	dir, err := resolveUnder(roots, hidden, cwd, home, path, true)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		return "", errNoPreview
	}
	return dir, nil
}

// readDir lists a resolved directory: names in order, each with its
// kind; the hidden and the secret ones left out as the preview leaves
// them, as are names a client could not type; at most wire.MaxEntries.
func readDir(roots []string, hidden bool, dir string) ([]wire.Entry, bool) {
	ents, err := os.ReadDir(dir)
	if err != nil {
		return nil, false
	}
	out := []wire.Entry{}
	for _, e := range ents {
		name := e.Name()
		if !wire.ValidName(name) || secretName(name) {
			continue
		}
		if strings.HasPrefix(name, ".") && (!hidden || deniedDir[strings.ToLower(name)]) {
			continue
		}
		if len(out) == wire.MaxEntries {
			return out, true
		}
		out = append(out, wire.Entry{Name: name, Kind: entryKind(roots, hidden, dir, e)})
	}
	return out, false
}

// entryKind is dir, file or other; a symlink has the kind of what it points
// to, other when that leaves the roots.
func entryKind(roots []string, hidden bool, dir string, e os.DirEntry) string {
	mode := e.Type()
	if mode&os.ModeSymlink != 0 {
		real, err := filepath.EvalSymlinks(filepath.Join(dir, e.Name()))
		if err != nil {
			return "other"
		}
		if _, ok := underRoot(roots, real, hidden); !ok && !isRoot(roots, real) {
			return "other"
		}
		info, err := os.Stat(real)
		if err != nil {
			return "other"
		}
		mode = info.Mode()
	}
	switch {
	case mode.IsDir():
		return "dir"
	case mode.IsRegular():
		return "file"
	}
	return "other"
}

// cwdFor is what a listing says of a pane's directory: the real one,
// when it lies under a root; nothing otherwise.
func (a *Agent) cwdFor(p tmux.Pane) string {
	if len(a.cfg.Preview) == 0 || p.Path == "" {
		return ""
	}
	dir, err := resolveDir(a.cfg.Preview, a.cfg.PreviewHidden, p.Path, "", "")
	if err != nil {
		return ""
	}
	return dir
}

// listDir answers the entries of a directory for a writer of a pane,
// with the resolved directory for the audit log, or a code. Every
// refusal is the one code.
func (a *Agent) listDir(ctx context.Context, req wire.Request) (string, *wire.Listing, string) {
	if len(a.cfg.Preview) == 0 {
		return "", nil, wire.ErrNotAllowed
	}
	p, code := a.find(ctx, req.Pane)
	if code != "" {
		return "", nil, code
	}
	if p.Mode != tmux.ModeWrite {
		return "", nil, wire.ErrReadOnly
	}
	home, _ := os.UserHomeDir()
	dir, err := resolveDir(a.cfg.Preview, a.cfg.PreviewHidden, p.Path, home, req.Path)
	if err != nil {
		return "", nil, wire.ErrNoFile
	}
	entries, truncated := readDir(a.cfg.Preview, a.cfg.PreviewHidden, dir)
	return dir, &wire.Listing{Path: dir, Entries: entries, Truncated: truncated}, ""
}
