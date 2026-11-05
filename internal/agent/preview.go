package agent

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/notmarkopadjen/muxway/internal/wire"
)

// Preview: a writer of a pane reads a file the pane printed the path of,
// when it lies under a directory the owner named with --preview. The
// agent reads with its own rights, so the roots are the owner's choice;
// nothing hidden is ever served, and only the types a window can show.

// What a window shows, by extension (the list is the protocol's, in
// docs/protocol/v1.md): every text as plain text, images and PDF as
// themselves; anything else under a root is a download.
const textTypes = `txt md markdown rst adoc org tex bib diff patch
csv tsv json jsonl ndjson json5 jsonc geojson ipynb log
yaml yml toml ini cfg conf properties props lock
xml xsd xsl xslt dtd plist svg html htm xhtml css scss sass less styl
js jsx mjs cjs ts tsx vue svelte astro coffee
cs csx cshtml razor csproj vbproj fsproj sln targets nuspec pubxml xaml axaml resx config
go mod sum py pyi pyx pxd pxi rb erb rake gemspec
rs java kt kts gradle groovy scala sbt clj cljs cljc edn el scm rkt lisp
c h cpp hpp cc cxx hh hxx inl cu cuh m mm
swift dart php pl pm lua r rmd jl hs lhs ex exs erl hrl ml mli fs fsx fsi vb pas d nim zig v cr elm
sh bash zsh fish ps1 psm1 psd1 bat cmd awk
sql graphql gql proto tf tfvars hcl nix cmake mk
http rest ics webmanifest map service timer socket mount
tpl tmpl mako jinja jinja2 j2 hbs mustache ejs njk liquid
f f90 f95 f03 for s asm glsl hlsl vert frag sol wat`

// Files a project names without an extension, matched without case.
const textNames = `makefile gnumakefile dockerfile containerfile jenkinsfile vagrantfile gemfile rakefile procfile brewfile
license licence notice readme changelog changes authors contributors copying todo install version codeowners`

const plainText = "text/plain; charset=utf-8"

var previewTypes = func() map[string]string {
	m := map[string]string{
		"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp",
		"bmp": "image/bmp", "ico": "image/x-icon", "avif": "image/avif",
		"pdf": "application/pdf",
	}
	for _, e := range strings.Fields(textTypes) {
		m[e] = plainText
	}
	for _, e := range strings.Fields("zip gz tgz tar 7z docx xlsx pptx odt ods odp") {
		m[e] = "application/octet-stream"
	}
	return m
}()

var previewNames = func() map[string]bool {
	m := map[string]bool{}
	for _, n := range strings.Fields(textNames) {
		m[n] = true
	}
	return m
}()

// Never served, under any root: what carries a secret the usual way, by
// extension, by file name, and by the hidden directory it lives in.
const deniedExts = `env pem key crt cer der p12 pfx jks keystore kdbx ovpn asc gpg pgp tfstate`
const deniedNames = `.env .netrc .npmrc .yarnrc .pypirc .htpasswd .htaccess .pgpass .my.cnf .git-credentials credentials id_rsa id_dsa id_ecdsa id_ed25519`
const deniedDirs = `.git .ssh .gnupg .aws .azure .gcloud .kube .docker .config .password-store .terraform .vault`

var deniedExt, deniedName, deniedDir = set(deniedExts), set(deniedNames), set(deniedDirs)

func set(words string) map[string]bool {
	m := map[string]bool{}
	for _, w := range strings.Fields(words) {
		m[w] = true
	}
	return m
}

// secretName says whether a file is kept out by its name alone.
func secretName(base string) bool {
	l := strings.ToLower(base)
	if deniedName[l] || deniedExt[strings.TrimPrefix(filepath.Ext(l), ".")] {
		return true
	}
	for _, p := range []string{".env.", ".credentials", ".secret", "credentials.", "secrets."} {
		if strings.HasPrefix(l, p) {
			return true
		}
	}
	return false
}

// previewType is the type a file is served as: a shown type by its
// extension or, with none, by its name; anything else as a download.
func previewType(file string) string {
	base := filepath.Base(file)
	if ext := filepath.Ext(base); ext != "" {
		if typ := previewTypes[strings.ToLower(ext[1:])]; typ != "" {
			return typ
		}
	} else if previewNames[strings.ToLower(base)] {
		return plainText
	}
	return "application/octet-stream"
}

