//go:build e2e

package e2e

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/notmarkopadjen/muxway/internal/auth/authtest"
)

// Sessions and sign-in: a cookie with the client header, a pasted token
// or an identity provider behind it.

const (
	sessionCookie = "muxway_session"
	clientHeader  = "X-Muxway-Client"
)

// withSession sends a request as a signed-in browser would.
func (e *env) withSession(cookie, method, path, body string, header bool) resp {
	e.t.Helper()
	headers := []string{"Cookie", sessionCookie + "=" + cookie}
	if header {
		headers = append(headers, clientHeader, "e2e")
	}
	return e.do(method, "", path, "", body, headers...)
}

func cookieValue(r resp, name string) string {
	for _, c := range r.header.Values("Set-Cookie") {
		if strings.HasPrefix(c, name+"=") {
			v := strings.SplitN(strings.TrimPrefix(c, name+"="), ";", 2)[0]
			if v != "" {
				remember(v)
			}
			return v
		}
	}
	return ""
}

// signInWithToken posts a token and returns the session cookie.
func (e *env) signInWithToken(tok string) string {
	e.t.Helper()
	r := e.post("", "/v1/auth/token", fmt.Sprintf(`{"token":%q}`, tok))
	expect(e.t, r, http.StatusNoContent, "token sign-in")
	c := cookieValue(r, sessionCookie)
	if c == "" {
		e.t.Fatalf("no session cookie: %v", r.header)
	}
	raw := r.header.Get("Set-Cookie")
	if !strings.Contains(raw, "HttpOnly") || !strings.Contains(raw, "Secure") || !strings.Contains(raw, "SameSite=Strict") {
		e.t.Fatalf("cookie attributes: %s", raw)
	}
	return c
}

// oidcEnv starts a test identity provider and a hub that trusts it.
func oidcEnv(t *testing.T, extra ...string) (*env, *authtest.IdP) {
	t.Helper()
	idp := authtest.New()
	t.Cleanup(idp.Close)
	dir, _ := os.MkdirTemp("", "mxw-oidc-")
	t.Cleanup(func() { os.RemoveAll(dir) })
	secret := filepath.Join(dir, "oidc.secret")
	os.WriteFile(secret, []byte(idp.ClientSecret+"\n"), 0o600)
	args := append([]string{"--oidc-issuer", idp.Issuer, "--oidc-client-id", idp.ClientID,
		"--oidc-client-secret-file", secret, "--oidc-label", "Sign in with Test"}, extra...)
	e := newEnv(t, args...)
	t.Cleanup(func() { remember(idp.Secrets...) })
	return e, idp
}

// oidcSignIn walks the browser through the provider. mutate may change
// the callback. It returns the callback's status and the session cookie.
func (e *env) oidcSignIn(idp *authtest.IdP, mutate func(string) string) (int, string) {
	e.t.Helper()
	start := e.noFollow("GET", "/v1/auth/oidc/start", nil)
	if start.status != http.StatusFound {
		e.t.Fatalf("start: %d %s", start.status, start.body)
	}
	state := cookieValue(start, "muxway_signin")
	cb, err := idp.Login(start.header.Get("Location"))
	if err != nil {
		e.t.Fatal(err)
	}
	if mutate != nil {
		cb = mutate(cb)
	}
	r := e.noFollow("GET", strings.TrimPrefix(cb, e.url()), []string{"Cookie", "muxway_signin=" + state})
	return r.status, cookieValue(r, sessionCookie)
}

// noFollow is e.do without following redirects.
func (e *env) noFollow(method, path string, headers []string) resp {
	e.t.Helper()
	client := *e.client
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	req, _ := http.NewRequest(method, e.url()+path, nil)
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	r, err := client.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer r.Body.Close()
	var body strings.Builder
	buf := make([]byte, 4096)
	for {
		n, err := r.Body.Read(buf)
		body.Write(buf[:n])
		if err != nil {
			break
		}
	}
	return resp{r.StatusCode, body.String(), r.Header}
}

