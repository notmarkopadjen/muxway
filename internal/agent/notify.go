package agent

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"time"

	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

// Processes in a pane notify the agent through a Unix socket in its
// directory. Only the directory's owner can reach it, and only exposed
// panes get through to the hub. A question with choices (muxway ask)
// holds its connection until a client answers, the time runs out, or
// the owner types into the pane.

// NotifyRequest is one notification: which pane, what kind, a short text.
// With Ask, the choices a client may answer with, and how long to wait.
type NotifyRequest struct {
	Pane    string   `json:"pane"`
	Kind    string   `json:"kind"`
	Text    string   `json:"text,omitempty"`
	Choices []string `json:"choices,omitempty"`
	Ask     bool     `json:"ask,omitempty"`
	Timeout int      `json:"timeout,omitempty"` // seconds
}

type notifyResponse struct {
	OK     bool   `json:"ok,omitempty"`
	Error  string `json:"error,omitempty"`
	Answer string `json:"answer,omitempty"`
}

// How an ask ends without an answer, as the asking command sees it.
const (
	AskTimeout  = "timeout"  // nobody answered in time
	AskTyped    = "typed"    // the owner typed into the pane, or the program went on
	AskReplaced = "replaced" // a later ask on the same pane
	AskGone     = "gone"     // the pane went away
	MaxAskWait  = 24 * time.Hour
)

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
		go a.serveOne(ctx, c)
	}
}

func (a *Agent) serveOne(ctx context.Context, c net.Conn) {
	defer c.Close()
	c.SetDeadline(time.Now().Add(10 * time.Second))
	rd := bufio.NewReader(io.LimitReader(c, 64<<10))
	var req NotifyRequest
	if err := json.NewDecoder(rd).Decode(&req); err != nil {
		json.NewEncoder(c).Encode(notifyResponse{Error: "bad_json"})
		return
	}
	if !req.Ask {
		resp := notifyResponse{OK: true}
		if code := a.Notify(ctx, req, sourceHook); code != "" {
			resp = notifyResponse{Error: code}
		}
		json.NewEncoder(c).Encode(resp)
		return
	}
	wait, code := a.ask(ctx, req)
	if code != "" {
		json.NewEncoder(c).Encode(notifyResponse{Error: code})
		return
	}
	// The asker may give up (Ctrl-C) before anyone answers: the socket
	// closing is the only word of it.
	c.SetDeadline(time.Time{})
	closed := make(chan struct{})
	go func() {
		io.Copy(io.Discard, rd)
		close(closed)
	}()
	var resp notifyResponse
	select {
	case r := <-wait:
		if r.err != "" {
			resp.Error = r.err
		} else {
			resp.OK, resp.Answer = true, r.answer
		}
	case <-closed:
		a.endAsk(ctx, req.Pane, AskGone, false)
		return
	case <-ctx.Done():
		return
	}
	c.SetDeadline(time.Now().Add(10 * time.Second))
	json.NewEncoder(c).Encode(resp)
}

// Where a notification comes from: a process over the socket (a hook or
// a script), or the agent's own watcher. Hooks win: a pane that spoke for
// itself is left alone by the watcher.
const (
	sourceHook    = "hook"
	sourceWatcher = "watcher"
)

// Notify records attention for an exposed pane and tells the hub. It
// returns an error code, or "" when the event was accepted.
func (a *Agent) Notify(ctx context.Context, req NotifyRequest, source string) string {
	req.Text = wire.CleanText(req.Text)
	if !paneID.MatchString(req.Pane) || !wire.KnownKind(req.Kind) || req.Choices != nil {
		a.log.Info("notify refused", "pane", req.Pane, "kind", req.Kind, "result", wire.ErrBadInput)
		return wire.ErrBadInput
	}
	p, code := a.find(ctx, req.Pane)
	if code != "" {
		a.log.Info("notify refused", "pane", req.Pane, "kind", req.Kind, "result", code)
		return code
	}
	a.mu.Lock()
	if source == sourceHook {
		a.hooked[p.PaneID] = true
	}
	// Claude Code's idle notice does not know about background work; while
	// that runs, the pane is not waiting for its owner.
	if req.Kind == wire.KindIdle && a.background[p.PaneID] {
		a.mu.Unlock()
		a.log.Info("notify dropped, background work running", "pane", p.PaneID, "kind", req.Kind)
		return ""
	}
	a.background[p.PaneID] = req.Kind == wire.KindWorking && req.Text != ""
	if req.Kind == wire.KindWorking {
		delete(a.attention, p.PaneID)
		p.Attention = nil
	} else {
		att := tmux.Attention{Kind: req.Kind, At: time.Now().Unix(), Text: req.Text}
		a.attention[p.PaneID] = att
		p.Attention = &att
	}
	pending := a.asks[p.PaneID]
	if req.Kind == wire.KindWorking {
		delete(a.asks, p.PaneID)
	}
	a.mu.Unlock()
	// The program went on: a question it left behind is over.
	if pending != nil && req.Kind == wire.KindWorking {
		pending.finish(askResult{err: AskTyped})
	}
	a.log.Info("notify", "pane", p.PaneID, "kind", req.Kind, "source", source, "result", "ok")
	a.send(ctx, p, req.Kind, req.Text)
	return ""
}

