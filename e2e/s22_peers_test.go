//go:build e2e

package e2e

import (
	"net/http"
	"strings"
	"testing"
)

// Peers: the owner's other hubs, named with --peer, whose pages may use a
// session here. Every other origin keeps the credential-less wildcard.

const peer = "https://work.example.com"

func (e *env) preflight(origin string, headers string) resp {
	return e.do("OPTIONS", "", "/v1/panes", "", "", "Origin", origin, "Access-Control-Request-Method", "GET",
		"Access-Control-Request-Headers", headers)
}

func cookieOf(r resp) string {
	for _, c := range r.header.Values("Set-Cookie") {
		if strings.HasPrefix(c, "muxway_session=") {
			return c
		}
	}
	return ""
}

func (e *env) signIn(t *testing.T, tok string) resp {
	t.Helper()
	r := e.do("POST", "", "/v1/auth/token", "", `{"token":"`+tok+`"}`, "Content-Type", "application/json")
	expect(t, r, http.StatusNoContent, "sign in")
	return r
}

// 170: an origin that is not a peer gets no credentials and may not add
// the client header, so a browser there cannot use the cookie, on a hub
// with peers as on one without.
func TestSec170_NonPeerOriginGetsNoCredentialsAndNoClientHeader(t *testing.T) {
	e := newEnv(t, "--peer", peer)
	tok := e.token("browser", []string{"*"}, nil)
	for _, origin := range []string{"https://evil.example.com", "null", "https://work.example.com.evil.example", "http://work.example.com", "https://work.example.com:444"} {
		r := e.preflight(origin, "x-muxway-client")
		expect(t, r, http.StatusNoContent, "preflight from "+origin)
		if r.header.Get("Access-Control-Allow-Origin") != "*" || r.header.Get("Access-Control-Allow-Credentials") != "" {
			t.Fatalf("%s: origin %q credentials %q", origin, r.header.Get("Access-Control-Allow-Origin"), r.header.Get("Access-Control-Allow-Credentials"))
		}
		if strings.Contains(strings.ToLower(r.header.Get("Access-Control-Allow-Headers")), "x-muxway-client") {
			t.Fatalf("%s: the client header is allowed", origin)
		}
	}
	// A cookie sent cross-site, as SameSite=None lets it, is nothing without the header.
	cookie := strings.SplitN(cookieOf(e.signIn(t, tok)), ";", 2)[0]
	remember(strings.TrimPrefix(cookie, "muxway_session="))
	r := e.do("GET", "", "/v1/me", "", "", "Cookie", cookie, "Origin", "https://evil.example.com")
	expect(t, r, http.StatusUnauthorized, "cookie without the header")
	if r.header.Get("Access-Control-Allow-Credentials") != "" {
		t.Fatal("credentials allowed to a stranger")
	}
	// With the header the hub answers, but without credentials in the
	// answer a browser throws it away; the header itself it could not add.
	r = e.do("GET", "", "/v1/me", "", "", "Cookie", cookie, "Origin", "https://evil.example.com", "X-Muxway-Client", "evil")
	if r.header.Get("Access-Control-Allow-Origin") != "*" || r.header.Get("Access-Control-Allow-Credentials") != "" {
		t.Fatalf("stranger with the header: origin %q credentials %q", r.header.Get("Access-Control-Allow-Origin"), r.header.Get("Access-Control-Allow-Credentials"))
	}
}