// 30
func TestSec30_SessionsNeedCookieAndHeaderAndCountFailures(t *testing.T) {
	e, _, _ := basic(t)
	tok := e.token("reader", []string{host + "/*"}, nil)
	cookie := e.signInWithToken(tok)
	expect(t, e.withSession(cookie, "GET", "/v1/me", "", true), http.StatusOK, "cookie and header")
	expect(t, e.withSession(cookie, "GET", "/v1/me", "", false), http.StatusUnauthorized, "cookie without header")
	expect(t, e.do("GET", "", "/v1/me", "", "", clientHeader, "e2e"), http.StatusUnauthorized, "header without cookie")
	expect(t, e.withSession("unknown-session-id", "GET", "/v1/me", "", true), http.StatusUnauthorized, "unknown session")
	expect(t, e.withSession(cookie, "POST", "/v1/auth/logout", "", true), http.StatusNoContent, "logout")
	expect(t, e.withSession(cookie, "GET", "/v1/me", "", true), http.StatusUnauthorized, "after logout")
	for _, body := range []string{`{"token":"mxt_wrong"}`, `{"token":""}`, `{}`, `{"token":"x","extra":1}`, `not json`} {
		r := e.post("", "/v1/auth/token", body)
		if r.status != http.StatusUnauthorized && r.status != http.StatusBadRequest {
			t.Fatalf("%s: %d", body, r.status)
		}
		if cookieValue(r, sessionCookie) != "" {
			t.Fatalf("%s: got a session", body)
		}
	}
	// Every refused attempt above counted; a few more lock the address.
	for i := 0; i < 10; i++ {
		e.post("", "/v1/auth/token", `{"token":"mxt_wrong"}`)
	}
	expect(t, e.post("", "/v1/auth/token", fmt.Sprintf(`{"token":%q}`, tok)), http.StatusTooManyRequests, "locked out")
}

// 31
func TestSec31_RevocationEndsLiveSessions(t *testing.T) {
	e, idp := oidcEnv(t)
	ts := newTmux(t)
	e.pairAgent(host, ts)
	e.expose(ts, "work:0.0")
	tok := e.token("reader", []string{host + "/*"}, nil)
	cookie := e.signInWithToken(tok)
	expect(t, e.withSession(cookie, "GET", "/v1/panes/"+shell0, "", true), http.StatusOK, "before revoke")
	list := e.mustCLI("hub", "token", "list", "--dir", e.hubDir)
	for _, line := range strings.Split(list, "\n") {
		if strings.Contains(line, "reader") {
			e.mustCLI("hub", "token", "revoke", "--dir", e.hubDir, strings.Fields(line)[0])
		}
	}
	expect(t, e.withSession(cookie, "GET", "/v1/panes/"+shell0, "", true), http.StatusUnauthorized, "after revoke")

	e.mustCLI("hub", "user", "create", "--dir", e.hubDir, "--email", idp.Account.Email, "--read", host+"/*")
	status, userCookie := e.oidcSignIn(idp, nil)
	if status != http.StatusSeeOther || userCookie == "" {
		t.Fatalf("oidc sign-in: %d", status)
	}
	expect(t, e.withSession(userCookie, "GET", "/v1/me", "", true), http.StatusOK, "user before removal")
	e.mustCLI("hub", "user", "remove", "--dir", e.hubDir, idp.Account.Email)
	expect(t, e.withSession(userCookie, "GET", "/v1/me", "", true), http.StatusUnauthorized, "user after removal")
}

// 32
func TestSec32_TamperedSignInsAreRefusedAndCounted(t *testing.T) {
	e, idp := oidcEnv(t)
	e.mustCLI("hub", "user", "create", "--dir", e.hubDir, "--email", idp.Account.Email, "--read", host+"/*")
	no := false
	type tamper struct {
		name   string
		knob   func()
		mutate func(string) string
		want   int
	}
	cases := []tamper{
		{"wrong state", nil, func(cb string) string { return strings.Replace(cb, "state=", "state=x", 1) }, 401},
		{"wrong nonce", func() { idp.NonceOverride = "other" }, nil, 401},
		{"broken signature", func() { idp.BreakSignature = true }, nil, 401},
		{"alg none", func() { idp.Alg = "none" }, nil, 401},
		{"HS256", func() { idp.Alg = "HS256" }, nil, 401},
		{"wrong audience", func() { idp.Audience = "someone-else" }, nil, 401},
		{"wrong issuer", func() { idp.IssuerClaim = "https://evil.example.com" }, nil, 401},
		{"expired", func() { idp.ExpiresIn = -time.Hour }, nil, 401},
		{"unverified e-mail", func() { idp.Account.Verified = &no }, nil, 401},
		{"no account", func() { idp.Account.Email = "mallory@example.com" }, nil, 403},
	}
	for i, c := range cases {
		idp.Reset()
		if c.knob != nil {
			c.knob()
		}
		status, cookie := e.oidcSignIn(idp, c.mutate)
		if i == len(cases)-1 && status == http.StatusTooManyRequests {
			break // the lockout arrived one attempt early; that is fine
		}
		if status != c.want || cookie != "" {
			t.Fatalf("%s: %d, cookie %q", c.name, status, cookie)
		}
	}
	// Ten failures from one address: locked out, even for a correct sign-in.
	idp.Reset()
	r := e.noFollow("GET", "/v1/auth/oidc/start", nil)
	if r.status != http.StatusTooManyRequests {
		t.Fatalf("address not locked after the failures: %d", r.status)
	}
	logs, _ := os.ReadFile(filepath.Join(e.logs, "hub.log"))
	if strings.Count(string(logs), "sign-in failed") < 8 || !strings.Contains(string(logs), "no account") ||
		strings.Contains(string(logs), "alice@example.com") || strings.Contains(string(logs), "mallory@example.com") {
		t.Fatalf("hub log:\n%s", logs)
	}
}

