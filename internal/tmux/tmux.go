// Package tmux talks to a tmux server through its command line. Every call
// passes arguments as a vector, never through a shell, and targets panes by
// the ids tmux itself reported.
package tmux

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
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
	// Printable on purpose: some tmux versions escape control characters in
	// format output. A name that contains it makes its pane unlistable.
	sep = "|mxw|"
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
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var pre []string
	if s.Socket != "" {
		pre = append(pre, "-S", s.Socket)
	} else if s.Name != "" {
		pre = append(pre, "-L", s.Name)
	}
	cmd := exec.CommandContext(ctx, "tmux", append(pre, args...)...)
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
	"#{window_zoomed_flag}",
}

// List returns every pane of the server, marked or not. Lines it cannot
// parse are skipped and counted in skipped.
func (s Server) List(ctx context.Context) (panes []Pane, skipped int, err error) {
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
		if len(f) != len(fields) {
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
			Zoomed: f[18] == "1" && f[9] == "1",
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

// SendText types text literally.
func (s Server) SendText(ctx context.Context, paneID, text string) error {
	_, err := s.run(ctx, "send-keys", "-t", paneID, "-l", "--", text)
	return err
}

// Keys a client may send by name. Anything else is refused.
var Keys = map[string]string{
	"Enter": "Enter", "Tab": "Tab", "BTab": "BTab", "BSpace": "BSpace", "Escape": "Escape",
	"Up": "Up", "Down": "Down", "Left": "Left", "Right": "Right",
	"PageUp": "PageUp", "PageDown": "PageDown", "Home": "Home", "End": "End",
	"C-c": "C-c", "C-d": "C-d", "C-z": "C-z", "C-l": "C-l",
}

// SendKey sends one named key from Keys.
func (s Server) SendKey(ctx context.Context, paneID, key string) error {
	k, ok := Keys[key]
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
	if scaled, err := ScaleLayout(layout, cols, rows); err == nil {
		s.run(ctx, "select-layout", "-t", paneID, scaled)
	}
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

// ResizePane makes one pane cols × rows. On an axis the pane spans, its
// window is sized, as for a window alone; on an axis it shares, the
// neighbours give or take, and the window grows first when they would
// have nothing left. Nothing shrinks the window below what it has.
func (s Server) ResizePane(ctx context.Context, paneID string, cols, rows int) error {
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
// layout, the panes are put back as they were; tmux refuses a layout
// whose panes are not the window's any more, which is then left as is.
func (s Server) ReleaseWindow(ctx context.Context, paneID, layout string) error {
	s.unzoom(ctx, paneID)
	if _, err := s.run(ctx, "resize-window", "-A", "-t", paneID); err != nil {
		return err
	}
	if _, err := s.run(ctx, "set-option", "-w", "-u", "-t", paneID, "window-size"); err != nil {
		return err
	}
	if layout != "" {
		s.run(ctx, "select-layout", "-t", paneID, layout)
	}
	return nil
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
