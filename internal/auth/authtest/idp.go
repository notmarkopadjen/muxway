// Package authtest is an OpenID Connect provider for tests: discovery, a
// token endpoint and a key set on a loopback server, and an in-process
// "browser at the provider" that turns an authorization URL into the
// callback it would redirect to. Knobs make it misbehave on purpose.
package authtest

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"time"
)

var b64 = base64.RawURLEncoding

// Account is who signs in.
type Account struct {
	Email    string
	Name     string
	Verified *bool // nil leaves email_verified out
}

// IdP is one running provider. Set the knobs before the login they affect.
type IdP struct {
	Server       *httptest.Server
	Issuer       string
	ClientID     string
	ClientSecret string
	Account      Account

	// Knobs. Zero values mean a correct provider.
	Alg            string // RS256 (default), ES256, none, HS256
	IssuerClaim    string
	Audience       string
	ExpiresIn      time.Duration
	NonceOverride  string
	BreakSignature bool
	UnknownKid     bool

	// Everything secret the provider produced, for log searches.
	Secrets []string

	rsaKey *rsa.PrivateKey
	ecKey  *ecdsa.PrivateKey
	mu     sync.Mutex
	codes  map[string]*pendingCode
}

type pendingCode struct {
	nonce, challenge, redirect string
	used                       bool
}

// New starts a provider on loopback.
func New() *IdP {
	rsaKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	ecKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	yes := true
	p := &IdP{ClientID: "muxway-test-client", ClientSecret: "test-client-secret-" + random(12),
		Account:   Account{Email: "alice@example.com", Name: "Alice Example", Verified: &yes},
		ExpiresIn: time.Hour, rsaKey: rsaKey, ecKey: ecKey, codes: map[string]*pendingCode{}}
	p.Secrets = append(p.Secrets, p.ClientSecret)
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", p.discovery)
	mux.HandleFunc("/token", p.token)
	mux.HandleFunc("/jwks", p.jwks)
	p.Server = httptest.NewServer(mux)
	p.Issuer = p.Server.URL
	return p
}

func (p *IdP) Close() { p.Server.Close() }

// Reset turns every knob back to a correct provider with the default account.
func (p *IdP) Reset() {
	yes := true
	p.Account = Account{Email: "alice@example.com", Name: "Alice Example", Verified: &yes}
	p.Alg, p.IssuerClaim, p.Audience, p.NonceOverride = "", "", "", ""
	p.ExpiresIn = time.Hour
	p.BreakSignature, p.UnknownKid = false, false
}

func random(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return b64.EncodeToString(b)
}

func (p *IdP) discovery(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]any{
		"issuer": p.Issuer, "authorization_endpoint": p.Issuer + "/authorize",
		"token_endpoint": p.Issuer + "/token", "jwks_uri": p.Issuer + "/jwks",
		"id_token_signing_alg_values_supported": []string{"RS256", "ES256"},
	})
}

func (p *IdP) jwks(w http.ResponseWriter, r *http.Request) {
	pub := &p.rsaKey.PublicKey
	ec := &p.ecKey.PublicKey
	json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{
		{"kty": "RSA", "kid": "rsa-1", "use": "sig", "alg": "RS256",
			"n": b64.EncodeToString(pub.N.Bytes()), "e": b64.EncodeToString(big.NewInt(int64(pub.E)).Bytes())},
		{"kty": "EC", "kid": "ec-1", "use": "sig", "alg": "ES256", "crv": "P-256",
			"x": b64.EncodeToString(ec.X.FillBytes(make([]byte, 32))), "y": b64.EncodeToString(ec.Y.FillBytes(make([]byte, 32)))},
	}})
}

