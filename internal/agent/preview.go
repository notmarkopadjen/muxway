package agent

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/notmarkopadjen/muxway/internal/wire"
)

// Preview: a writer of a pane reads a file the pane printed the path of,
// when it lies under a directory the owner named with --preview. The
// agent reads with its own rights, so the roots are the owner's choice;
// nothing hidden is ever served, and only the types a window can show.

var previewTypes = map[string]string{
	"txt": "text/plain; charset=utf-8", "md": "text/plain; charset=utf-8", "markdown": "text/plain; charset=utf-8",
	"csv": "text/plain; charset=utf-8", "tsv": "text/plain; charset=utf-8", "json": "text/plain; charset=utf-8",
	"log": "text/plain; charset=utf-8", "yaml": "text/plain; charset=utf-8", "yml": "text/plain; charset=utf-8",
	"toml": "text/plain; charset=utf-8", "ini": "text/plain; charset=utf-8", "xml": "text/plain; charset=utf-8",
	"html": "text/plain; charset=utf-8",
	"js":   "text/plain; charset=utf-8",
	"jsx":  "text/plain; charset=utf-8",
	"ts":   "text/plain; charset=utf-8",
	"tsx":  "text/plain; charset=utf-8",
	"cs":   "text/plain; charset=utf-8",
	"go":   "text/plain; charset=utf-8",
	"py":   "text/plain; charset=utf-8",
	"rb":   "text/plain; charset=utf-8",
	"rs":   "text/plain; charset=utf-8",
	"java": "text/plain; charset=utf-8",
	"kt":   "text/plain; charset=utf-8",
	"kts":  "text/plain; charset=utf-8",
	"c":    "text/plain; charset=utf-8",
	"h":    "text/plain; charset=utf-8",
	"cpp":  "text/plain; charset=utf-8",
	"hpp":  "text/plain; charset=utf-8",
	"sh":   "text/plain; charset=utf-8",
	"bash": "text/plain; charset=utf-8",
	"zsh":  "text/plain; charset=utf-8",
	"fish": "text/plain; charset=utf-8",
	"sql":  "text/plain; charset=utf-8",
	"css":  "text/plain; charset=utf-8",
	"scss": "text/plain; charset=utf-8",
	"less": "text/plain; charset=utf-8",
	"png":  "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp",
	"pdf": "application/pdf",
}

var errNoPreview = errors.New("not previewed")

// resolvePreview turns a path as printed into the file it names, from the
// pane's directory, and says whether that file may be served: under one
// of the roots once every symlink is followed, no dot component below the
// root, a regular file of a type a window shows, at most wire.MaxFile.
func resolvePreview(roots []string, cwd, home, path string) (string, string, error) {
	if !wire.ValidPath(path) || cwd == "" {
		return "", "", errNoPreview
	}
	switch {
	case path == "~" || strings.HasPrefix(path, "~/"):
		if home == "" {
			return "", "", errNoPreview
		}
		path = filepath.Join(home, path[1:])
	case !filepath.IsAbs(path):
		path = filepath.Join(cwd, path)
	}
	file, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", "", errNoPreview
	}
	if _, ok := underRoot(roots, file); !ok {
		return "", "", errNoPreview
	}
	typ, ok := previewTypes[strings.ToLower(strings.TrimPrefix(filepath.Ext(file), "."))]
	if !ok {
		return "", "", errNoPreview
	}
	info, err := os.Stat(file)
	if err != nil || !info.Mode().IsRegular() || info.Size() > wire.MaxFile {
		return "", "", errNoPreview
	}
	return file, typ, nil
}

// underRoot says whether a resolved path lies below one of the roots, and
// answers its path from there: not the root itself, and with no dot
// component, so nothing hidden is ever shown.
func underRoot(roots []string, file string) (string, bool) {
	for _, root := range roots {
		real, err := filepath.EvalSymlinks(root)
		if err != nil {
			continue
		}
		rel, err := filepath.Rel(real, file)
		if err != nil || rel == ".." || strings.HasPrefix(rel, "../") || rel == "." {
			continue
		}
		for _, part := range strings.Split(rel, string(filepath.Separator)) {
			if strings.HasPrefix(part, ".") {
				return "", false
			}
		}
		return rel, true
	}
	return "", false
}

// preview answers the resolved path, the type and the bytes of a file a
// pane printed, or a code. Every refusal is the one code, so a client
// learns nothing of what is there.
func (a *Agent) preview(ctx context.Context, req wire.Request) (string, string, []byte, string) {
	if len(a.cfg.Preview) == 0 {
		return "", "", nil, wire.ErrNotAllowed
	}
	p, code := a.find(ctx, req.Pane)
	if code != "" {
		return "", "", nil, code
	}
	cwd, err := a.tmux.CurrentPath(ctx, p.PaneID)
	if err != nil {
		return "", "", nil, wire.ErrTmux
	}
	home, _ := os.UserHomeDir()
	file, typ, err := resolvePreview(a.cfg.Preview, cwd, home, req.Path)
	if err != nil {
		return "", "", nil, wire.ErrNoFile
	}
	data, err := os.ReadFile(file)
	if err != nil || len(data) > wire.MaxFile {
		return file, "", nil, wire.ErrNoFile
	}
	return file, typ, data, ""
}
