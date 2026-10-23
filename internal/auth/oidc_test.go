package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/notmarkopadjen/muxway/internal/auth/authtest"
)

func provider(t *testing.T, idp *authtest.IdP) *OIDC {
	t.Helper()
	o, err := NewOIDC(OIDCConfig{Issuer: idp.Issuer, ClientID: idp.ClientID, ClientSecret: idp.ClientSecret,
		RedirectURL: "http://127.0.0.1:1/v1/auth/oidc/callback", Label: "Test"})
	if err != nil {
		t.Fatal(err)
	}
	return o
}

// roundTrip runs Start, the person at the provider, and Finish. mutate may
// change the callback URL in between.
func roundTrip(t *testing.T, o *OIDC, idp *authtest.IdP, mutate func(cb string) string) (Identity, error) {
	t.Helper()
	rec := httptest.NewRecorder()
	if err := o.Start(rec, httptest.NewRequest("GET", "/v1/auth/oidc/start", nil)); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusFound {
		t.Fatalf("start answered %d", rec.Code)
	}
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || !cookies[0].Secure || cookies[0].SameSite != http.SameSiteLaxMode {
		t.Fatalf("state cookie: %+v", cookies)
	}
	cb, err := idp.Login(rec.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if mutate != nil {
		cb = mutate(cb)
	}
	req := httptest.NewRequest("GET", cb, nil)
	req.AddCookie(cookies[0])
	return o.Finish(httptest.NewRecorder(), req)
}

func TestOIDCSignsIn(t *testing.T) {
	idp := authtest.New()
	defer idp.Close()
	o := provider(t, idp)
	id, err := roundTrip(t, o, idp, nil)
	if err != nil {
		t.Fatal(err)
	}
	if id.Email != "alice@example.com" || id.Issuer != idp.Issuer || id.Name != "Alice Example" || id.Subject == "" {
		t.Fatalf("identity: %+v", id)
	}
	idp.Alg = "ES256"
	if _, err := roundTrip(t, o, idp, nil); err != nil {
		t.Fatalf("ES256: %v", err)
	}
	idp.Alg = ""
	idp.Account.Verified = nil
	if _, err := roundTrip(t, o, idp, nil); err != nil {
		t.Fatalf("no email_verified claim should pass: %v", err)
	}
}

func TestOIDCRefuses(t *testing.T) {
	no := false
	cases := map[string]func(idp *authtest.IdP){
		"wrong nonce":        func(p *authtest.IdP) { p.NonceOverride = "other" },
		"broken signature":   func(p *authtest.IdP) { p.BreakSignature = true },
		"alg none":           func(p *authtest.IdP) { p.Alg = "none" },
		"HS256":              func(p *authtest.IdP) { p.Alg = "HS256" },
		"wrong audience":     func(p *authtest.IdP) { p.Audience = "someone-else" },
		"wrong issuer":       func(p *authtest.IdP) { p.IssuerClaim = "https://evil.example.com" },
		"expired":            func(p *authtest.IdP) { p.ExpiresIn = -time.Hour },
		"unknown kid":        func(p *authtest.IdP) { p.UnknownKid = true },
		"email not verified": func(p *authtest.IdP) { p.Account.Verified = &no },
		"no email":           func(p *authtest.IdP) { p.Account.Email = "" },
	}
	for name, knob := range cases {
		idp := authtest.New()
		o := provider(t, idp)
		knob(idp)
		if _, err := roundTrip(t, o, idp, nil); err == nil {
			t.Errorf("%s: accepted", name)
		}
		idp.Close()
	}
	idp := authtest.New()
	defer idp.Close()
	o := provider(t, idp)
	if _, err := roundTrip(t, o, idp, func(cb string) string { return strings.Replace(cb, "state=", "state=x", 1) }); err == nil {
		t.Error("wrong state accepted")
	}
	if _, err := roundTrip(t, o, idp, func(cb string) string { return cb[:strings.Index(cb, "?")] + "?error=access_denied" }); err == nil {
		t.Error("provider error accepted")
	}
	// No cookie at all.
	cb, _ := idp.Login(startLocation(t, o))
	if _, err := o.Finish(httptest.NewRecorder(), httptest.NewRequest("GET", cb, nil)); err == nil {
		t.Error("callback without the state cookie accepted")
	}
}

func startLocation(t *testing.T, o *OIDC) string {
	rec := httptest.NewRecorder()
	if err := o.Start(rec, httptest.NewRequest("GET", "/v1/auth/oidc/start", nil)); err != nil {
		t.Fatal(err)
	}
	return rec.Header().Get("Location")
}

func TestOIDCConfig(t *testing.T) {
	for _, bad := range []OIDCConfig{
		{Issuer: "http://login.example.com", ClientID: "a", ClientSecret: "b", RedirectURL: "https://hub.example.com/cb"},
		{Issuer: "https://login.example.com", ClientID: "", ClientSecret: "b", RedirectURL: "https://hub.example.com/cb"},
		{Issuer: "https://login.example.com", ClientID: "a", ClientSecret: "b", RedirectURL: "http://hub.example.com/cb"},
		{Issuer: "login.example.com", ClientID: "a", ClientSecret: "b", RedirectURL: "https://hub.example.com/cb"},
	} {
		if _, err := NewOIDC(bad); err == nil {
			t.Errorf("accepted %+v", bad)
		}
	}
	o, err := NewOIDC(OIDCConfig{Issuer: "https://login.example.com", ClientID: "a", ClientSecret: "b",
		RedirectURL: "https://hub.example.com/v1/auth/oidc/callback"})
	if err != nil || o.Name() != "oidc" || o.Label() != "Sign in" || o.cfg.Claim != "email" {
		t.Fatalf("defaults: %v %+v", err, o)
	}
	if !hasAudience([]any{"x", "a"}, "a") || hasAudience([]any{"x"}, "a") || hasAudience(3, "a") {
		t.Error("audience")
	}
}
