// Package agent runs next to tmux. It connects out to its hub, proves who
// it is, and answers the hub's three requests for the panes its owner
// exposed. It enforces exposure and modes itself, whatever the hub asks.
// Processes in a pane can hand it a notification, which it forwards to the
// hub as an event for the exposed panes only.
package agent

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/notmarkopadjen/muxway/internal/secure"
	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

// Config is agent.json in the agent's directory.
type Config struct {
	HubURL string `json:"hub_url"`
	HubKey string `json:"hub_key"`
	Host   string `json:"host"`
	CAFile string `json:"ca_file,omitempty"`
	Dir    string `json:"-"`
}

func configPath(dir string) string { return filepath.Join(dir, "agent.json") }
func keyPath(dir string) string    { return filepath.Join(dir, "agent.key") }

// LoadConfig reads the agent's directory.
func LoadConfig(dir string) (Config, ed25519.PrivateKey, error) {
	var c Config
	raw, err := os.ReadFile(configPath(dir))
	if err != nil {
		return c, nil, fmt.Errorf("not paired yet: %w", err)
	}
	if err := json.Unmarshal(raw, &c); err != nil {
		return c, nil, err
	}
	key, err := secure.LoadOrCreateKey(keyPath(dir))
	c.Dir = dir
	return c, key, err
}

// checkURL allows plain http only to loopback.
func checkURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return nil, errors.New("bad hub url")
	}
	switch u.Scheme {
	case "https":
		return u, nil
	case "http":
		host := u.Hostname()
		if ip := net.ParseIP(host); (ip != nil && ip.IsLoopback()) || host == "localhost" {
			return u, nil
		}
		return nil, errors.New("plain http is only allowed to loopback")
	}
	return nil, errors.New("bad hub url scheme")
}

func httpClient(caFile string) (*http.Client, error) {
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	if caFile != "" {
		pem, err := os.ReadFile(caFile)
		if err != nil {
			return nil, err
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pem) {
			return nil, errors.New("no certificates in " + caFile)
		}
		tr.TLSClientConfig.RootCAs = pool
	}
	tr.Proxy = nil
	return &http.Client{Transport: tr, Timeout: 30 * time.Second}, nil
}

// Pair registers this agent with the hub named in the code and writes the
// agent's directory.
func Pair(ctx context.Context, dir, code, caFile string) (Config, error) {
	var c Config
	pc, err := secure.ParsePairCode(code)
	if err != nil {
		return c, err
	}
	if _, err := checkURL(pc.URL); err != nil {
		return c, err
	}
	hubPub, _ := secure.DecodePublic(pc.HubKey)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return c, err
	}
	key, err := secure.LoadOrCreateKey(keyPath(dir))
	if err != nil {
		return c, err
	}
	pub := key.Public().(ed25519.PublicKey)
	body, _ := json.Marshal(map[string]string{
		"code_id": pc.ID, "host": pc.Host, "agent_key": secure.EncodePublic(pub),
		"proof": secure.PairProof(pc.Secret, pc.Host, pub),
	})
	client, err := httpClient(caFile)
	if err != nil {
		return c, err
	}
	req, _ := http.NewRequestWithContext(ctx, "POST", pc.URL+"/v1/pair", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return c, err
	}
	defer resp.Body.Close()
	var out struct {
		Error string `json:"error"`
		Sig   string `json:"sig"`
	}
	json.NewDecoder(http.MaxBytesReader(nil, resp.Body, 4096)).Decode(&out)
	if resp.StatusCode != http.StatusOK {
		return c, fmt.Errorf("hub refused the pairing: %s", out.Error)
	}
	if !secure.VerifyPaired(hubPub, pc.Host, pub, out.Sig) {
		return c, errors.New("the hub did not prove the key in the code; not paired")
	}
	c = Config{HubURL: pc.URL, HubKey: pc.HubKey, Host: pc.Host, CAFile: caFile}
	raw, _ := json.MarshalIndent(c, "", "  ")
	return c, os.WriteFile(configPath(dir), append(raw, '\n'), 0o600)
}

// Agent serves one tmux server to one hub.
type Agent struct {
	cfg    Config
	key    ed25519.PrivateKey
	hubPub ed25519.PublicKey
	tmux   tmux.Server
	log    *slog.Logger

	mu        sync.Mutex
	seen      map[string]int // pane id -> process id when first seen exposed
	attention map[string]tmux.Attention
	resized   map[string]time.Time // window id -> last resize applied
	layouts   map[string]string    // window id -> layout before its first resize, put back on release
	sess      *secure.Session      // current connection to the hub, nil while away
}

