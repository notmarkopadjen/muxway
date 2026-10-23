package auth

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// OIDC signs people in through any OpenID Connect provider: discovery,
// the authorization code flow with PKCE, and an ID token checked against
// the provider's published keys. Standard library only.
type OIDCConfig struct {
	Issuer       string
	ClientID     string
	ClientSecret string
	RedirectURL  string // <public url>/v1/auth/oidc/callback, registered at the provider
	Label        string
	Claim        string        // the claim that carries the e-mail; "email" by default
	Skew         time.Duration // clock tolerance for exp and iat; 5 minutes by default
	Client       *http.Client
}

type OIDC struct {
	cfg OIDCConfig
	// seals the state cookie; fresh per process, so a restart voids pending sign-ins
	cookieKey cipher.AEAD

	mu     sync.Mutex
	disc   *discovery
	keys   *keySet
	keysAt time.Time
}

type discovery struct {
	Issuer   string `json:"issuer"`
	AuthURL  string `json:"authorization_endpoint"`
	TokenURL string `json:"token_endpoint"`
	JWKSURL  string `json:"jwks_uri"`
}

const (
	stateCookie = "muxway_signin"
	stateTTL    = 10 * time.Minute
)

var b64 = base64.RawURLEncoding

// NewOIDC checks the configuration; the provider is contacted on first use.
func NewOIDC(cfg OIDCConfig) (*OIDC, error) {
	if err := checkHTTPS(cfg.Issuer); err != nil {
		return nil, fmt.Errorf("issuer: %w", err)
	}
	if err := checkHTTPS(cfg.RedirectURL); err != nil {
		return nil, fmt.Errorf("redirect url: %w", err)
	}
	if cfg.ClientID == "" || cfg.ClientSecret == "" {
		return nil, errors.New("a client id and a client secret are required")
	}
	if cfg.Claim == "" {
		cfg.Claim = "email"
	}
	if cfg.Skew <= 0 {
		cfg.Skew = 5 * time.Minute
	}
	if cfg.Label == "" {
		cfg.Label = "Sign in"
	}
	if cfg.Client == nil {
		tr := http.DefaultTransport.(*http.Transport).Clone()
		cfg.Client = &http.Client{Transport: tr, Timeout: 15 * time.Second}
	}
	key := make([]byte, 32)
	rand.Read(key)
	block, _ := aes.NewCipher(key)
	gcm, _ := cipher.NewGCM(block)
	return &OIDC{cfg: cfg, cookieKey: gcm}, nil
}

// checkHTTPS allows plain http only to loopback, as everywhere in muxway.
func checkHTTPS(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return errors.New("not a url")
	}
	if u.Scheme == "https" {
		return nil
	}
	if u.Scheme == "http" {
		if ip := net.ParseIP(u.Hostname()); (ip != nil && ip.IsLoopback()) || u.Hostname() == "localhost" {
			return nil
		}
	}
	return errors.New("https is required")
}

func (o *OIDC) Name() string  { return "oidc" }
func (o *OIDC) Label() string { return o.cfg.Label }

func (o *OIDC) discover(ctx context.Context) (*discovery, error) {
	o.mu.Lock()
	d := o.disc
	o.mu.Unlock()
	if d != nil {
		return d, nil
	}
	var out discovery
	if err := o.getJSON(ctx, strings.TrimRight(o.cfg.Issuer, "/")+"/.well-known/openid-configuration", &out); err != nil {
		return nil, err
	}
	if out.Issuer != o.cfg.Issuer {
		return nil, errors.New("discovery names another issuer")
	}
	for _, u := range []string{out.AuthURL, out.TokenURL, out.JWKSURL} {
		if err := checkHTTPS(u); err != nil {
			return nil, fmt.Errorf("discovery endpoint: %w", err)
		}
	}
	o.mu.Lock()
	o.disc = &out
	o.mu.Unlock()
	return &out, nil
}

func (o *OIDC) getJSON(ctx context.Context, u string, v any) error {
	req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := o.cfg.Client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s answered %d", u, resp.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(v)
}

// pending is what the state cookie carries between Start and Finish.
type pending struct {
	State    string `json:"s"`
	Nonce    string `json:"n"`
	Verifier string `json:"v"`
	Expires  int64  `json:"e"`
}

func (o *OIDC) seal(p pending) string {
	raw, _ := json.Marshal(p)
	nonce := make([]byte, o.cookieKey.NonceSize())
	rand.Read(nonce)
	return b64.EncodeToString(append(nonce, o.cookieKey.Seal(nil, nonce, raw, nil)...))
}

