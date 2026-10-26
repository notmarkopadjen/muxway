// Package tmux talks to a tmux server through its command line. Every call
// passes arguments as a vector, never through a shell, and targets panes by
// the ids tmux itself reported.
package tmux

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// Modes a mark can have. The most specific mark wins: pane, then window,
// then session.
const (
	ModeRead  = "read"
	ModeWrite = "write"
	ModeDeny  = "deny"
)

const (
	optMode  = "@muxway-mode"
	optAlias = "@muxway-alias"
)

// listSep is the field separator of one listing. It is random each time:
// a process can name itself anything, newline and all, and tmux prints
// the name as is, so a fixed separator would let a program in one pane
// forge a whole record for another pane. A name that happens to contain
// the separator makes its pane unlistable, nothing more.
func listSep() string {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return "|" + hex.EncodeToString(b[:]) + "|"
}

// tmux's own ids: $1, @2, %3. Anything else in those fields is a forgery.
var (
	sessionIDShape = regexp.MustCompile(`^\$[0-9]+$`)
	windowIDShape  = regexp.MustCompile(`^@[0-9]+$`)
	paneIDShape    = regexp.MustCompile(`^%[0-9]+$`)
)

// ErrUnparsed counts list lines that could not be split into fields.
var ErrUnparsed = errors.New("tmux list line with an unexpected number of fields")

// Server is one tmux server, chosen by socket path or socket name. Both
// empty means tmux's default, which inside tmux is the current server.
type Server struct {
	Socket string // -S
	Name   string // -L
}

func (s Server) run(ctx context.Context, args ...string) ([]byte, error) {
	return s.runIn(ctx, nil, args...)
}

// runIn runs a tmux command with stdin, for load-buffer.
func (s Server) runIn(ctx context.Context, stdin []byte, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var pre []string
	if s.Socket != "" {
		pre = append(pre, "-S", s.Socket)
	} else if s.Name != "" {
		pre = append(pre, "-L", s.Name)
	}
	cmd := exec.CommandContext(ctx, "tmux", append(pre, args...)...)
	if stdin != nil {
		cmd.Stdin = bytes.NewReader(stdin)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return nil, errors.New("tmux: " + msg)
	}
	return out, nil
}

// Pane is one pane with its place in the tree and its resolved mark.
type Pane struct {
	SessionID    string     `json:"session_id"`
	SessionName  string     `json:"session"`
	WindowID     string     `json:"window_id"`
	WindowIndex  int        `json:"window_index"`
	WindowName   string     `json:"window"`
	WindowLayout string     `json:"window_layout"`
	WindowActive bool       `json:"window_active"`
	PaneID       string     `json:"pane_id"`
	PaneIndex    int        `json:"pane_index"`
	PaneActive   bool       `json:"pane_active"`
	Width        int        `json:"width"`
	Height       int        `json:"height"`
	Title        string     `json:"title"`
	Command      string     `json:"command"`
	Activity     int64      `json:"activity"`
	Mode         string     `json:"mode"`
	Alias        string     `json:"alias,omitempty"`
	Attention    *Attention `json:"attention,omitempty"`
	Zoomed       bool       `json:"zoomed,omitempty"` // shown alone in its window
	Mouse        bool       `json:"mouse,omitempty"`  // the program asked for the mouse
	PID          int        `json:"-"`
}

// Attention is what a pane is waiting for: set by a notification from a
// process in the pane, cleared by input or by a "working" notification.
type Attention struct {
	Kind string `json:"kind"`
	At   int64  `json:"at"`
	Text string `json:"text,omitempty"`
}

var fields = []string{
	"#{session_id}", "#{session_name}", "#{window_id}", "#{window_index}", "#{window_name}",
	"#{window_layout}", "#{window_active}", "#{pane_id}", "#{pane_index}", "#{pane_active}",
	"#{pane_width}", "#{pane_height}", "#{pane_title}", "#{pane_current_command}",
	"#{window_activity}", "#{" + optMode + "}", "#{" + optAlias + "}", "#{pane_pid}",
	"#{window_zoomed_flag}", "#{mouse_any_flag}#{mouse_button_flag}#{mouse_standard_flag}#{mouse_all_flag}",
}