// New prepares an agent; Run connects it.
func New(cfg Config, key ed25519.PrivateKey, t tmux.Server, log *slog.Logger) (*Agent, error) {
	hubPub, err := secure.DecodePublic(cfg.HubKey)
	if err != nil {
		return nil, err
	}
	if _, err := checkURL(cfg.HubURL); err != nil {
		return nil, err
	}
	return &Agent{cfg: cfg, key: key, hubPub: hubPub, tmux: t, log: log,
		seen: map[string]int{}, attention: map[string]tmux.Attention{}, resized: map[string]time.Time{}, layouts: map[string]string{}}, nil
}

// Run keeps a connection to the hub until ctx ends, and listens for
// notifications from processes in the panes meanwhile.
func (a *Agent) Run(ctx context.Context) error {
	if a.cfg.Dir != "" {
		ln, err := a.listenNotify()
		if err != nil {
			return err
		}
		go a.serveNotify(ctx, ln)
		go func() { <-ctx.Done(); ln.Close() }()
	}
	delay := time.Second
	for {
		start := time.Now()
		err := a.connect(ctx)
		if ctx.Err() != nil {
			return nil
		}
		if time.Since(start) > time.Minute {
			delay = time.Second
		}
		wait := delay + time.Duration(rand.Int64N(int64(delay)/2+1))
		a.log.Warn("disconnected from hub", "err", err, "retry_in", wait.Round(time.Millisecond))
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(wait):
		}
		delay = min(delay*2, time.Minute)
	}
}

func (a *Agent) connect(ctx context.Context) error {
	u, _ := checkURL(a.cfg.HubURL)
	if u.Scheme == "https" {
		u.Scheme = "wss"
	} else {
		u.Scheme = "ws"
	}
	u.Path = "/v1/agent"
	client, err := httpClient(a.cfg.CAFile)
	if err != nil {
		return err
	}
	client.Timeout = 0
	dctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(dctx, u.String(), &websocket.DialOptions{HTTPClient: client})
	if err != nil {
		return err
	}
	defer c.CloseNow()
	c.SetReadLimit(1 << 20)
	sess, err := secure.AgentHandshake(dctx, wire.WS{C: c}, a.key, a.cfg.Host, a.hubPub)
	if err != nil {
		return err
	}
	a.log.Info("connected to hub", "host", a.cfg.Host)
	a.mu.Lock()
	a.sess = sess
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		a.sess = nil
		a.mu.Unlock()
	}()
	for {
		raw, err := sess.Read(ctx)
		if err != nil {
			return err
		}
		var req wire.Request
		if err := json.Unmarshal(raw, &req); err != nil {
			return errors.New("malformed request from hub")
		}
		out, _ := json.Marshal(wire.Notice{Response: a.Handle(ctx, req)})
		if err := sess.Write(ctx, out); err != nil {
			return err
		}
	}
}

// Handle answers one request. It is the agent's whole surface.
func (a *Agent) Handle(ctx context.Context, req wire.Request) wire.Response {
	resp := wire.Response{ID: req.ID}
	switch req.Op {
	case wire.OpList:
		panes, err := a.list(ctx)
		if err != nil {
			resp.Error = wire.ErrTmux
			return resp
		}
		for _, p := range panes {
			if p.Exposed() && a.sameProcess(p) {
				resp.Panes = append(resp.Panes, p)
			}
		}
	case wire.OpRead:
		p, code := a.find(ctx, req.Pane)
		if code != "" {
			resp.Error = code
			a.audit(req, code)
			return resp
		}
		lines := req.Lines
		if lines <= 0 {
			lines = 100
		}
		lines = min(lines, wire.MaxLines)
		content, err := a.tmux.Capture(ctx, p.PaneID, lines, req.ANSI)
		if err != nil {
			resp.Error = wire.ErrTmux
			return resp
		}
		resp.Content = content
	case wire.OpInput:
		p, code := a.find(ctx, req.Pane)
		if code == "" && p.Mode != tmux.ModeWrite {
			code = wire.ErrReadOnly
		}
		if code == "" {
			switch {
			case req.Text != nil && req.Key == "" && wire.ValidText(*req.Text):
				if err := a.tmux.SendText(ctx, p.PaneID, *req.Text); err != nil {
					code = wire.ErrTmux
				}
			case req.Text == nil && req.Key != "":
				if _, ok := tmux.Keys[req.Key]; !ok {
					code = wire.ErrBadInput
				} else if err := a.tmux.SendKey(ctx, p.PaneID, req.Key); err != nil {
					code = wire.ErrTmux
				}
			default:
				code = wire.ErrBadInput
			}
		}
		if code == "" {
			a.clearAttention(p.PaneID)
		}
		resp.Error = code
		a.audit(req, code)
	case wire.OpResize:
		resp.Error = a.resize(ctx, req)
		a.audit(req, resp.Error)
	default:
		resp.Error = wire.ErrUnknownOp
		a.audit(req, wire.ErrUnknownOp)
	}
	return resp
}

