// Package client talks to a hub as a client does: a bearer token, JSON
// or text, long-polled events. It is what muxway client and muxway mcp
// are built on, and it has the token's rights and nothing more.
package client

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/notmarkopadjen/muxway/internal/tmux"
)

// Client is one hub and one token.
type Client struct {
	Hub   string
	token string
	http  *http.Client
}

// Config is client.json in the client directory; the token lives beside
// it in its own file, mode 600.
type Config struct {
	Hub string `json:"hub"`
	CA  string `json:"ca,omitempty"`
}

func configPath(dir string) string { return filepath.Join(dir, "client.json") }
func tokenPath(dir string) string  { return filepath.Join(dir, "token") }

// Save writes the hub, the CA file and the token into dir.
func Save(dir string, cfg Config, token string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	raw, _ := json.MarshalIndent(cfg, "", "  ")
	if err := os.WriteFile(configPath(dir), append(raw, '\n'), 0o600); err != nil {
		return err
	}
	return os.WriteFile(tokenPath(dir), []byte(token+"\n"), 0o600)
}

// Load reads dir; MUXWAY_HUB, MUXWAY_TOKEN and MUXWAY_CA override it.
func Load(dir string) (Config, string, error) {
	var cfg Config
	token := ""
	if raw, err := os.ReadFile(configPath(dir)); err == nil {
		json.Unmarshal(raw, &cfg)
	}
	if raw, err := os.ReadFile(tokenPath(dir)); err == nil {
		token = strings.TrimSpace(string(raw))
	}
	if v := os.Getenv("MUXWAY_HUB"); v != "" {
		cfg.Hub = v
	}
	if v := os.Getenv("MUXWAY_CA"); v != "" {
		cfg.CA = v
	}
	if v := os.Getenv("MUXWAY_TOKEN"); v != "" {
		token = v
	}
	if cfg.Hub == "" || token == "" {
		return cfg, "", errors.New("no hub or token: run muxway client connect, or set MUXWAY_HUB and MUXWAY_TOKEN")
	}
	return cfg, token, nil
}

// New makes a client for hub with token; caFile, when given, is the only
// certificate authority trusted.
func New(hub, token, caFile string) (*Client, error) {
	u, err := url.Parse(hub)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return nil, fmt.Errorf("hub: not a URL: %q", hub)
	}
	if u.Scheme == "http" && !strings.HasPrefix(u.Host, "127.0.0.1") && !strings.HasPrefix(u.Host, "localhost") {
		return nil, errors.New("hub: plain http only to localhost")
	}
	tr := http.DefaultTransport.(*http.Transport).Clone()
	if caFile != "" {
		pem, err := os.ReadFile(caFile)
		if err != nil {
			return nil, err
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pem) {
			return nil, errors.New("ca: no certificate in " + caFile)
		}
		tr.TLSClientConfig = &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}
	}
	return &Client{Hub: strings.TrimRight(hub, "/"), token: token, http: &http.Client{Transport: tr, Timeout: 45 * time.Second}}, nil
}

// Error is what the hub answered when it refused.
type Error struct {
	Status int
	Code   string
}

func (e *Error) Error() string { return fmt.Sprintf("%s (%d)", e.Code, e.Status) }

// Do sends one request and returns the body. A refusal is an *Error.
func (c *Client) Do(ctx context.Context, method, path, accept string, body any) ([]byte, error) {
	var rd io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rd = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.Hub+path, rd)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("X-Muxway-Client", "cli")
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 16<<20))
	if res.StatusCode >= 400 {
		var e struct {
			Error string `json:"error"`
		}
		json.Unmarshal(raw, &e)
		if e.Error == "" {
			e.Error = http.StatusText(res.StatusCode)
		}
		return nil, &Error{Status: res.StatusCode, Code: e.Error}
	}
	return raw, nil
}

// Text asks for a path in text mode.
func (c *Client) Text(ctx context.Context, path string) (string, error) {
	raw, err := c.Do(ctx, http.MethodGet, path, "text/plain", nil)
	return string(raw), err
}

