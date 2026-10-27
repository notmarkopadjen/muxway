package agent

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/notmarkopadjen/muxway/internal/wire"
)

// Changes: git's view of the repository a pane works in, for a writer of
// the pane, when the repository's root lies under a preview root. The
// agent runs two read-only commands, status and diff, with a fixed
// argument list, no shell, a clean environment and a timeout; nothing
// else the agent runs is not tmux. The root is found by walking up from
// the pane's directory, so git runs only inside a root the owner named.

const gitTimeout = 10 * time.Second

var errNoRepo = errors.New("not a repository the host shows")

// repoRoot finds the repository the directory lies in and says whether
// it may be shown: a root itself, or under one once every symlink is
// followed, with no dot component below the root.
func repoRoot(roots []string, cwd string) (string, error) {
	if cwd == "" || !filepath.IsAbs(cwd) {
		return "", errNoRepo
	}
	dir, err := filepath.EvalSymlinks(cwd)
	if err != nil {
		return "", errNoRepo
	}
	for {
		if _, err := os.Lstat(filepath.Join(dir, ".git")); err == nil {
			break
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errNoRepo
		}
		dir = parent
	}
	if _, ok := underRoot(roots, dir); ok {
		return dir, nil
	}
	for _, root := range roots {
		if real, err := filepath.EvalSymlinks(root); err == nil && real == dir {
			return dir, nil
		}
	}
	return "", errNoRepo
}