// List returns every pane of the server, marked or not. Lines it cannot
// parse are skipped and counted in skipped.
func (s Server) List(ctx context.Context) (panes []Pane, skipped int, err error) {
	sep := listSep()
	out, err := s.run(ctx, "list-panes", "-a", "-F", strings.Join(fields, sep))
	if err != nil {
		if strings.Contains(err.Error(), "no server running") || strings.Contains(err.Error(), "No such file") ||
			strings.Contains(err.Error(), "error connecting") {
			return nil, 0, nil
		}
		return nil, 0, err
	}
	for _, line := range strings.Split(strings.TrimRight(string(out), "\n"), "\n") {
		if line == "" {
			continue
		}
		f := strings.Split(line, sep)
		if len(f) != len(fields) || !sessionIDShape.MatchString(f[0]) || !windowIDShape.MatchString(f[2]) ||
			!paneIDShape.MatchString(f[7]) {
			skipped++
			continue
		}
		atoi := func(s string) int { n, _ := strconv.Atoi(s); return n }
		act, _ := strconv.ParseInt(f[14], 10, 64)
		panes = append(panes, Pane{
			SessionID: f[0], SessionName: f[1], WindowID: f[2], WindowIndex: atoi(f[3]), WindowName: f[4],
			WindowLayout: f[5], WindowActive: f[6] == "1", PaneID: f[7], PaneIndex: atoi(f[8]),
			PaneActive: f[9] == "1", Width: atoi(f[10]), Height: atoi(f[11]), Title: f[12], Command: f[13],
			Activity: act, Mode: f[15], Alias: f[16], PID: atoi(f[17]),
			Zoomed: f[18] == "1" && f[9] == "1", Mouse: strings.Contains(f[19], "1"),
		})
	}
	return panes, skipped, nil
}

// Exposed reports whether a resolved mark grants any access.
func (p Pane) Exposed() bool { return p.Mode == ModeRead || p.Mode == ModeWrite }

// Capture returns the last `lines` lines of a pane, with escape sequences
// for colours when ansi is set.
func (s Server) Capture(ctx context.Context, paneID string, lines int, ansi bool) (string, error) {
	args := []string{"capture-pane", "-p", "-J", "-t", paneID, "-S", "-" + strconv.Itoa(lines)}
	if ansi {
		args = append(args, "-e")
	}
	out, err := s.run(ctx, args...)
	if err != nil {
		return "", err
	}
	all := strings.Split(strings.TrimRight(string(out), "\n"), "\n")
	if len(all) > lines {
		all = all[len(all)-lines:]
	}
	return strings.Join(all, "\n"), nil
}

// SendText types text literally; a text with newlines is pasted instead.
func (s Server) SendText(ctx context.Context, paneID, text string) error {
	if strings.Contains(text, "\n") {
		return s.paste(ctx, paneID, text)
	}
	_, err := s.run(ctx, "send-keys", "-t", paneID, "-l", "--", text)
	return err
}

var pasteSeq atomic.Uint64

// paste delivers a text with newlines as one paste through a tmux buffer:
// the program gets it between the bracketed paste marks when it asked for
// them, as a block it can edit before Enter; otherwise as typed, newlines
// included. The buffer is deleted with the paste.
func (s Server) paste(ctx context.Context, paneID, text string) error {
	name := fmt.Sprintf("muxway-%d", pasteSeq.Add(1))
	if _, err := s.runIn(ctx, []byte(text), "load-buffer", "-b", name, "-"); err != nil {
		return err
	}
	if _, err := s.run(ctx, "paste-buffer", "-p", "-d", "-b", name, "-t", paneID); err != nil {
		s.run(ctx, "delete-buffer", "-b", name)
		return err
	}
	return nil
}