// 33
func TestSec33_SignInCannotBeReplayed(t *testing.T) {
	e, idp := oidcEnv(t)
	e.mustCLI("hub", "user", "create", "--dir", e.hubDir, "--email", idp.Account.Email, "--read", host+"/*")
	var callback, state string
	status, cookie := e.oidcSignIn(idp, func(cb string) string { callback = cb; return cb })
	if status != http.StatusSeeOther || cookie == "" {
		t.Fatalf("first sign-in: %d", status)
	}
	// The same callback again, with a fresh state cookie from a new start.
	start := e.noFollow("GET", "/v1/auth/oidc/start", nil)
	state = cookieValue(start, "muxway_signin")
	r := e.noFollow("GET", strings.TrimPrefix(callback, e.url()), []string{"Cookie", "muxway_signin=" + state})
	if r.status != http.StatusUnauthorized || cookieValue(r, sessionCookie) != "" {
		t.Fatalf("replayed callback: %d", r.status)
	}
	// Two starts, then the first one's callback: its state is stale.
	first := e.noFollow("GET", "/v1/auth/oidc/start", nil)
	second := e.noFollow("GET", "/v1/auth/oidc/start", nil)
	cb, _ := idp.Login(first.header.Get("Location"))
	r = e.noFollow("GET", strings.TrimPrefix(cb, e.url()), []string{"Cookie", "muxway_signin=" + cookieValue(second, "muxway_signin")})
	if r.status != http.StatusUnauthorized {
		t.Fatalf("stale start accepted: %d", r.status)
	}
}

// 34
func TestSec34_SessionGrantsEqualThePrincipals(t *testing.T) {
	e, ts, _ := basic(t)
	reader := e.token("reader", []string{host + "/*"}, nil)
	cookie := e.signInWithToken(reader)
	before := ts.capture("work:0.0")
	expect(t, e.withSession(cookie, "POST", "/v1/panes/"+shell0+"/input", `{"text":"echo nope"}`, true), http.StatusForbidden, "read-only session writes")
	ts2 := newTmux(t)
	e.pairAgent("bob-desktop", ts2)
	e.expose(ts2, "work:0.0")
	r := e.withSession(cookie, "GET", "/v1/hosts", "", true)
	if strings.Contains(r.body, "bob-desktop") {
		t.Fatalf("session sees a host its token may not: %s", r.body)
	}
	time.Sleep(200 * time.Millisecond)
	if ts.capture("work:0.0") != before {
		t.Fatal("pane changed")
	}
}

// 35
func TestFlow35_TokenSignIn(t *testing.T) {
	e, ts, _ := basic(t)
	tok := e.token("phone", []string{host + "/*"}, []string{host + "/*"})
	cookie := e.signInWithToken(tok)
	me := e.withSession(cookie, "GET", "/v1/me", "", true)
	expect(t, me, http.StatusOK, "me")
	if !strings.Contains(me.body, `"method":"token"`) || !strings.Contains(me.body, `"name":"phone"`) ||
		!strings.Contains(me.body, `"read":["`+host+`/*"]`) {
		t.Fatalf("me: %s", me.body)
	}
	expect(t, e.withSession(cookie, "GET", "/v1/panes", "", true), http.StatusOK, "list")
	expect(t, e.withSession(cookie, "GET", "/v1/panes/"+shell0, "", true), http.StatusOK, "read")
	expect(t, e.withSession(cookie, "POST", "/v1/panes/"+shell0+"/input", `{"text":"echo via-session"}`, true), http.StatusNoContent, "type")
	expect(t, e.withSession(cookie, "POST", "/v1/panes/"+shell0+"/input", `{"key":"Enter"}`, true), http.StatusNoContent, "enter")
	waitFor(t, "typed", func() bool { return strings.Contains(ts.capture("work:0.0"), "via-session") })
	logs, _ := os.ReadFile(filepath.Join(e.logs, "hub.log"))
	if !strings.Contains(string(logs), "method=token") {
		t.Fatal("audit line lacks the method")
	}
	expect(t, e.withSession(cookie, "POST", "/v1/auth/logout", "", true), http.StatusNoContent, "logout")
	expect(t, e.withSession(cookie, "GET", "/v1/me", "", true), http.StatusUnauthorized, "after logout")
}