// resize changes the size of the pane's window, or releases it. It is a
// write: the person at the host sees it. One per second per window.
func (a *Agent) resize(ctx context.Context, req wire.Request) string {
	p, code := a.find(ctx, req.Pane)
	if code != "" {
		return code
	}
	if p.Mode != tmux.ModeWrite {
		return wire.ErrReadOnly
	}
	release := req.Fit == "auto" && req.Cols == 0 && req.Rows == 0
	if !release && (req.Fit != "" || !wire.ValidSize(req.Cols, req.Rows)) {
		return wire.ErrBadInput
	}
	if req.Scope != "" && req.Scope != "pane" && req.Scope != "window" {
		return wire.ErrBadInput
	}
	// One resize per second per window; a release is always taken, so a
	// client leaving right after a resize can still hand the window back.
	a.mu.Lock()
	last := a.resized[p.WindowID]
	if !release && time.Since(last) < time.Second {
		a.mu.Unlock()
		return wire.ErrRateLimit
	}
	a.resized[p.WindowID] = time.Now()
	saved, kept := a.layouts[p.WindowID]
	if release {
		delete(a.layouts, p.WindowID)
	}
	a.mu.Unlock()
	if release {
		if a.tmux.ReleaseWindow(ctx, p.PaneID, saved) != nil {
			return wire.ErrTmux
		}
		return ""
	}
	// The layout before the first resize is what a release puts back.
	if !kept {
		if layout, err := a.tmux.WindowLayout(ctx, p.PaneID); err == nil {
			a.mu.Lock()
			if _, again := a.layouts[p.WindowID]; !again {
				a.layouts[p.WindowID] = layout
			}
			a.mu.Unlock()
		}
	}
	var err error
	if req.Scope == "window" {
		err = a.tmux.ResizeWindow(ctx, p.PaneID, req.Cols, req.Rows)
	} else {
		err = a.tmux.ResizePane(ctx, p.PaneID, req.Cols, req.Rows)
	}
	if err != nil {
		return wire.ErrTmux
	}
	return ""
}

// find returns an exposed pane by id, re-read from tmux for every request.
func (a *Agent) find(ctx context.Context, paneID string) (tmux.Pane, string) {
	panes, err := a.list(ctx)
	if err != nil {
		return tmux.Pane{}, wire.ErrTmux
	}
	for _, p := range panes {
		if p.PaneID == paneID && p.Exposed() && a.sameProcess(p) {
			return p, ""
		}
	}
	return tmux.Pane{}, wire.ErrNotExposed
}

// list reads tmux, attaches pending attention to the panes that still
// exist and forgets it for the panes that are gone.
func (a *Agent) list(ctx context.Context) ([]tmux.Pane, error) {
	panes, skipped, err := a.tmux.List(ctx)
	if err != nil {
		a.log.Warn("tmux list failed", "err", err)
		return nil, err
	}
	if skipped > 0 {
		a.log.Warn("tmux panes skipped", "count", skipped, "err", tmux.ErrUnparsed)
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	alive := map[string]bool{}
	for i := range panes {
		alive[panes[i].PaneID] = true
		if att, ok := a.attention[panes[i].PaneID]; ok {
			panes[i].Attention = &att
		}
	}
	for id := range a.attention {
		if !alive[id] {
			delete(a.attention, id)
		}
	}
	return panes, nil
}

// sameProcess refuses a pane whose process changed under the same id.
func (a *Agent) sameProcess(p tmux.Pane) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	pid, ok := a.seen[p.PaneID]
	if !ok {
		a.seen[p.PaneID] = p.PID
		return true
	}
	return pid == p.PID
}

func (a *Agent) clearAttention(paneID string) {
	a.mu.Lock()
	delete(a.attention, paneID)
	a.mu.Unlock()
}

// audit records requests that touch a pane's input or are refused. The
// text itself is never recorded, only its length.
func (a *Agent) audit(req wire.Request, code string) {
	attrs := []any{"op", req.Op, "actor", req.Actor, "pane", req.Pane}
	if req.Key != "" {
		attrs = append(attrs, "key", req.Key)
	}
	if req.Text != nil {
		attrs = append(attrs, "text_bytes", len(*req.Text))
	}
	if req.Op == wire.OpResize {
		if req.Fit != "" {
			attrs = append(attrs, "fit", req.Fit)
		} else {
			attrs = append(attrs, "cols", req.Cols, "rows", req.Rows)
			if req.Scope == "window" {
				attrs = append(attrs, "scope", "window")
			}
		}
	}
	if code == "" {
		attrs = append(attrs, "result", "ok")
	} else {
		attrs = append(attrs, "result", code)
	}
	a.log.Info("audit", attrs...)
}