// ErrNoMouse: the program in the pane did not ask for the mouse, so the
// bytes would be typed as text.
var ErrNoMouse = errors.New("no mouse mode in the pane")

// SendMouse clicks, or turns the wheel, at a cell, in the encoding the
// program asked for: SGR, or the old one with its 223-cell reach.
func (s Server) SendMouse(ctx context.Context, paneID string, button, x, y int) error {
	out, err := s.run(ctx, "display-message", "-p", "-t", paneID,
		"#{mouse_any_flag}#{mouse_button_flag}#{mouse_standard_flag}#{mouse_all_flag} #{mouse_sgr_flag}")
	if err != nil {
		return err
	}
	modes, sgr, _ := strings.Cut(strings.TrimSpace(string(out)), " ")
	if !strings.Contains(modes, "1") {
		return ErrNoMouse
	}
	wheel := button >= 64
	var seq string
	switch {
	case sgr == "1":
		seq = fmt.Sprintf("[<%d;%d;%dM", button, x, y)
		if !wheel {
			seq += fmt.Sprintf("[<%d;%d;%dm", button, x, y)
		}
	case x > 223 || y > 223:
		return ErrNoMouse
	default:
		seq = fmt.Sprintf("[M%c%c%c", 32+button, 32+x, 32+y)
		if !wheel {
			seq += fmt.Sprintf("[M%c%c%c", 32+3, 32+x, 32+y)
		}
	}
	_, err = s.run(ctx, "send-keys", "-t", paneID, "-l", "--", seq)
	return err
}

// Keys a client may send by name: a named key, a keypad key, or a
// character with Ctrl or Alt, after modifiers C-, M-, S- in that order,
// each once. KeyName gives tmux's own name for one, or false. Anything
// else is refused: tmux types a name it does not know as text, and reads
// `;` as the end of a command, so the grammar is all that stands between
// a client and tmux's command line.
var named = map[string]string{
	"Enter": "Enter", "Tab": "Tab", "BTab": "BTab", "BSpace": "BSpace", "Escape": "Escape", "Space": "Space",
	"Up": "Up", "Down": "Down", "Left": "Left", "Right": "Right",
	"PageUp": "PageUp", "PageDown": "PageDown", "Home": "Home", "End": "End",
	"Insert": "IC", "Delete": "DC",
	"F1": "F1", "F2": "F2", "F3": "F3", "F4": "F4", "F5": "F5", "F6": "F6",
	"F7": "F7", "F8": "F8", "F9": "F9", "F10": "F10", "F11": "F11", "F12": "F12",
	"KP0": "KP0", "KP1": "KP1", "KP2": "KP2", "KP3": "KP3", "KP4": "KP4",
	"KP5": "KP5", "KP6": "KP6", "KP7": "KP7", "KP8": "KP8", "KP9": "KP9",
	"KP/": "KP/", "KP*": "KP*", "KP-": "KP-", "KP+": "KP+", "KP.": "KP.", "KPEnter": "KPEnter",
}

// Characters that go with Ctrl or Alt: unshifted, no `;`.
const chordChars = "abcdefghijklmnopqrstuvwxyz0123456789`-=[]\\',./"

func KeyName(key string) (string, bool) {
	if len(key) > 16 {
		return "", false
	}
	rest := key
	ctrl, meta, shift := false, false, false
	if strings.HasPrefix(rest, "C-") {
		ctrl, rest = true, rest[2:]
	}
	if strings.HasPrefix(rest, "M-") {
		meta, rest = true, rest[2:]
	}
	if strings.HasPrefix(rest, "S-") {
		shift, rest = true, rest[2:]
	}
	mods := key[:len(key)-len(rest)]
	if name, ok := named[rest]; ok {
		return mods + name, true
	}
	if len(rest) == 1 && strings.IndexByte(chordChars, rest[0]) >= 0 && (ctrl || meta) && !shift {
		return mods + rest, true
	}
	return "", false
}