var errNoPreview = errors.New("not previewed")

// How far the fallback looks: this many linked worktrees, this much of
// each gitdir file.
const (
	maxWorktrees = 64
	maxGitdir    = 4096
)

// base is a directory a relative path is tried from, and how it was
// found: "" for the pane's own directory, "ancestor" for a directory
// above it in the same repository, "worktree" for another worktree.
type base struct {
	dir   string
	found string
}

// bases lists the directories a relative path printed in a pane is tried
// from: the pane's directory first, then its ancestors up to the one
// holding .git, then the repository's other worktrees, read from git's
// own metadata without running git. No .git above: the pane's directory
// and nothing else.
func bases(cwd string) []base {
	out := []base{{cwd, ""}}
	if cwd == "" {
		return out
	}
	top, dotGit := repoTop(cwd)
	if top == "" {
		return out
	}
	for d := cwd; d != top; {
		d = filepath.Dir(d)
		out = append(out, base{d, "ancestor"})
	}
	for _, w := range worktrees(top, dotGit) {
		out = append(out, base{w, "worktree"})
	}
	return out
}

// repoTop finds the nearest directory at or above dir that holds .git,
// and that .git itself.
func repoTop(dir string) (string, string) {
	for d := dir; ; {
		g := filepath.Join(d, ".git")
		if _, err := os.Lstat(g); err == nil {
			return d, g
		}
		parent := filepath.Dir(d)
		if parent == d {
			return "", ""
		}
		d = parent
	}
}

// worktrees names the other worktrees of a repository whose top holds
// dotGit. A .git directory keeps its linked worktrees under
// .git/worktrees/<name>/gitdir, each naming <worktree>/.git; a .git file
// holds one line, "gitdir: <common>/worktrees/<name>", whose common
// directory's parent is the main worktree. A gitdir that does not name a
// directory is skipped.
func worktrees(top, dotGit string) []string {
	common := dotGit
	var out []string
	if info, err := os.Lstat(dotGit); err == nil && !info.IsDir() {
		line, ok := gitdirLine(dotGit)
		if !ok {
			return nil
		}
		// <common>/worktrees/<name>
		common = filepath.Dir(filepath.Dir(line))
		if filepath.Base(filepath.Dir(line)) != "worktrees" || !isDir(common) {
			return nil
		}
		if main := filepath.Dir(common); isDir(main) {
			out = append(out, main)
		}
	}
	entries, err := os.ReadDir(filepath.Join(common, "worktrees"))
	if err != nil {
		return out
	}
	for i, e := range entries {
		if i >= maxWorktrees {
			break
		}
		line, ok := gitdirLine(filepath.Join(common, "worktrees", e.Name(), "gitdir"))
		if !ok || filepath.Base(line) != ".git" {
			continue
		}
		w := filepath.Dir(line)
		if w == top || !isDir(w) {
			continue
		}
		out = append(out, w)
	}
	return out
}

// gitdirLine reads one of git's pointer files: the first line, with a
// "gitdir: " prefix or without, an absolute path or nothing.
func gitdirLine(file string) (string, bool) {
	f, err := os.Open(file)
	if err != nil {
		return "", false
	}
	defer f.Close()
	buf := make([]byte, maxGitdir+1)
	n, _ := io.ReadFull(f, buf)
	if n > maxGitdir {
		return "", false
	}
	line, _, _ := strings.Cut(string(buf[:n]), "\n")
	line = strings.TrimSpace(strings.TrimPrefix(line, "gitdir:"))
	if !filepath.IsAbs(line) {
		return "", false
	}
	return filepath.Clean(line), true
}

func isDir(dir string) bool {
	info, err := os.Stat(dir)
	return err == nil && info.IsDir()
}

