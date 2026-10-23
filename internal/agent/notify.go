package agent

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

// Processes in a pane notify the agent through a Unix socket in its
// directory. Only the directory's owner can reach it, and only exposed
// panes get through to the hub.

// NotifyRequest is one notification: which pane, what kind, a short text.
type NotifyRequest struct {
	Pane string `json:"pane"`
	Kind string `json:"kind"`
	Text string `json:"text,omitempty"`
}

type notifyResponse struct {
	OK    bool   `json:"ok,omitempty"`
	Error string `json:"error,omitempty"`
}

var paneID = regexp.MustCompile(`^%[0-9]{1,9}$`)

func notifyPath(dir string) string { return filepath.Join(dir, "notify.sock") }

func (a *Agent) listenNotify() (net.Listener, error) {
	path := notifyPath(a.cfg.Dir)
	os.Remove(path)
	ln, err := net.Listen("unix", path)
	if err != nil {
		return nil, err
	}
	return ln, os.Chmod(path, 0o600)
}

func (a *Agent) serveNotify(ctx context.Context, ln net.Listener) {
	for {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		go func() {
			defer c.Close()
			c.SetDeadline(time.Now().Add(10 * time.Second))
			var req NotifyRequest
			if err := json.NewDecoder(bufio.NewReader(c)).Decode(&req); err != nil {
				json.NewEncoder(c).Encode(notifyResponse{Error: "bad_json"})
				return
			}
			resp := notifyResponse{OK: true}
			if code := a.Notify(ctx, req); code != "" {
				resp = notifyResponse{Error: code}
			}
			json.NewEncoder(c).Encode(resp)
		}()
	}
}

// Notify records attention for an exposed pane and tells the hub. It
// returns an error code, or "" when the event was accepted.
func (a *Agent) Notify(ctx context.Context, req NotifyRequest) string {
	req.Text = wire.CleanText(req.Text)
	if !paneID.MatchString(req.Pane) || !wire.KnownKind(req.Kind) {
		a.log.Info("notify refused", "pane", req.Pane, "kind", req.Kind, "result", wire.ErrBadInput)
		return wire.ErrBadInput
	}
	p, code := a.find(ctx, req.Pane)
	if code != "" {
		a.log.Info("notify refused", "pane", req.Pane, "kind", req.Kind, "result", code)
		return code
	}
	a.mu.Lock()
	if req.Kind == wire.KindWorking {
		delete(a.attention, p.PaneID)
		p.Attention = nil
	} else {
		att := tmux.Attention{Kind: req.Kind, At: time.Now().Unix(), Text: req.Text}
		a.attention[p.PaneID] = att
		p.Attention = &att
	}
	sess := a.sess
	a.mu.Unlock()
	a.log.Info("notify", "pane", p.PaneID, "kind", req.Kind, "result", "ok")
	if sess == nil {
		a.log.Warn("hub away, attention kept for the next listing", "pane", p.PaneID)
		return ""
	}
	raw, _ := json.Marshal(wire.Notice{Event: &wire.Event{Pane: p, Kind: req.Kind, Text: req.Text}})
	if err := sess.Write(ctx, raw); err != nil {
		a.log.Warn("event not sent", "pane", p.PaneID, "err", err)
	}
	return ""
}

// SendNotify delivers one notification to the agent running in dir.
func SendNotify(dir string, req NotifyRequest) error {
	c, err := net.DialTimeout("unix", notifyPath(dir), 5*time.Second)
	if err != nil {
		return errors.New("no agent running in " + dir)
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(10 * time.Second))
	if err := json.NewEncoder(c).Encode(req); err != nil {
		return err
	}
	var resp notifyResponse
	if err := json.NewDecoder(c).Decode(&resp); err != nil {
		return err
	}
	if resp.Error != "" {
		return errors.New(resp.Error)
	}
	return nil
}