// SendKey sends one key a client named; KeyName says which.
func (s Server) SendKey(ctx context.Context, paneID, key string) error {
	k, ok := KeyName(key)
	if !ok {
		return fmt.Errorf("unknown key")
	}
	_, err := s.run(ctx, "send-keys", "-t", paneID, k)
	return err
}

// ResizeWindow sets the size of the window holding paneID and lays its
// panes out inside in the proportions of layout, or, without one, the
// proportions they had: tmux's own resize does not keep them. With zoom
// the pane is then shown alone; without, a zoom is undone. The window
// keeps that size until released.
func (s Server) ResizeWindow(ctx context.Context, paneID string, cols, rows int, layout string, zoom bool) error {
	if layout == "" {
		layout, _ = s.WindowLayout(ctx, paneID)
	}
	s.unzoom(ctx, paneID)
	if _, err := s.run(ctx, "resize-window", "-t", paneID, "-x", strconv.Itoa(cols), "-y", strconv.Itoa(rows)); err != nil {
		return err
	}
	s.lay(ctx, paneID, layout, cols, rows)
	if zoom {
		_, err := s.run(ctx, "resize-pane", "-Z", "-t", paneID)
		return err
	}
	return nil
}

// unzoom undoes a zoom in the window holding paneID, whichever pane has it.
func (s Server) unzoom(ctx context.Context, paneID string) {
	out, err := s.run(ctx, "display-message", "-p", "-t", paneID, "#{window_zoomed_flag}")
	if err == nil && strings.TrimSpace(string(out)) == "1" {
		s.run(ctx, "resize-pane", "-Z", "-t", paneID)
	}
}

// A pane fit leaves every other pane of the window at least this much.
const (
	floorCols = 20
	floorRows = 5
)

// ResizePane makes one pane cols × rows. On an axis the pane spans, its
// window is sized, as for a window alone; on an axis it shares, the
// neighbours give or take, and the window grows before any of them goes
// under the floor. Nothing shrinks the window below what it has.
func (s Server) ResizePane(ctx context.Context, paneID string, cols, rows int) error {
	for round := 0; ; round++ {
		if err := s.resizePaneOnce(ctx, paneID, cols, rows); err != nil {
			return err
		}
		// Growing the window scales every pane alike, so the window is
		// grown by what brings the smallest pane up to the floor; the
		// pane is then sized again and its surplus goes to a neighbour.
		out, err := s.run(ctx, "list-panes", "-t", paneID,
			"-F", "#{window_width} #{window_height} #{pane_width} #{pane_height}")
		if err != nil {
			return err
		}
		var ww, wh, nw, nh int
		for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			var w, h int
			if _, err := fmt.Sscan(line, &ww, &wh, &w, &h); err != nil {
				continue
			}
			if w < floorCols {
				nw = max(nw, (ww*floorCols+w-1)/w+1)
			}
			if h < floorRows {
				nh = max(nh, (wh*floorRows+h-1)/h+1)
			}
		}
		if (nw == 0 && nh == 0) || round == 3 {
			return nil
		}
		if err := s.ResizeWindow(ctx, paneID, max(nw, ww), max(nh, wh), "", false); err != nil {
			return err
		}
	}
}

func (s Server) resizePaneOnce(ctx context.Context, paneID string, cols, rows int) error {
	out, err := s.run(ctx, "display-message", "-p", "-t", paneID,
		"#{window_width} #{window_height} #{pane_width} #{pane_height}")
	if err != nil {
		return err
	}
	var ww, wh, pw, ph int
	if _, err := fmt.Sscan(string(out), &ww, &wh, &pw, &ph); err != nil {
		return fmt.Errorf("window size: %q", out)
	}
	axis := func(want, pane, window int) int {
		if pane >= window {
			return want
		}
		if want > pane {
			return window + want - pane
		}
		return window
	}
	nw, nh := axis(cols, pw, ww), axis(rows, ph, wh)
	if nw != ww || nh != wh {
		if err := s.ResizeWindow(ctx, paneID, nw, nh, "", false); err != nil {
			return err
		}
	}
	if pw >= ww && ph >= wh {
		return nil
	}
	_, err = s.run(ctx, "resize-pane", "-t", paneID, "-x", strconv.Itoa(cols), "-y", strconv.Itoa(rows))
	return err
}