// resolvePreview turns a path as printed into the file it names and says
// whether that file may be served: under one of the roots once every
// symlink is followed, no hidden component below the root unless the
// owner allows them, never a secret by name, a regular file of at most
// wire.MaxFile. An absolute path, or one from home, is taken as it is. A
// relative one is tried from the pane's directory, then from each
// ancestor up to the repository's top, first hit wins; then from the
// repository's other worktrees, where the newest file wins. The last
// answer says where it was found: "" from the pane's directory,
// "ancestor" or "worktree" otherwise.
func resolvePreview(roots []string, hidden bool, cwd, home, path string) (string, string, string, error) {
	if !wire.ValidPath(path) || cwd == "" {
		return "", "", "", errNoPreview
	}
	if filepath.IsAbs(path) || path == "~" || strings.HasPrefix(path, "~/") {
		file, typ, err := serveable(roots, hidden, cwd, home, path)
		return file, typ, "", err
	}
	var best, bestTyp, found string
	var newest time.Time
	for _, b := range bases(cwd) {
		file, typ, err := serveable(roots, hidden, b.dir, home, path)
		if err != nil {
			continue
		}
		if b.found != "worktree" {
			return file, typ, b.found, nil
		}
		info, err := os.Stat(file)
		if err != nil {
			continue
		}
		if best == "" || info.ModTime().After(newest) {
			best, bestTyp, found, newest = file, typ, b.found, info.ModTime()
		}
	}
	if best == "" {
		return "", "", "", errNoPreview
	}
	return best, bestTyp, found, nil
}

// serveable resolves a path from one directory and applies every check a
// served file must pass.
func serveable(roots []string, hidden bool, dir, home, path string) (string, string, error) {
	file, err := resolveUnder(roots, hidden, dir, home, path, false)
	if err != nil || secretName(filepath.Base(file)) {
		return "", "", errNoPreview
	}
	typ := previewType(file)
	info, err := os.Stat(file)
	if err != nil || !info.Mode().IsRegular() || info.Size() > wire.MaxFile {
		return "", "", errNoPreview
	}
	return file, typ, nil
}

// resolveUnder turns a path as printed into the real path it names, from
// the pane's directory (~ from home), and says whether that lies under a
// root once every symlink is followed; the root itself only with self.
func resolveUnder(roots []string, hidden bool, cwd, home, path string, self bool) (string, error) {
	if !wire.ValidPath(path) || cwd == "" {
		return "", errNoPreview
	}
	switch {
	case path == "~" || strings.HasPrefix(path, "~/"):
		if home == "" {
			return "", errNoPreview
		}
		path = filepath.Join(home, path[1:])
	case !filepath.IsAbs(path):
		path = filepath.Join(cwd, path)
	}
	file, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", errNoPreview
	}
	if _, ok := underRoot(roots, file, hidden); !ok && !(self && isRoot(roots, file)) {
		return "", errNoPreview
	}
	return file, nil
}

// isRoot says whether a resolved path is one of the roots itself.
func isRoot(roots []string, file string) bool {
	for _, root := range roots {
		if real, err := filepath.EvalSymlinks(root); err == nil && real == file {
			return true
		}
	}
	return false
}

// underRoot says whether a resolved path lies below one of the roots, and
// answers its path from there: not the root itself, and with no hidden
// component unless hidden is allowed; a hidden directory that keeps
// secrets the usual way (.git, .ssh, .config, …) is never entered.
func underRoot(roots []string, file string, hidden bool) (string, bool) {
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
			if strings.HasPrefix(part, ".") && (!hidden || deniedDir[strings.ToLower(part)]) {
				return "", false
			}
		}
		return rel, true
	}
	return "", false
}

// preview answers the resolved path, where it was found when not from
// the pane's directory, the type and the bytes of a file a pane printed,
// or a code. Every refusal is the one code, so a client learns nothing
// of what is there.
func (a *Agent) preview(ctx context.Context, req wire.Request) (string, string, string, []byte, string) {
	if len(a.cfg.Preview) == 0 {
		return "", "", "", nil, wire.ErrNotAllowed
	}
	p, code := a.find(ctx, req.Pane)
	if code != "" {
		return "", "", "", nil, code
	}
	cwd, err := a.tmux.CurrentPath(ctx, p.PaneID)
	if err != nil {
		return "", "", "", nil, wire.ErrTmux
	}
	home, _ := os.UserHomeDir()
	file, typ, found, err := resolvePreview(a.cfg.Preview, a.cfg.PreviewHidden, cwd, home, req.Path)
	if err != nil {
		return "", "", "", nil, wire.ErrNoFile
	}
	data, err := os.ReadFile(file)
	if err != nil || len(data) > wire.MaxFile {
		return file, found, "", nil, wire.ErrNoFile
	}
	return file, found, typ, data, ""
}