func (o *OIDC) open(s string) (pending, error) {
	var p pending
	raw, err := b64.DecodeString(s)
	n := o.cookieKey.NonceSize()
	if err != nil || len(raw) < n {
		return p, errRefused
	}
	plain, err := o.cookieKey.Open(nil, raw[:n], raw[n:], nil)
	if err != nil || json.Unmarshal(plain, &p) != nil || time.Now().Unix() > p.Expires {
		return p, errRefused
	}
	return p, nil
}

func random(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return b64.EncodeToString(b)
}

// Start sends the browser to the provider with a fresh state, nonce and
// PKCE challenge, remembered in a sealed, short-lived cookie.
func (o *OIDC) Start(w http.ResponseWriter, r *http.Request) error {
	d, err := o.discover(r.Context())
	if err != nil {
		return &ProviderError{err}
	}
	p := pending{State: random(32), Nonce: random(32), Verifier: random(32), Expires: time.Now().Add(stateTTL).Unix()}
	sum := sha256.Sum256([]byte(p.Verifier))
	q := url.Values{
		"response_type":         {"code"},
		"client_id":             {o.cfg.ClientID},
		"redirect_uri":          {o.cfg.RedirectURL},
		"scope":                 {"openid email profile"},
		"state":                 {p.State},
		"nonce":                 {p.Nonce},
		"code_challenge":        {b64.EncodeToString(sum[:])},
		"code_challenge_method": {"S256"},
	}
	// Lax, not Strict: the provider sends the browser back cross-site.
	http.SetCookie(w, &http.Cookie{Name: stateCookie, Value: o.seal(p), Path: "/v1/auth/", MaxAge: int(stateTTL.Seconds()),
		HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode})
	sep := "?"
	if strings.Contains(d.AuthURL, "?") {
		sep = "&"
	}
	http.Redirect(w, r, d.AuthURL+sep+q.Encode(), http.StatusFound)
	return nil
}

// Finish checks the state, exchanges the code and verifies the ID token.
// Every refusal is the same error; details go to the hub's log only.
func (o *OIDC) Finish(w http.ResponseWriter, r *http.Request) (Identity, error) {
	http.SetCookie(w, &http.Cookie{Name: stateCookie, Value: "", Path: "/v1/auth/", MaxAge: -1,
		HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode})
	c, err := r.Cookie(stateCookie)
	if err != nil {
		return Identity{}, fmt.Errorf("%w: no state cookie", errRefused)
	}
	p, err := o.open(c.Value)
	if err != nil {
		return Identity{}, fmt.Errorf("%w: bad state cookie", errRefused)
	}
	q := r.URL.Query()
	if e := q.Get("error"); e != "" {
		return Identity{}, fmt.Errorf("%w: provider error %q", errRefused, e)
	}
	if subtle.ConstantTimeCompare([]byte(q.Get("state")), []byte(p.State)) != 1 {
		return Identity{}, fmt.Errorf("%w: state mismatch", errRefused)
	}
	code := q.Get("code")
	if code == "" || len(code) > 4096 {
		return Identity{}, fmt.Errorf("%w: no code", errRefused)
	}
	d, err := o.discover(r.Context())
	if err != nil {
		return Identity{}, &ProviderError{err}
	}
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {o.cfg.RedirectURL},
		"client_id":     {o.cfg.ClientID},
		"client_secret": {o.cfg.ClientSecret},
		"code_verifier": {p.Verifier},
	}
	req, _ := http.NewRequestWithContext(r.Context(), "POST", d.TokenURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := o.cfg.Client.Do(req)
	if err != nil {
		return Identity{}, &ProviderError{err}
	}
	defer resp.Body.Close()
	var tok struct {
		IDToken string `json:"id_token"`
		Error   string `json:"error"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&tok); err != nil {
		return Identity{}, &ProviderError{errors.New("token endpoint answered no json")}
	}
	if resp.StatusCode != http.StatusOK || tok.IDToken == "" {
		return Identity{}, fmt.Errorf("%w: token endpoint refused (%d %s)", errRefused, resp.StatusCode, tok.Error)
	}
	claims, err := o.verifyIDToken(r.Context(), tok.IDToken, p.Nonce)
	if err != nil {
		return Identity{}, fmt.Errorf("%w: %v", errRefused, err)
	}
	email, _ := claims[o.cfg.Claim].(string)
	if email == "" || strings.IndexByte(email, '@') <= 0 {
		return Identity{}, fmt.Errorf("%w: no e-mail in claim %q", errRefused, o.cfg.Claim)
	}
	if verified, ok := claims["email_verified"]; ok && o.cfg.Claim == "email" {
		if v, isBool := verified.(bool); !isBool || !v {
			return Identity{}, fmt.Errorf("%w: e-mail not verified", errRefused)
		}
	}
	sub, _ := claims["sub"].(string)
	name, _ := claims["name"].(string)
	return Identity{Issuer: o.cfg.Issuer, Subject: sub, Email: email, Name: name}, nil
}