// WindowLayout is the layout string of the window holding paneID.
func (s Server) WindowLayout(ctx context.Context, paneID string) (string, error) {
	out, err := s.run(ctx, "display-message", "-p", "-t", paneID, "#{window_layout}")
	return strings.TrimSpace(string(out)), err
}

// ReleaseWindow gives the window holding paneID back to automatic sizing:
// first to the largest session's size, then the manual mark is removed.
// The other way round, resize-window would set the mark again. With a
// layout, the panes get its proportions back, when the window still has
// its shape.
func (s Server) ReleaseWindow(ctx context.Context, paneID, layout string) error {
	s.unzoom(ctx, paneID)
	if _, err := s.run(ctx, "resize-window", "-A", "-t", paneID); err != nil {
		return err
	}
	if _, err := s.run(ctx, "set-option", "-w", "-u", "-t", paneID, "window-size"); err != nil {
		return err
	}
	// Panes moved since, at the host or by a client, stay where they are.
	live, _ := s.WindowLayout(ctx, paneID)
	if layout != "" && SameShape(layout, live) {
		if w, h, err := s.windowSize(ctx, paneID); err == nil {
			s.lay(ctx, paneID, layout, w, h)
		}
	}
	return nil
}

// ArrangeWindow lays the window holding paneID out as layout at the size
// the window has, panes where the layout names them.
func (s Server) ArrangeWindow(ctx context.Context, paneID, layout string) error {
	s.unzoom(ctx, paneID)
	w, h, err := s.windowSize(ctx, paneID)
	if err != nil {
		return err
	}
	return s.lay(ctx, paneID, layout, w, h)
}

func (s Server) windowSize(ctx context.Context, paneID string) (int, int, error) {
	out, err := s.run(ctx, "display-message", "-p", "-t", paneID, "#{window_width} #{window_height}")
	if err != nil {
		return 0, 0, err
	}
	var w, h int
	if _, err := fmt.Sscanf(strings.TrimSpace(string(out)), "%d %d", &w, &h); err != nil {
		return 0, 0, err
	}
	return w, h, nil
}

// lay scales layout to w×h and selects it. tmux fills a layout's places
// with the window's panes in its own order and ignores the ids written in
// it, so the panes are first swapped into the layout's order.
func (s Server) lay(ctx context.Context, paneID, layout string, w, h int) error {
	root, err := parseLayout(layout)
	if err != nil {
		return err
	}
	if err := root.scale(w, h, 0, 0); err != nil {
		return err
	}
	out, err := s.run(ctx, "list-panes", "-t", paneID, "-F", "#{pane_id}")
	if err != nil {
		return err
	}
	have := strings.Fields(string(out))
	want := layoutOrder(root)
	if len(have) != len(want) {
		return fmt.Errorf("layout: %d panes for a window of %d", len(want), len(have))
	}
	for i := range want {
		if have[i] == want[i] {
			continue
		}
		j := slices.Index(have, want[i])
		if j < 0 {
			return fmt.Errorf("layout: %s is not in the window", want[i])
		}
		if _, err := s.run(ctx, "swap-pane", "-d", "-s", want[i], "-t", have[i]); err != nil {
			return err
		}
		have[i], have[j] = have[j], have[i]
	}
	_, err = s.run(ctx, "select-layout", "-t", paneID, root.String())
	return err
}

// Scope of a target: a session, a window or a pane.
func Scope(target string) string {
	switch {
	case strings.Contains(target, "."):
		return "pane"
	case strings.Contains(target, ":"):
		return "window"
	default:
		return "session"
	}
}

