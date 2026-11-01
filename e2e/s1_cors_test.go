//go:build e2e

package e2e

import (
	"net/http"
	"strings"
	"testing"
)

// 16: a page on another origin may use a bearer token and nothing else.
func TestSec16_CORSForBearerTokensOnly(t *testing.T) {
	e, _, _ := basic(t)
	tok := e.token("glasses", []string{host + "/*"}, []string{host + "/*"})
	for _, path := range []string{"/v1/panes", "/v1/panes/" + shell0, "/v1/panes/" + shell0 + "/input", "/v1/inbox", "/v1/events", "/v1/hosts", "/v1/me"} {
		r := e.do("OPTIONS", "", path, "", "", "Origin", "null", "Access-Control-Request-Method", "POST",
			"Access-Control-Request-Headers", "authorization, x-muxway-client")
		expect(t, r, http.StatusNoContent, "preflight "+path)
		if r.header.Get("Access-Control-Allow-Origin") != "*" {
			t.Fatalf("preflight %s: no allow-origin", path)
		}
		allowed := strings.ToLower(r.header.Get("Access-Control-Allow-Headers"))
		if !strings.Contains(allowed, "authorization") || strings.Contains(allowed, "x-muxway-client") {
			t.Fatalf("preflight %s: allowed headers %q", path, allowed)
		}
		if r.header.Get("Access-Control-Allow-Credentials") != "" {
			t.Fatalf("preflight %s: credentials allowed", path)
		}
	}
	r := e.do("GET", tok, "/v1/panes", "text/plain", "", "Origin", "null")
	expect(t, r, http.StatusOK, "list from another origin")
	if r.header.Get("Access-Control-Allow-Origin") != "*" || r.header.Get("Access-Control-Expose-Headers") != "ETag" {
		t.Fatalf("list: origin %q exposed %q", r.header.Get("Access-Control-Allow-Origin"), r.header.Get("Access-Control-Expose-Headers"))
	}
	if r.header.Get("Access-Control-Allow-Credentials") != "" {
		t.Fatal("list: credentials allowed")
	}
	// A preflight never counts as an authentication, so it is not rate limited or locked out.
	for i := 0; i < 15; i++ {
		expect(t, e.do("OPTIONS", "", "/v1/panes", "", "", "Origin", "null"), http.StatusNoContent, "repeated preflight")
	}
	expect(t, e.do("GET", tok, "/v1/panes", "", "", "Origin", "null"), http.StatusOK, "still allowed")
	for _, path := range []string{"/v1/auth", "/v1/auth/token", "/v1/auth/logout", "/v1/pair", "/v1/agent", "/"} {
		r := e.do("OPTIONS", "", path, "", "", "Origin", "null", "Access-Control-Request-Method", "POST")
		if r.status == http.StatusNoContent || r.header.Get("Access-Control-Allow-Origin") != "" {
			t.Fatalf("%s answers a preflight: %d %q", path, r.status, r.header.Get("Access-Control-Allow-Origin"))
		}
	}
}