// Login plays the person at the provider: it checks the authorization
// request and returns the callback URL the browser would be sent to.
func (p *IdP) Login(authorizeURL string) (string, error) {
	u, err := url.Parse(authorizeURL)
	if err != nil {
		return "", err
	}
	q := u.Query()
	if q.Get("response_type") != "code" || q.Get("client_id") != p.ClientID || q.Get("scope") == "" ||
		q.Get("code_challenge_method") != "S256" || q.Get("code_challenge") == "" || q.Get("state") == "" ||
		q.Get("nonce") == "" || q.Get("redirect_uri") == "" {
		return "", errors.New("authorization request incomplete")
	}
	code := "code-" + random(24)
	p.mu.Lock()
	p.codes[code] = &pendingCode{nonce: q.Get("nonce"), challenge: q.Get("code_challenge"), redirect: q.Get("redirect_uri")}
	p.Secrets = append(p.Secrets, code)
	p.mu.Unlock()
	cb, _ := url.Parse(q.Get("redirect_uri"))
	cq := cb.Query()
	cq.Set("code", code)
	cq.Set("state", q.Get("state"))
	cb.RawQuery = cq.Encode()
	return cb.String(), nil
}

func (p *IdP) token(w http.ResponseWriter, r *http.Request) {
	r.ParseForm()
	refuse := func(code string) {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": code})
	}
	p.mu.Lock()
	pc := p.codes[r.PostForm.Get("code")]
	if pc != nil && !pc.used {
		pc.used = true
	} else {
		pc = nil
	}
	p.mu.Unlock()
	sum := sha256.Sum256([]byte(r.PostForm.Get("code_verifier")))
	switch {
	case r.PostForm.Get("grant_type") != "authorization_code" || pc == nil:
		refuse("invalid_grant")
		return
	case r.PostForm.Get("client_id") != p.ClientID || r.PostForm.Get("client_secret") != p.ClientSecret:
		refuse("invalid_client")
		return
	case r.PostForm.Get("redirect_uri") != pc.redirect || b64.EncodeToString(sum[:]) != pc.challenge:
		refuse("invalid_grant")
		return
	}
	idt := p.mint(pc.nonce)
	p.mu.Lock()
	p.Secrets = append(p.Secrets, idt)
	p.mu.Unlock()
	json.NewEncoder(w).Encode(map[string]string{"id_token": idt, "token_type": "Bearer", "access_token": "at-" + random(8)})
}

// mint signs an ID token the way the knobs say.
func (p *IdP) mint(nonce string) string {
	now := time.Now()
	iss, aud, alg := p.Issuer, p.ClientID, "RS256"
	if p.IssuerClaim != "" {
		iss = p.IssuerClaim
	}
	if p.Audience != "" {
		aud = p.Audience
	}
	if p.Alg != "" {
		alg = p.Alg
	}
	if p.NonceOverride != "" {
		nonce = p.NonceOverride
	}
	claims := map[string]any{"iss": iss, "aud": aud, "sub": "sub-" + p.Account.Email, "exp": now.Add(p.ExpiresIn).Unix(),
		"iat": now.Unix(), "nonce": nonce, "email": p.Account.Email, "name": p.Account.Name,
		"preferred_username": p.Account.Email}
	if p.Account.Verified != nil {
		claims["email_verified"] = *p.Account.Verified
	}
	kid := map[string]string{"RS256": "rsa-1", "ES256": "ec-1", "HS256": "rsa-1", "none": "rsa-1"}[alg]
	if p.UnknownKid {
		kid = "gone-1"
	}
	head, _ := json.Marshal(map[string]string{"alg": alg, "typ": "JWT", "kid": kid})
	body, _ := json.Marshal(claims)
	signing := b64.EncodeToString(head) + "." + b64.EncodeToString(body)
	sum := sha256.Sum256([]byte(signing))
	var sig []byte
	switch alg {
	case "RS256":
		sig, _ = rsa.SignPKCS1v15(rand.Reader, p.rsaKey, crypto.SHA256, sum[:])
	case "ES256":
		rr, ss, _ := ecdsa.Sign(rand.Reader, p.ecKey, sum[:])
		sig = append(rr.FillBytes(make([]byte, 32)), ss.FillBytes(make([]byte, 32))...)
	case "HS256":
		// Signed with the public modulus, the classic key confusion attack.
		h := sha256.Sum256(append(p.rsaKey.PublicKey.N.Bytes(), sum[:]...))
		sig = h[:]
	case "none":
		sig = nil
	}
	if p.BreakSignature && len(sig) > 0 {
		sig[0] ^= 0x55
	}
	return signing + "." + b64.EncodeToString(sig)
}