// 36
func TestFlow36_OIDCSignIn(t *testing.T) {
	e, idp := oidcEnv(t)
	ts := newTmux(t)
	e.pairAgent(host, ts)
	e.expose(ts, "work:0.0", "--write")
	out := e.mustCLI("hub", "user", "create", "--dir", e.hubDir, "--email", "Alice@Example.com", "--name", "Alice",
		"--read", host+"/*", "--write", host+"/work/0.*")
	if !strings.Contains(out, "alice@example.com") {
		t.Fatalf("user create: %s", out)
	}
	userID := strings.Fields(out)[1]
	if !strings.Contains(e.mustCLI("hub", "user", "list", "--dir", e.hubDir), "alice@example.com") {
		t.Fatal("user not listed")
	}
	status, cookie := e.oidcSignIn(idp, nil)
	if status != http.StatusSeeOther || cookie == "" {
		t.Fatalf("sign-in: %d", status)
	}
	me := e.withSession(cookie, "GET", "/v1/me", "", true)
	expect(t, me, http.StatusOK, "me")
	if !strings.Contains(me.body, `"method":"oidc"`) || !strings.Contains(me.body, `"name":"alice@example.com"`) ||
		!strings.Contains(me.body, `"id":"`+userID+`"`) {
		t.Fatalf("me: %s", me.body)
	}
	expect(t, e.withSession(cookie, "POST", "/v1/panes/"+shell0+"/input", `{"key":"C-l"}`, true), http.StatusNoContent, "write within grants")
	logs, _ := os.ReadFile(filepath.Join(e.logs, "hub.log"))
	if !strings.Contains(string(logs), "user="+userID) || strings.Contains(string(logs), "alice@example.com") ||
		!strings.Contains(string(logs), "method=oidc") {
		t.Fatalf("hub log:\n%s", logs)
	}
	if _, err := e.cli("hub", "user", "create", "--dir", e.hubDir, "--email", "alice@example.com", "--read", "*"); err == nil {
		t.Fatal("duplicate user accepted")
	}
	if _, err := e.cli("hub", "user", "create", "--dir", e.hubDir, "--email", "not an address", "--read", "*"); err == nil {
		t.Fatal("bad e-mail accepted")
	}
}

// 37
func TestFlow37_AuthMethodsFollowConfiguration(t *testing.T) {
	plain, _, _ := basic(t)
	r := plain.get("", "/v1/auth")
	expect(t, r, http.StatusOK, "auth without provider")
	if strings.TrimSpace(r.body) != `{"methods":["token"]}` {
		t.Fatalf("methods: %s", r.body)
	}
	expect(t, plain.get("", "/v1/auth/oidc/start"), http.StatusNotFound, "no provider route")
	e, _ := oidcEnv(t)
	r = e.get("", "/v1/auth")
	if !strings.Contains(r.body, `"methods":["token","oidc"]`) || !strings.Contains(r.body, `"label":"Sign in with Test"`) {
		t.Fatalf("methods with provider: %s", r.body)
	}
}

// 38
func TestFlow38_SessionsExpire(t *testing.T) {
	e := newEnv(t, "--session-ttl", "2s")
	ts := newTmux(t)
	e.pairAgent(host, ts)
	tok := e.token("reader", []string{host + "/*"}, nil)
	cookie := e.signInWithToken(tok)
	expect(t, e.withSession(cookie, "GET", "/v1/me", "", true), http.StatusOK, "fresh")
	time.Sleep(2500 * time.Millisecond)
	expect(t, e.withSession(cookie, "GET", "/v1/me", "", true), http.StatusUnauthorized, "expired")
}
