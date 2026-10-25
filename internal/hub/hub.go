// Package hub is where clients and agents meet. It authenticates both,
// enforces each client token's grants, and routes requests to agents.
package hub

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/notmarkopadjen/muxway/internal/auth"
	"github.com/notmarkopadjen/muxway/internal/secure"
	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

// Config for `muxway hub serve`.
type Config struct {
	Dir        string // state directory, 0700
	Listen     string // address to listen on
	PublicURL  string // how agents reach the hub, written into pairing codes
	TLSCert    string // serve TLS with these, or listen on loopback only
	TLSKey     string
	TrustProxy bool // take the client address from X-Forwarded-For when the peer is loopback
	SessionTTL time.Duration
	Providers  []auth.Provider // ways to sign in besides pasting a token
	NoWeb      bool            // do not serve the web client
	STT        STT             // the transcriber spoken clips go to, if any
}

// Hub is a running hub.
type Hub struct {
	cfg      Config
	key      ed25519.PrivateKey
	store    *Store
	log      *slog.Logger
	limits   *limiter
	events   *eventLog
	sessions *sessions
	logs     *logRingBuf
	refused  refusals
	bearers  bearerClients

	mu     sync.Mutex
	agents map[string]*agentConn
	codes  map[string]*pairCode
}

type pairCode struct {
	host     string
	secret   string
	expires  time.Time
	attempts int
}

// New opens the hub's state directory, creating its key on first use.
func New(cfg Config, log *slog.Logger) (*Hub, error) {
	if err := os.MkdirAll(cfg.Dir, 0o700); err != nil {
		return nil, err
	}
	if info, err := os.Stat(cfg.Dir); err != nil || info.Mode().Perm()&0o077 != 0 {
		return nil, fmt.Errorf("%s must be private to its owner (chmod 700)", cfg.Dir)
	}
	key, err := secure.LoadOrCreateKey(filepath.Join(cfg.Dir, "hub.key"))
	if err != nil {
		return nil, err
	}
	store, err := openStore(cfg.Dir)
	if err != nil {
		return nil, err
	}
	if cfg.SessionTTL <= 0 {
		cfg.SessionTTL = 12 * time.Hour
	}
	logs := newLogRing()
	log = slog.New(&ringHandler{next: log.Handler(), ring: logs})
	return &Hub{cfg: cfg, key: key, store: store, log: log, limits: newLimiter(), events: newEventLog(),
		sessions: newSessions(cfg.SessionTTL), logs: logs, agents: map[string]*agentConn{}, codes: map[string]*pairCode{}}, nil
}

// PublicKey is the key agents pin.
func (h *Hub) PublicKey() ed25519.PublicKey { return h.key.Public().(ed25519.PublicKey) }

// CheckListen refuses plain HTTP anywhere but loopback.
func CheckListen(cfg Config) error {
	if cfg.TLSCert != "" || cfg.TLSKey != "" {
		if cfg.TLSCert == "" || cfg.TLSKey == "" {
			return errors.New("give both a TLS certificate and its key")
		}
		return nil
	}
	host, _, err := net.SplitHostPort(cfg.Listen)
	if err != nil {
		return err
	}
	if ip := net.ParseIP(host); ip == nil || !ip.IsLoopback() {
		return errors.New("without TLS the hub listens on a loopback address only, behind a TLS-terminating proxy")
	}
	return nil
}