// runGit runs one git command in the root and answers its output. The
// environment is the agent's PATH and nothing else of its own: no
// GIT_DIR, no pager, no prompt, no global or system configuration, so
// no alias, external diff, text converter or file monitor of anyone's
// reaches the command; the root is named safe for this run alone.
func runGit(ctx context.Context, root string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	all := append([]string{
		"-C", root, "--no-optional-locks",
		"-c", "safe.directory=" + root,
		"-c", "core.pager=cat",
		"-c", "core.fsmonitor=false",
		"-c", "core.hooksPath=/dev/null",
	}, args...)
	cmd := exec.CommandContext(ctx, "git", all...)
	cmd.Env = []string{
		"PATH=" + os.Getenv("PATH"),
		"LC_ALL=C",
		"GIT_TERMINAL_PROMPT=0",
		"GIT_CONFIG_NOSYSTEM=1",
		"GIT_CONFIG_GLOBAL=/dev/null",
		"GIT_OPTIONAL_LOCKS=0",
	}
	cmd.Stdin = nil
	var out, errOut bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errOut
	if err := cmd.Run(); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// gitStatus answers the repository's changes.
func gitStatus(ctx context.Context, root string) (*wire.Changes, error) {
	out, err := runGit(ctx, root, "status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z")
	if err != nil {
		return nil, err
	}
	c := parseStatus(out)
	c.Root = root
	return c, nil
}

// parseStatus reads porcelain v2 with NUL terminators, so a path with a
// newline, a quote or a control character is a path.
func parseStatus(out []byte) *wire.Changes {
	c := &wire.Changes{Entries: []wire.Change{}}
	fields := strings.Split(string(out), "\x00")
	for i := 0; i < len(fields); i++ {
		rec := fields[i]
		if rec == "" {
			continue
		}
		switch {
		case strings.HasPrefix(rec, "# branch.head "):
			c.Branch = strings.TrimPrefix(rec, "# branch.head ")
		case strings.HasPrefix(rec, "# branch.ab "):
			parts := strings.Fields(strings.TrimPrefix(rec, "# branch.ab "))
			if len(parts) == 2 {
				c.Ahead, _ = strconv.Atoi(strings.TrimPrefix(parts[0], "+"))
				c.Behind, _ = strconv.Atoi(strings.TrimPrefix(parts[1], "-"))
			}
		case strings.HasPrefix(rec, "# "):
		default:
			var ch wire.Change
			var ok bool
			switch rec[0] {
			case '1':
				ch, ok = ordinary(rec)
			case '2':
				// The old path is the next record.
				if i+1 < len(fields) {
					ch, ok = renamed(rec, fields[i+1])
					i++
				}
			case 'u':
				ch, ok = unmerged(rec)
			case '?':
				ch, ok = wire.Change{Path: rec[2:], Kind: "untracked"}, len(rec) > 2
			}
			if !ok {
				continue
			}
			if len(c.Entries) >= wire.MaxChanges {
				c.Truncated = true
				return c
			}
			c.Entries = append(c.Entries, ch)
		}
	}
	return c
}

// nth answers the record from its nth space-separated field on, so a
// path keeps its own spaces.
func nth(rec string, n int) (string, bool) {
	for ; n > 0; n-- {
		i := strings.IndexByte(rec, ' ')
		if i < 0 {
			return "", false
		}
		rec = rec[i+1:]
	}
	return rec, rec != ""
}

func kindOf(xy string) (string, bool) {
	x, y := xy[0], xy[1]
	switch {
	case x == 'A' || y == 'A':
		return "added", x != '.'
	case x == 'D' || y == 'D':
		return "deleted", x != '.'
	case x == 'R' || y == 'R':
		return "renamed", x != '.'
	}
	return "modified", x != '.'
}

func ordinary(rec string) (wire.Change, bool) {
	// 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
	path, ok := nth(rec, 8)
	if !ok || len(rec) < 4 {
		return wire.Change{}, false
	}
	kind, staged := kindOf(rec[2:4])
	return wire.Change{Path: path, Kind: kind, Staged: staged}, true
}

func renamed(rec, from string) (wire.Change, bool) {
	// 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>
	path, ok := nth(rec, 9)
	if !ok || len(rec) < 4 || from == "" {
		return wire.Change{}, false
	}
	_, staged := kindOf(rec[2:4])
	return wire.Change{Path: path, From: from, Kind: "renamed", Staged: staged}, true
}

func unmerged(rec string) (wire.Change, bool) {
	// u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
	path, ok := nth(rec, 10)
	if !ok {
		return wire.Change{}, false
	}
	return wire.Change{Path: path, Kind: "conflict"}, true
}

// gitDiff answers one change's diff against the last commit, when the
// path is one the status lists; an untracked path has no diff. The
// path goes after --, so a path is a path whatever it starts with.
func gitDiff(ctx context.Context, root, path string) (string, bool, bool, error) {
	c, err := gitStatus(ctx, root)
	if err != nil {
		return "", false, false, err
	}
	var entry *wire.Change
	for i := range c.Entries {
		if c.Entries[i].Path == path {
			entry = &c.Entries[i]
			break
		}
	}
	if entry == nil || entry.Kind == "untracked" {
		return "", false, false, errNoRepo
	}
	args := []string{"diff", "--no-color", "--no-ext-diff", "--no-textconv", "--no-relative", "HEAD", "--", path}
	if entry.From != "" {
		args = append(args, entry.From)
	}
	out, err := runGit(ctx, root, args...)
	if err != nil {
		return "", false, false, err
	}
	cut := false
	if len(out) > wire.MaxDiff {
		out = out[:wire.MaxDiff]
		cut = true
	}
	diff := string(out)
	binary := strings.HasPrefix(diff, "Binary files ") || strings.Contains(diff, "\nBinary files ")
	return diff, binary, cut, nil
}

// changes answers the pane's repository's status, or a code.
func (a *Agent) changes(ctx context.Context, req wire.Request) (*wire.Changes, string) {
	root, code := a.repoOf(ctx, req.Pane)
	if code != "" {
		return nil, code
	}
	c, err := gitStatus(ctx, root)
	if err != nil {
		return nil, wire.ErrNoFile
	}
	return c, ""
}

// diff answers one change's diff, or a code.
func (a *Agent) diff(ctx context.Context, req wire.Request) (string, bool, bool, string, string) {
	root, code := a.repoOf(ctx, req.Pane)
	if code != "" {
		return "", false, false, code, root
	}
	if !wire.ValidPath(req.Path) {
		return "", false, false, wire.ErrBadInput, root
	}
	d, binary, cut, err := gitDiff(ctx, root, req.Path)
	if err != nil {
		return "", false, false, wire.ErrNoFile, root
	}
	return d, binary, cut, "", root
}

// repoOf finds the root the pane's directory lies in, under the roots.
// Every refusal is the one code, as the preview's are.
func (a *Agent) repoOf(ctx context.Context, pane string) (string, string) {
	if len(a.cfg.Preview) == 0 {
		return "", wire.ErrNotAllowed
	}
	p, code := a.find(ctx, pane)
	if code != "" {
		return "", code
	}
	cwd, err := a.tmux.CurrentPath(ctx, p.PaneID)
	if err != nil {
		return "", wire.ErrTmux
	}
	root, err := repoRoot(a.cfg.Preview, cwd)
	if err != nil {
		return "", wire.ErrNoFile
	}
	return root, ""
}
