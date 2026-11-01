//go:build e2e

package e2e

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// The web client as an installable app: the manifest and the service
// worker are files of the client, served so the browser asks for them
// again at every open, under a policy that allows them and nothing more.

// 130
func TestSec130_TheWorkerAndTheManifestAreServedFreshUnderThePolicy(t *testing.T) {
	e := newEnv(t)
	for _, path := range []string{"/sw.js", "/manifest.webmanifest"} {
		r := e.do("GET", "", path, "", "")
		expect(t, r, http.StatusOK, path)
		if cc := r.header.Get("Cache-Control"); cc != "no-cache" {
			t.Fatalf("%s: Cache-Control %q", path, cc)
		}
		csp := r.header.Get("Content-Security-Policy")
		for _, want := range []string{"worker-src 'self'", "manifest-src 'self'", "default-src 'none'"} {
			if !strings.Contains(csp, want) {
				t.Fatalf("%s: the policy lacks %q: %s", path, want, csp)
			}
		}
		expect(t, e.do("POST", "", path, "", ""), http.StatusNotFound, "POST "+path)
	}
	sw := e.do("GET", "", "/sw.js", "", "")
	if sw.header.Get("Service-Worker-Allowed") != "/" {
		t.Fatal("sw.js without Service-Worker-Allowed")
	}
	// The build stamped the worker: a real stamp and the hashed assets, no
	// placeholder left, and the API path is the one the worker steps aside for.
	if strings.Contains(sw.body, "__MX_") || strings.Contains(sw.body, "mx-assets */ []") || !strings.Contains(sw.body, `"/assets/`) || !strings.Contains(sw.body, `startsWith('/v1/')`) {
		t.Fatalf("sw.js is not the stamped worker:\n%.300s", sw.body)
	}
	var m struct {
		Name    string `json:"name"`
		Display string `json:"display"`
		Start   string `json:"start_url"`
		Icons   []struct {
			Src   string `json:"src"`
			Sizes string `json:"sizes"`
		} `json:"icons"`
	}
	manifest := e.do("GET", "", "/manifest.webmanifest", "", "")
	if err := json.Unmarshal([]byte(manifest.body), &m); err != nil || m.Name != "muxway" || m.Display != "standalone" || m.Start != "/" || len(m.Icons) < 3 {
		t.Fatalf("manifest: %v %s", err, manifest.body)
	}
	for _, icon := range m.Icons {
		r := e.do("GET", "", icon.Src, "", "")
		expect(t, r, http.StatusOK, icon.Src)
		if !strings.HasPrefix(r.body, "\x89PNG") {
			t.Fatalf("%s is not a PNG", icon.Src)
		}
	}
	// The assets stay immutable, the page stays no-store-free but short-lived.
	if cc := e.do("GET", "", "/icon.svg", "", "").header.Get("Cache-Control"); cc != "public, max-age=3600" {
		t.Fatalf("icon.svg: Cache-Control %q", cc)
	}
	// Nothing of the API is cacheable, as before.
	if cc := e.do("GET", "", "/v1/auth", "", "").header.Get("Cache-Control"); cc != "no-store" {
		t.Fatalf("/v1/auth: Cache-Control %q", cc)
	}
}