// Serve runs the hub until ctx ends.
func (h *Hub) Serve(ctx context.Context) error {
	if err := CheckListen(h.cfg); err != nil {
		return err
	}
	ln, err := net.Listen("tcp", h.cfg.Listen)
	if err != nil {
		return err
	}
	admin, err := h.listenAdmin()
	if err != nil {
		ln.Close()
		return err
	}
	srv := &http.Server{
		Handler:           h.routes(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    16 << 10,
		ErrorLog:          slog.NewLogLogger(h.log.Handler(), slog.LevelWarn),
	}
	go h.serveAdmin(ctx, admin)
	go func() {
		<-ctx.Done()
		admin.Close()
		sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(sctx)
	}()
	h.log.Info("hub listening", "addr", ln.Addr().String(), "tls", h.cfg.TLSCert != "",
		"key", secure.EncodePublic(h.PublicKey()))
	if h.cfg.TLSCert != "" {
		err = srv.ServeTLS(ln, h.cfg.TLSCert, h.cfg.TLSKey)
	} else {
		err = srv.Serve(ln)
	}
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

// --- agents ---------------------------------------------------------------

type agentConn struct {
	host    string
	addr    string
	since   time.Time
	sess    *secure.Session
	cancel  context.CancelFunc
	mu      sync.Mutex
	nextID  uint64
	pending map[uint64]chan wire.Response
	list    []tmux.Pane
	listAt  time.Time
	starts  bool // the agent starts sessions for clients
	closes  bool // the agent closes panes for clients
	evts    bucket
	warned  time.Time
}

var errOffline = errors.New("host offline")

func (h *Hub) agent(host string) *agentConn {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.agents[host]
}

func (a *agentConn) request(ctx context.Context, req wire.Request) (wire.Response, error) {
	a.mu.Lock()
	a.nextID++
	req.ID = a.nextID
	ch := make(chan wire.Response, 1)
	a.pending[req.ID] = ch
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		delete(a.pending, req.ID)
		a.mu.Unlock()
	}()
	raw, _ := json.Marshal(req)
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := a.sess.Write(ctx, raw); err != nil {
		return wire.Response{}, errOffline
	}
	select {
	case r, ok := <-ch:
		if !ok {
			return wire.Response{}, errOffline
		}
		return r, nil
	case <-ctx.Done():
		return wire.Response{}, errOffline
	}
}

// panes returns the agent's exposed panes, cached for a second.
func (a *agentConn) panes(ctx context.Context) ([]tmux.Pane, error) {
	a.mu.Lock()
	if time.Since(a.listAt) < time.Second {
		list := a.list
		a.mu.Unlock()
		return list, nil
	}
	a.mu.Unlock()
	r, err := a.request(ctx, wire.Request{Op: wire.OpList})
	if err != nil {
		return nil, err
	}
	if r.Error != "" {
		return nil, errors.New(r.Error)
	}
	a.mu.Lock()
	a.list, a.listAt, a.starts, a.closes = r.Panes, time.Now(), r.Sessions, r.Close
	a.mu.Unlock()
	return r.Panes, nil
}

// closesPanes says, from the agent's listing, whether clients may close panes there.
func (a *agentConn) closesPanes(ctx context.Context) bool {
	if _, err := a.panes(ctx); err != nil {
		return false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.closes
}

// startsSessions asks the agent, through its listing, whether clients may
// start sessions on it.
func (a *agentConn) startsSessions(ctx context.Context) bool {
	if _, err := a.panes(ctx); err != nil {
		return false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.starts
}

func (a *agentConn) forget() {
	a.mu.Lock()
	a.listAt = time.Time{}
	a.mu.Unlock()
}

func (h *Hub) readLoop(ctx context.Context, a *agentConn) error {
	for {
		raw, err := a.sess.Read(ctx)
		if err != nil {
			return err
		}
		var n wire.Notice
		if err := json.Unmarshal(raw, &n); err != nil {
			return errors.New("malformed message")
		}
		if n.Event != nil && n.ID == 0 {
			h.acceptEvent(a, *n.Event)
			continue
		}
		a.mu.Lock()
		ch := a.pending[n.ID]
		a.mu.Unlock()
		if ch != nil {
			ch <- n.Response
		}
	}
}

// acceptEvent validates an agent's event, binds it to the connection's
// host and keeps it for clients. Nothing in it is trusted as sent.
func (h *Hub) acceptEvent(a *agentConn, ev wire.Event) {
	p := ev.Pane
	valid := wire.KnownKind(ev.Kind) && wire.ValidEventText(ev.Text) && paneID.MatchString(p.PaneID) &&
		p.Exposed() && p.WindowIndex >= 0 && p.PaneIndex >= 0 &&
		cleanName(p.SessionName) && cleanName(p.WindowName) && cleanName(p.Title) && cleanName(p.Command) &&
		(p.Alias == "" || hostName.MatchString(p.Alias))
	if !valid {
		h.log.Warn("event refused", "host", a.host, "pane", p.PaneID, "kind", ev.Kind)
		return
	}
	a.mu.Lock()
	ok := a.evts.take(eventRate, eventBurst)
	warn := !ok && time.Since(a.warned) > time.Minute
	if warn {
		a.warned = time.Now()
	}
	a.listAt = time.Time{}
	a.mu.Unlock()
	if !ok {
		if warn {
			h.log.Warn("events dropped, agent over the rate limit", "host", a.host)
		}
		return
	}
	e := h.events.add(a.host, ev)
	h.log.Info("event", "seq", e.Seq, "host", a.host, "pane", p.PaneID, "kind", ev.Kind)
}

func cleanName(s string) bool { return wire.CleanText(s) == s && len(s) <= 256 }

func (h *Hub) attach(a *agentConn) {
	h.mu.Lock()
	old := h.agents[a.host]
	h.agents[a.host] = a
	h.mu.Unlock()
	if old != nil {
		old.cancel()
	}
}

func (h *Hub) detach(a *agentConn) {
	h.mu.Lock()
	if h.agents[a.host] == a {
		delete(h.agents, a.host)
	}
	h.mu.Unlock()
	a.mu.Lock()
	for id, ch := range a.pending {
		close(ch)
		delete(a.pending, id)
	}
	a.mu.Unlock()
}