// send tells the hub about a pane's event, when it is there to tell.
func (a *Agent) send(ctx context.Context, p tmux.Pane, kind, text string) {
	a.mu.Lock()
	sess := a.sess
	a.mu.Unlock()
	if sess == nil {
		a.log.Warn("hub away, attention kept for the next listing", "pane", p.PaneID)
		return
	}
	raw, _ := json.Marshal(wire.Notice{Event: &wire.Event{Pane: p, Kind: kind, Text: text}})
	if err := sess.Write(ctx, raw); err != nil {
		a.log.Warn("event not sent", "pane", p.PaneID, "err", err)
	}
}

type askResult struct {
	answer string
	err    string
}

// An ask waits for one answer; finish delivers it once.
type pendingAsk struct {
	choices []string
	ch      chan askResult
	timer   *time.Timer
}

func (q *pendingAsk) finish(r askResult) {
	if q.timer != nil {
		q.timer.Stop()
	}
	select {
	case q.ch <- r:
	default:
	}
}

// ask records a question with choices on an exposed pane and returns the
// channel its answer arrives on, or an error code.
func (a *Agent) ask(ctx context.Context, req NotifyRequest) (<-chan askResult, string) {
	req.Text = wire.CleanText(req.Text)
	if !paneID.MatchString(req.Pane) || req.Kind != wire.KindQuestion || !wire.ValidChoices(req.Choices) ||
		req.Timeout < 0 || time.Duration(req.Timeout)*time.Second > MaxAskWait {
		a.log.Info("ask refused", "pane", req.Pane, "result", wire.ErrBadInput)
		return nil, wire.ErrBadInput
	}
	p, code := a.find(ctx, req.Pane)
	if code == "" && p.Mode != tmux.ModeWrite {
		// Nobody could answer: a read-only pane takes no input of any kind.
		code = wire.ErrReadOnly
	}
	if code != "" {
		a.log.Info("ask refused", "pane", req.Pane, "result", code)
		return nil, code
	}
	q := &pendingAsk{choices: slices.Clone(req.Choices), ch: make(chan askResult, 1)}
	if req.Timeout > 0 {
		q.timer = time.AfterFunc(time.Duration(req.Timeout)*time.Second, func() { a.endAsk(ctx, p.PaneID, AskTimeout, true) })
	}
	att := tmux.Attention{Kind: wire.KindQuestion, At: time.Now().Unix(), Text: req.Text, Choices: q.choices}
	a.mu.Lock()
	a.hooked[p.PaneID] = true
	old := a.asks[p.PaneID]
	a.asks[p.PaneID] = q
	a.attention[p.PaneID] = att
	delete(a.background, p.PaneID)
	a.mu.Unlock()
	if old != nil {
		old.finish(askResult{err: AskReplaced})
	}
	p.Attention = &att
	a.log.Info("ask", "pane", p.PaneID, "choices", len(q.choices), "result", "ok")
	a.send(ctx, p, wire.KindQuestion, req.Text)
	return q.ch, ""
}

// endAsk closes a pane's question without an answer. With clear, the
// attention goes too and the hub hears of it.
func (a *Agent) endAsk(ctx context.Context, paneID, why string, clear bool) {
	a.mu.Lock()
	q := a.asks[paneID]
	delete(a.asks, paneID)
	if clear && q != nil {
		delete(a.attention, paneID)
	}
	a.mu.Unlock()
	if q == nil {
		return
	}
	q.finish(askResult{err: why})
	a.log.Info("ask ended", "pane", paneID, "why", why)
	if clear {
		if p, code := a.find(ctx, paneID); code == "" {
			a.send(ctx, p, wire.KindWorking, "")
		}
	}
}

// answer resolves a pane's question with one of its choices, for the hub.
func (a *Agent) answer(ctx context.Context, req wire.Request) string {
	p, code := a.find(ctx, req.Pane)
	if code != "" {
		return code
	}
	if p.Mode != tmux.ModeWrite {
		return wire.ErrReadOnly
	}
	a.mu.Lock()
	q := a.asks[p.PaneID]
	if q == nil {
		a.mu.Unlock()
		return wire.ErrNoQuestion
	}
	if !slices.Contains(q.choices, req.Choice) {
		a.mu.Unlock()
		return wire.ErrBadInput
	}
	delete(a.asks, p.PaneID)
	delete(a.attention, p.PaneID)
	a.mu.Unlock()
	q.finish(askResult{answer: req.Choice})
	return ""
}

// SendNotify delivers one notification to the agent running in dir.
func SendNotify(dir string, req NotifyRequest) error {
	_, err := Exchange(dir, req)
	return err
}

// Exchange sends one request to the agent and returns its answer; for an
// ask, that is after the question was answered or ended.
func Exchange(dir string, req NotifyRequest) (string, error) {
	c, err := net.DialTimeout("unix", notifyPath(dir), 5*time.Second)
	if err != nil {
		return "", errors.New("no agent running in " + dir)
	}
	defer c.Close()
	if req.Ask {
		c.SetDeadline(time.Now().Add(time.Duration(req.Timeout)*time.Second + MaxAskWait))
	} else {
		c.SetDeadline(time.Now().Add(10 * time.Second))
	}
	if err := json.NewEncoder(c).Encode(req); err != nil {
		return "", err
	}
	var resp notifyResponse
	if err := json.NewDecoder(c).Decode(&resp); err != nil {
		return "", errors.New("the agent went away")
	}
	if resp.Error != "" {
		return "", errors.New(resp.Error)
	}
	return resp.Answer, nil
}