// JSON asks for a path and decodes the answer into v.
func (c *Client) JSON(ctx context.Context, path string, v any) error {
	raw, err := c.Do(ctx, http.MethodGet, path, "application/json", nil)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, v)
}

// Pane is a pane as the hub lists it.
type Pane struct {
	Host    string `json:"host"`
	Address string `json:"address"`
	tmux.Pane
}

// Event is one line of the hub's event feed.
type Event struct {
	Seq     uint64   `json:"seq"`
	At      int64    `json:"at"`
	Host    string   `json:"host"`
	Address string   `json:"address"`
	Alias   string   `json:"alias,omitempty"`
	Kind    string   `json:"kind"`
	Text    string   `json:"text,omitempty"`
	Choices []string `json:"choices,omitempty"`
}

// Panes lists every pane the token may read.
func (c *Client) Panes(ctx context.Context) ([]Pane, error) {
	var v struct {
		Panes []Pane `json:"panes"`
	}
	err := c.JSON(ctx, "/v1/panes", &v)
	return v.Panes, err
}

// Inbox lists the panes that wait for their owner, oldest first.
func (c *Client) Inbox(ctx context.Context) ([]Pane, error) {
	var v struct {
		Inbox []Pane `json:"inbox"`
	}
	err := c.JSON(ctx, "/v1/inbox", &v)
	return v.Inbox, err
}

// Read returns the last lines of a pane as text.
func (c *Client) Read(ctx context.Context, address string, lines int) (string, error) {
	path := "/v1/panes/" + address
	if lines > 0 {
		path += fmt.Sprintf("?lines=%d", lines)
	}
	return c.Text(ctx, path)
}

// Input sends text, a key or a mouse event to a pane.
func (c *Client) Input(ctx context.Context, address string, body any) error {
	_, err := c.Do(ctx, http.MethodPost, "/v1/panes/"+address+"/input", "", body)
	return err
}

// Answer picks one of a question's choices.
func (c *Client) Answer(ctx context.Context, address, choice string) error {
	_, err := c.Do(ctx, http.MethodPost, "/v1/panes/"+address+"/answer", "", map[string]string{"choice": choice})
	return err
}

// Events returns the events after cursor, waiting up to wait seconds for
// one; without a cursor (0), the most recent ones.
func (c *Client) Events(ctx context.Context, after uint64, wait, limit int) ([]Event, uint64, error) {
	path := fmt.Sprintf("/v1/events?wait=%d&limit=%d", wait, limit)
	if after > 0 {
		path += fmt.Sprintf("&after=%d", after)
	}
	var v struct {
		Events []Event `json:"events"`
		Next   uint64  `json:"next"`
	}
	err := c.JSON(ctx, path, &v)
	return v.Events, v.Next, err
}

// Attention kinds that mean a pane waits for its owner.
var waiting = map[string]bool{"question": true, "permission": true, "idle": true, "done": true}

// Wait blocks until a pane (address, or any with "") needs its owner, and
// returns it as an event; what already waits in the inbox counts first.
// It returns nil, nil when ctx ends first.
func (c *Client) Wait(ctx context.Context, address string) (*Event, error) {
	inbox, err := c.Inbox(ctx)
	if err != nil {
		return nil, err
	}
	for _, p := range inbox {
		if address == "" || p.Address == address || (p.Alias != "" && p.Host+"/@"+p.Alias == address) {
			return &Event{At: p.Attention.At, Host: p.Host, Address: p.Address, Alias: p.Alias,
				Kind: p.Attention.Kind, Text: p.Attention.Text, Choices: p.Attention.Choices}, nil
		}
	}
	_, cursor, err := c.Events(ctx, 0, 0, 1)
	if err != nil {
		return nil, err
	}
	for ctx.Err() == nil {
		events, next, err := c.Events(ctx, cursor, 30, 100)
		if err != nil {
			if ctx.Err() != nil {
				return nil, nil
			}
			return nil, err
		}
		cursor = next
		for i := range events {
			e := &events[i]
			if waiting[e.Kind] && (address == "" || e.Address == address || (e.Alias != "" && e.Host+"/@"+e.Alias == address)) {
				return e, nil
			}
		}
	}
	return nil, nil
}
