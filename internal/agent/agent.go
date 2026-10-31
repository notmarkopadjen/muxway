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
	"slices"
	"sort"
	"strings"
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
	// AllowSessions lets clients start sessions; a flag, not a setting.
	AllowSessions bool `json:"-"`
	// AllowClose lets clients close writable panes, whatever runs in them.
	AllowClose bool `json:"-"`
	// Inbox is where files clients send are written; empty, none are taken.
	Inbox         string `json:"-"`
	InboxMaxFiles int    `json:"-"`
	// Preview holds the directories under which a writer may read files;
	// PreviewHidden lets hidden files and directories under them be read too.
	Preview       []string `json:"-"`
	PreviewHidden bool     `json:"-"`
	// Watch reads the screens of panes that run a known AI harness and
	// reports their state when no hook does.
	Watch bool `json:"-"`
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
	asks      map[string]*pendingAsk // pane id -> the question waiting for an answer
	hooked    map[string]bool        // panes that notified over the socket: the watcher leaves them alone
	watched   map[string]*watched    // pane id -> what the watcher last saw there
	// panes whose last turn ended with work still running in the background
	background map[string]bool
	resized    map[string]time.Time            // window id -> last resize applied
	layouts    map[string]string               // window id -> layout before its first resize, put back on release
	fits       map[string]map[string]tmux.Size // window id -> pane id -> size given at pane scope, kept by later fits
	fitters    map[string]map[string]bool      // window id -> the panes that fitted it; all gone, the window is given back
	made       map[string]time.Time            // pane id -> when a split made it, while the hub may still undo it
	sessions   map[string]bool                 // session ids started for clients
	sess       *secure.Session                 // current connection to the hub, nil while away
	extKeys    bool                            // tmux's extended-keys seen to, or given up on
}

// ensureExtendedKeys turns tmux's extended-keys on once the server
// answers, so Shift+Enter and the like reach the programs that ask for
// modified keys. A tmux without the option is told of once.
func (a *Agent) ensureExtendedKeys(ctx context.Context) {
	a.mu.Lock()
	done := a.extKeys
	a.mu.Unlock()
	if done {
		return
	}
	changed, err := a.tmux.EnableExtendedKeys(ctx)
	if err != nil && strings.Contains(err.Error(), "no server running") {
		return
	}
	a.mu.Lock()
	a.extKeys = true
	a.mu.Unlock()
	switch {
	case err != nil:
		a.log.Warn("tmux extended-keys not set; Shift+Enter and other modified keys will not reach the programs that ask for them", "err", err)
	case changed:
		a.log.Info("tmux extended-keys turned on: modified keys reach the programs that ask for them")
	}
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
		seen: map[string]int{}, attention: map[string]tmux.Attention{}, background: map[string]bool{}, resized: map[string]time.Time{}, layouts: map[string]string{}, fits: map[string]map[string]tmux.Size{}, fitters: map[string]map[string]bool{},
		made: map[string]time.Time{}, sessions: map[string]bool{}, asks: map[string]*pendingAsk{}, hooked: map[string]bool{}, watched: map[string]*watched{}}, nil
}