func scopeFlag(scope string) []string {
	switch scope {
	case "pane":
		return []string{"-p"}
	case "window":
		return []string{"-w"}
	}
	return nil
}

// Mark sets the mode on a session, window or pane; mode "" removes it.
func (s Server) Mark(ctx context.Context, target, mode string) error {
	if _, err := s.run(ctx, "display-message", "-p", "-t", target, "#{pane_id}"); err != nil {
		return err
	}
	args := append([]string{"set-option"}, scopeFlag(Scope(target))...)
	if mode == "" {
		args = append(args, "-u", "-t", target, optMode)
	} else {
		args = append(args, "-t", target, optMode, mode)
	}
	_, err := s.run(ctx, args...)
	return err
}

// SetAlias names a pane for short addresses; "" removes the name.
func (s Server) SetAlias(ctx context.Context, target, alias string) error {
	if Scope(target) != "pane" {
		return errors.New("an alias names one pane: use session:window.pane")
	}
	if alias == "" {
		_, err := s.run(ctx, "set-option", "-p", "-u", "-t", target, optAlias)
		return err
	}
	_, err := s.run(ctx, "set-option", "-p", "-t", target, optAlias, alias)
	return err
}

// Address is a pane's human address within its host.
func (p Pane) Address() string {
	return fmt.Sprintf("%s/%d.%d", p.SessionName, p.WindowIndex, p.PaneIndex)
}

// Split makes one more pane out of paneID's room, beside it or below,
// in the same directory, without taking the host's focus. A mark set on
// the pane itself goes onto the new one; one on the window or session
// covers it already. Returns the new pane's id.
func (s Server) Split(ctx context.Context, paneID string, beside bool) (string, error) {
	out, err := s.run(ctx, "display-message", "-p", "-t", paneID, "#{pane_current_path}")
	if err != nil {
		return "", err
	}
	args := []string{"split-window", "-d", "-t", paneID, "-P", "-F", "#{pane_id}"}
	if dir := strings.TrimSpace(string(out)); dir != "" {
		args = append(args, "-c", dir)
	}
	if beside {
		args = append(args, "-h")
	} else {
		args = append(args, "-v")
	}
	out, err = s.run(ctx, args...)
	if err != nil {
		return "", err
	}
	id := strings.TrimSpace(string(out))
	if mode, _ := s.paneMark(ctx, paneID); mode != "" {
		if _, err := s.run(ctx, "set-option", "-p", "-t", id, optMode, mode); err != nil {
			s.run(ctx, "kill-pane", "-t", id)
			return "", err
		}
	}
	return id, nil
}

// paneMark is the mode set on the pane itself, not one it inherits.
func (s Server) paneMark(ctx context.Context, paneID string) (string, error) {
	out, err := s.run(ctx, "show-options", "-p", "-q", "-v", "-t", paneID, optMode)
	return strings.TrimSpace(string(out)), err
}

// HasSession reports whether a session of exactly that name exists.
func (s Server) HasSession(ctx context.Context, name string) bool {
	_, err := s.run(ctx, "has-session", "-t", "="+name)
	return err == nil
}

// NewSession starts a detached session with the server's default shell
// and marks it writable. Returns the id of its first pane.
func (s Server) NewSession(ctx context.Context, name string) (string, error) {
	out, err := s.run(ctx, "new-session", "-d", "-s", name, "-P", "-F", "#{pane_id}")
	if err != nil {
		return "", err
	}
	id := strings.TrimSpace(string(out))
	if _, err := s.run(ctx, "set-option", "-t", id, optMode, ModeWrite); err != nil {
		s.run(ctx, "kill-pane", "-t", id)
		return "", err
	}
	return id, nil
}

// KillPane closes one pane; the last pane of a session ends the session.
func (s Server) KillPane(ctx context.Context, paneID string) error {
	_, err := s.run(ctx, "kill-pane", "-t", paneID)
	return err
}