// 171: a peer's origin is echoed, with credentials and the client header
// allowed, on the preflight and on the request; the sign-in, agent and
// admin endpoints still answer no preflight, peer or not.
func TestSec171_PeerOriginIsEchoedWithCredentials(t *testing.T) {
	e := newEnv(t, "--peer", peer, "--peer", "https://lab.example.com")
	tok := e.token("browser", []string{"*"}, nil)
	for _, origin := range []string{peer, "https://lab.example.com"} {
		r := e.preflight(origin, "x-muxway-client, content-type")
		expect(t, r, http.StatusNoContent, "preflight from "+origin)
		if r.header.Get("Access-Control-Allow-Origin") != origin || r.header.Get("Access-Control-Allow-Credentials") != "true" {
			t.Fatalf("%s: origin %q credentials %q", origin, r.header.Get("Access-Control-Allow-Origin"), r.header.Get("Access-Control-Allow-Credentials"))
		}
		allowed := strings.ToLower(r.header.Get("Access-Control-Allow-Headers"))
		if !strings.Contains(allowed, "x-muxway-client") || !strings.Contains(allowed, "content-type") {
			t.Fatalf("%s: allowed headers %q", origin, allowed)
		}
		if !strings.Contains(r.header.Get("Vary"), "Origin") {
			t.Fatalf("%s: no Vary: Origin", origin)
		}
	}
	cookie := strings.SplitN(cookieOf(e.signIn(t, tok)), ";", 2)[0]
	remember(strings.TrimPrefix(cookie, "muxway_session="))
	r := e.do("GET", "", "/v1/me", "", "", "Cookie", cookie, "Origin", peer, "X-Muxway-Client", "web")
	expect(t, r, http.StatusOK, "the peer's page with the cookie and the header")
	if r.header.Get("Access-Control-Allow-Origin") != peer || r.header.Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatalf("request: origin %q credentials %q", r.header.Get("Access-Control-Allow-Origin"), r.header.Get("Access-Control-Allow-Credentials"))
	}
	if !strings.Contains(r.body, `"browser"`) {
		t.Fatalf("me from the peer's page: %s", r.body)
	}
	// Still nothing without the header, peer or not.
	expect(t, e.do("GET", "", "/v1/me", "", "", "Cookie", cookie, "Origin", peer), http.StatusUnauthorized, "peer without the header")
	for _, path := range []string{"/v1/auth", "/v1/auth/token", "/v1/auth/logout", "/v1/pair", "/v1/agent", "/v1/admin/overview", "/"} {
		r := e.do("OPTIONS", "", path, "", "", "Origin", peer, "Access-Control-Request-Method", "POST", "Access-Control-Request-Headers", "x-muxway-client")
		if r.status == http.StatusNoContent || r.header.Get("Access-Control-Allow-Origin") != "" {
			t.Fatalf("%s answers a peer's preflight: %d %q", path, r.status, r.header.Get("Access-Control-Allow-Origin"))
		}
	}
	// The web page may connect to the peers, and to nothing else new.
	page := e.do("GET", "", "/", "", "")
	expect(t, page, http.StatusOK, "the page")
	csp := page.header.Get("Content-Security-Policy")
	if !strings.Contains(csp, "connect-src 'self' "+peer+" https://lab.example.com;") {
		t.Fatalf("csp: %s", csp)
	}
}

// 172: the cookie is SameSite=Strict without peers and SameSite=None with
// them, Secure and HttpOnly either way; so is the cookie that clears it.
func TestSec172_CookieIsSameSiteNoneOnlyWithPeers(t *testing.T) {
	check := func(e *env, want string) {
		t.Helper()
		tok := e.token("browser", []string{"*"}, nil)
		set := cookieOf(e.signIn(t, tok))
		remember(strings.TrimPrefix(strings.SplitN(set, ";", 2)[0], "muxway_session="))
		for _, attr := range []string{"Secure", "HttpOnly", "SameSite=" + want} {
			if !strings.Contains(set, attr) {
				t.Fatalf("want %s in %q", attr, set)
			}
		}
		cleared := cookieOf(e.do("POST", "", "/v1/auth/logout", "", "", "Cookie", strings.SplitN(set, ";", 2)[0]))
		if !strings.Contains(cleared, "SameSite="+want) || !strings.Contains(cleared, "Max-Age=0") {
			t.Fatalf("cleared: %q", cleared)
		}
		csp := e.do("GET", "", "/", "", "").header.Get("Content-Security-Policy")
		if want == "Strict" && !strings.Contains(csp, "connect-src 'self';") {
			t.Fatalf("csp without peers: %s", csp)
		}
	}
	check(newEnv(t), "Strict")
	check(newEnv(t, "--peer", peer), "None")
	// A peer that is not an origin keeps the hub from starting at all.
	e := newEnv(t)
	for _, bad := range []string{"http://work.example.com", "work.example.com", peer + "/panes", "javascript:alert(1)"} {
		if _, err := e.cli("hub", "serve", "--dir", e.hubDir+"-x", "--listen", "127.0.0.1:0", "--peer", bad); err == nil || !strings.Contains(err.Error(), "--peer") {
			t.Fatalf("--peer %q: %v", bad, err)
		}
	}
}