// Run keeps a connection to the hub until ctx ends, and listens for
// notifications from processes in the panes meanwhile.
func (a *Agent) Run(ctx context.Context) error {
	if a.cfg.Inbox != "" {
		if err := a.openInbox(); err != nil {
			return err
		}
		go a.sweepInbox(ctx)
	}
	// Said once, so the owner sees what writers may read, with this process's rights.
	if len(a.cfg.Preview) > 0 {
		a.log.Info("preview roots, read as this user; git status and diff run for repositories under them", "roots", a.cfg.Preview, "hidden", a.cfg.PreviewHidden)
	}
	a.ensureExtendedKeys(ctx)
	if a.cfg.Dir != "" {
		ln, err := a.listenNotify()
		if err != nil {
			return err
		}
		go a.serveNotify(ctx, ln)
		go func() { <-ctx.Done(); ln.Close() }()
	}
	if a.cfg.Watch {
		go a.watch(ctx)
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
	c.SetReadLimit(wire.MaxFileMessage)
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
		resp := wire.Response{ID: req.ID, Error: wire.ErrBadInput}
		// Only a file may be larger than any other message.
		if len(raw) <= wire.MaxMessage || req.Op == wire.OpFile {
			resp = a.Handle(ctx, req)
		}
		out, _ := json.Marshal(wire.Notice{Response: resp})
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
		resp.Sessions = a.cfg.AllowSessions
		resp.Close = a.cfg.AllowClose
		resp.Keys = wire.KeyGrammar
		resp.Repeat = true
		resp.Inbox = a.cfg.Inbox != ""
		resp.Preview = len(a.cfg.Preview) > 0
		resp.Ask = true
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
		content, trimmed, err := a.tmux.Capture(ctx, p.PaneID, lines, req.ANSI, !req.Wrapped)
		if err != nil {
			resp.Error = wire.ErrTmux
			return resp
		}
		resp.Content = content
		resp.Trimmed = trimmed
	case wire.OpInput:
		p, code := a.find(ctx, req.Pane)
		if code == "" && p.Mode != tmux.ModeWrite {
			code = wire.ErrReadOnly
		}
		if code == "" {
			switch {
			case req.Text != nil && req.Key == "" && req.Count == 0 && wire.ValidText(*req.Text):
				if err := a.tmux.SendText(ctx, p.PaneID, *req.Text); err != nil {
					code = wire.ErrTmux
				}
			case req.Text == nil && req.Key != "" && req.Mouse == nil && req.Count >= 0 && req.Count <= wire.MaxKeyCount:
				if _, ok := tmux.KeyName(req.Key); !ok {
					code = wire.ErrBadInput
				} else if err := a.tmux.SendKey(ctx, p.PaneID, req.Key, req.Count); err != nil {
					code = wire.ErrTmux
				}
			case req.Text == nil && req.Key == "" && req.Mouse != nil && req.Count == 0:
				if !wire.ValidMouse(req.Mouse, p.Width, p.Height) {
					code = wire.ErrBadInput
				} else if err := a.tmux.SendMouse(ctx, p.PaneID, wire.Buttons[req.Mouse.Button], req.Mouse.X, req.Mouse.Y, req.Mouse.Count); errors.Is(err, tmux.ErrNoMouse) {
					code = wire.ErrBadInput
				} else if err != nil {
					code = wire.ErrTmux
				}
			default:
				code = wire.ErrBadInput
			}
		}
		if code == "" {
			a.clearAttention(p.PaneID)
			a.endAsk(ctx, p.PaneID, AskTyped, false)
		}
		resp.Error = code
		a.audit(req, code)
	case wire.OpAnswer:
		resp.Error = a.answer(ctx, req)
		a.audit(req, resp.Error)
	case wire.OpResize:
		resp.Error = a.resize(ctx, req)
		a.audit(req, resp.Error)
	case wire.OpSplit:
		resp.Pane, resp.Error = a.split(ctx, req)
		a.auditMade(req, resp)
	case wire.OpNewSession:
		resp.Pane, resp.Error = a.newSession(ctx, req)
		a.auditMade(req, resp)
	case wire.OpKillPane:
		resp.Error = a.killMade(ctx, req.Pane)
		a.audit(req, resp.Error)
	case wire.OpClosePane:
		resp.Error = a.closePane(ctx, req.Pane)
		a.audit(req, resp.Error)
	case wire.OpFile:
		resp.Path, resp.Error = a.file(ctx, req)
		a.audit(req, resp.Error, "type", req.Type, "bytes", len(req.Data), "path", resp.Path)
	case wire.OpReadFile:
		resp.Type, resp.Data, resp.Error = a.fileBack(ctx, req)
		a.audit(req, resp.Error, "name", req.Name, "bytes", len(resp.Data))
	case wire.OpReadPath:
		var file string
		file, resp.Type, resp.Data, resp.Error = a.preview(ctx, req)
		a.audit(req, resp.Error, "path", req.Path, "file", file, "bytes", len(resp.Data))
	case wire.OpGitStatus:
		resp.Changes, resp.Error = a.changes(ctx, req)
		n, root := 0, ""
		if resp.Changes != nil {
			n, root = len(resp.Changes.Entries), resp.Changes.Root
		}
		a.audit(req, resp.Error, "root", root, "entries", n)
	case wire.OpGitDiff:
		var root string
		resp.Diff, resp.Binary, resp.Cut, resp.Error, root = a.diff(ctx, req)
		a.audit(req, resp.Error, "root", root, "path", req.Path, "bytes", len(resp.Diff))
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
	// A layout without a size arranges the window at the size it has.
	arrangeOnly := req.Layout != "" && req.Fit == "" && req.Cols == 0 && req.Rows == 0
	if !release && !arrangeOnly && (req.Fit != "" || !wire.ValidSize(req.Cols, req.Rows)) {
		return wire.ErrBadInput
	}
	if req.Scope != "" && req.Scope != "pane" && req.Scope != "window" {
		return wire.ErrBadInput
	}
	if req.Zoom && req.Scope != "window" {
		return wire.ErrBadInput
	}
	// A layout names exactly the window's panes, or it is refused.
	if req.Layout != "" {
		if req.Scope != "window" || len(req.Layout) > wire.MaxLayoutBytes {
			return wire.ErrBadInput
		}
		ids, err := tmux.LayoutPanes(req.Layout)
		if err != nil {
			return wire.ErrBadInput
		}
		panes, err := a.list(ctx)
		if err != nil {
			return wire.ErrTmux
		}
		var mine []string
		for _, q := range panes {
			if q.WindowID == p.WindowID {
				mine = append(mine, q.PaneID)
			}
		}
		sort.Strings(mine)
		if !slices.Equal(ids, mine) {
			return wire.ErrBadInput
		}
		// Moving panes, not only sizing them, needs the grant on all of them.
		if live, err := a.tmux.WindowLayout(ctx, p.PaneID); err != nil {
			return wire.ErrTmux
		} else if !req.Arrange && !tmux.SameShape(req.Layout, live) {
			return wire.ErrReadOnly
		}
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
	// A pane's fit is kept so the next fit of a sibling gives it its size
	// again; a window fit or a release starts over.
	others := map[string]tmux.Size{}
	if release {
		delete(a.fitters, p.WindowID)
	} else if !arrangeOnly {
		if a.fitters[p.WindowID] == nil {
			a.fitters[p.WindowID] = map[string]bool{}
		}
		a.fitters[p.WindowID][p.PaneID] = true
	}
	if release || req.Scope == "window" {
		delete(a.fits, p.WindowID)
	} else if !arrangeOnly {
		if a.fits[p.WindowID] == nil {
			a.fits[p.WindowID] = map[string]tmux.Size{}
		}
		for id, sz := range a.fits[p.WindowID] {
			if id != p.PaneID {
				others[id] = sz
			}
		}
		a.fits[p.WindowID][p.PaneID] = tmux.Size{Cols: req.Cols, Rows: req.Rows}
	}
	// An arrangement stays: a release later gives the size back, not the
	// old places.
	if req.Arrange && (kept || !arrangeOnly) {
		a.layouts[p.WindowID] = req.Layout
	}
	a.mu.Unlock()
	if arrangeOnly {
		if a.tmux.ArrangeWindow(ctx, p.PaneID, req.Layout) != nil {
			return wire.ErrTmux
		}
		return ""
	}
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
		err = a.tmux.ResizeWindow(ctx, p.PaneID, req.Cols, req.Rows, req.Layout, req.Zoom)
	} else {
		err = a.tmux.ResizePane(ctx, p.PaneID, req.Cols, req.Rows, others)
	}
	if err != nil {
		return wire.ErrTmux
	}
	return ""
}

// split puts one more pane beside or below a writable one, up to eight in
// the window. The new pane is answered as listed, exposed or not, so the
// hub can judge it.
func (a *Agent) split(ctx context.Context, req wire.Request) (*tmux.Pane, string) {
	if !wire.ValidDirection(req.Direction) {
		return nil, wire.ErrBadInput
	}
	p, code := a.find(ctx, req.Pane)
	if code != "" {
		return nil, code
	}
	if p.Mode != tmux.ModeWrite {
		return nil, wire.ErrReadOnly
	}
	panes, err := a.list(ctx)
	if err != nil {
		return nil, wire.ErrTmux
	}
	n := 0
	for _, q := range panes {
		if q.WindowID == p.WindowID {
			n++
		}
	}
	if n >= wire.MaxPanesPerWindow {
		return nil, wire.ErrTooMany
	}
	id, err := a.tmux.Split(ctx, p.PaneID, req.Direction == "h")
	if err != nil {
		return nil, wire.ErrTmux
	}
	a.mu.Lock()
	a.made[id] = time.Now()
	for k, t := range a.made {
		if time.Since(t) > undoWindow {
			delete(a.made, k)
		}
	}
	a.mu.Unlock()
	return a.listed(ctx, id)
}

// undoWindow is how long the hub has to kill a pane a split made.
const undoWindow = 30 * time.Second

// newSession starts a session for a client, when the owner allowed it.
func (a *Agent) newSession(ctx context.Context, req wire.Request) (*tmux.Pane, string) {
	if !a.cfg.AllowSessions {
		return nil, wire.ErrNotAllowed
	}
	if !wire.ValidSessionName(req.Name) {
		return nil, wire.ErrBadInput
	}
	if a.tmux.HasSession(ctx, req.Name) {
		return nil, wire.ErrExists
	}
	panes, err := a.list(ctx)
	if err != nil {
		return nil, wire.ErrTmux
	}
	// Sessions this agent started and that still live count against the cap.
	alive := map[string]bool{}
	for _, q := range panes {
		alive[q.SessionID] = true
	}
	a.mu.Lock()
	n := 0
	for id := range a.sessions {
		if !alive[id] {
			delete(a.sessions, id)
			continue
		}
		n++
	}
	a.mu.Unlock()
	if n >= wire.MaxClientSessions {
		return nil, wire.ErrTooMany
	}
	id, err := a.tmux.NewSession(ctx, req.Name)
	if err != nil {
		return nil, wire.ErrTmux
	}
	p, code := a.listed(ctx, id)
	if p != nil {
		a.mu.Lock()
		a.sessions[p.SessionID] = true
		a.made[id] = time.Now()
		a.mu.Unlock()
	}
	return p, code
}

// listed is a pane as tmux lists it right after it was made.
func (a *Agent) listed(ctx context.Context, id string) (*tmux.Pane, string) {
	panes, err := a.list(ctx)
	if err != nil {
		return nil, wire.ErrTmux
	}
	for _, q := range panes {
		if q.PaneID == id {
			a.sameProcess(q)
			return &q, ""
		}
	}
	return nil, wire.ErrTmux
}

// file writes a file for the program in a writable exposed pane, when
// the owner runs the agent with an inbox.
func (a *Agent) file(ctx context.Context, req wire.Request) (string, string) {
	if a.cfg.Inbox == "" {
		return "", wire.ErrNotAllowed
	}
	p, code := a.find(ctx, req.Pane)
	if code != "" {
		return "", code
	}
	if p.Mode != tmux.ModeWrite {
		return "", wire.ErrReadOnly
	}
	path, err := a.saveFile(req.Type, req.Data)
	switch {
	case errors.Is(err, errInboxFull):
		return "", wire.ErrInboxFull
	case errors.Is(err, errBadFile):
		return "", wire.ErrBadInput
	case err != nil:
		return "", wire.ErrTmux
	}
	return path, ""
}

// fileBack hands one inbox file back to a reader of the pane.
func (a *Agent) fileBack(ctx context.Context, req wire.Request) (string, []byte, string) {
	if a.cfg.Inbox == "" {
		return "", nil, wire.ErrNotAllowed
	}
	if _, code := a.find(ctx, req.Pane); code != "" {
		return "", nil, code
	}
	typ, data, err := a.readFile(req.Name)
	switch {
	case errors.Is(err, errBadFile):
		return "", nil, wire.ErrBadInput
	case err != nil:
		return "", nil, wire.ErrNoFile
	}
	return typ, data, ""
}

// closePane closes a writable exposed pane for a client, when the owner
// runs the agent with --allow-close.
func (a *Agent) closePane(ctx context.Context, id string) string {
	if !a.cfg.AllowClose {
		return wire.ErrNotAllowed
	}
	p, code := a.find(ctx, id)
	if code != "" {
		return code
	}
	if p.Mode != tmux.ModeWrite {
		return wire.ErrReadOnly
	}
	if a.tmux.KillPane(ctx, p.PaneID) != nil {
		return wire.ErrTmux
	}
	return ""
}

// killMade closes a pane a split or a new session made moments ago; any
// other pane is refused, so a kill reaches nothing a person was using.
func (a *Agent) killMade(ctx context.Context, id string) string {
	a.mu.Lock()
	t, ok := a.made[id]
	delete(a.made, id)
	a.mu.Unlock()
	if !ok || time.Since(t) > undoWindow {
		return wire.ErrNotExposed
	}
	if a.tmux.KillPane(ctx, id) != nil {
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
	// The server may have come up after the agent did.
	a.ensureExtendedKeys(ctx)
	a.mu.Lock()
	alive := map[string]bool{}
	for i := range panes {
		alive[panes[i].PaneID] = true
		if att, ok := a.attention[panes[i].PaneID]; ok {
			panes[i].Attention = &att
		}
	}
	var gone []*pendingAsk
	for id := range a.attention {
		if !alive[id] {
			delete(a.attention, id)
		}
	}
	for id, q := range a.asks {
		if !alive[id] {
			delete(a.asks, id)
			gone = append(gone, q)
		}
	}
	for id := range a.hooked {
		if !alive[id] {
			delete(a.hooked, id)
			delete(a.watched, id)
		}
	}
	// A window whose fitting panes are all gone (the shell exited) has no
	// pane left to release it through: it is given back here.
	type orphan struct{ pane, layout string }
	var orphans []orphan
	for w, set := range a.fitters {
		left := false
		for id := range set {
			if alive[id] {
				left = true
				break
			}
		}
		if left {
			continue
		}
		delete(a.fitters, w)
		delete(a.fits, w)
		saved := a.layouts[w]
		delete(a.layouts, w)
		for i := range panes {
			if panes[i].WindowID == w {
				orphans = append(orphans, orphan{panes[i].PaneID, saved})
				break
			}
		}
	}
	a.mu.Unlock()
	for _, q := range gone {
		q.finish(askResult{err: AskGone})
	}
	for _, o := range orphans {
		if err := a.tmux.ReleaseWindow(ctx, o.pane, o.layout); err != nil {
			a.log.Warn("window release after its pane left", "err", err)
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
func (a *Agent) audit(req wire.Request, code string, extra ...any) {
	attrs := []any{"op", req.Op, "actor", req.Actor, "pane", req.Pane}
	attrs = append(attrs, extra...)
	if req.Key != "" {
		attrs = append(attrs, "key", req.Key)
		if req.Count > 1 {
			attrs = append(attrs, "count", req.Count)
		}
	}
	if req.Text != nil {
		attrs = append(attrs, "text_bytes", len(*req.Text))
	}
	if req.Mouse != nil {
		attrs = append(attrs, "mouse", req.Mouse.Button)
	}
	if req.Direction != "" {
		attrs = append(attrs, "direction", req.Direction)
	}
	if req.Name != "" {
		attrs = append(attrs, "name", req.Name)
	}
	if req.Choice != "" {
		attrs = append(attrs, "choice_bytes", len(req.Choice))
	}
	if req.Op == wire.OpResize {
		if req.Fit != "" {
			attrs = append(attrs, "fit", req.Fit)
		} else {
			attrs = append(attrs, "cols", req.Cols, "rows", req.Rows)
			if req.Scope == "window" {
				attrs = append(attrs, "scope", "window")
			}
			if req.Layout != "" {
				attrs = append(attrs, "layout", true)
			}
			if req.Arrange {
				attrs = append(attrs, "arrange", true)
			}
			if req.Zoom {
				attrs = append(attrs, "zoom", true)
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

// auditMade is audit with the pane a creation made.
func (a *Agent) auditMade(req wire.Request, resp wire.Response) {
	if resp.Pane != nil {
		a.audit(req, resp.Error, "made", resp.Pane.PaneID)
		return
	}
	a.audit(req, resp.Error)
}
