package hub

import (
	"net/http"
	"strings"
)

// cors lets a page on another origin, such as a glasses app's WebView,
// call the client endpoints with a bearer token. Credentials are never
// allowed, so a session cookie is of no use to such a page, and the
// sign-in and agent endpoints get none of these headers.
func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if corsPath(r.URL.Path) {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", "*")
			h.Set("Access-Control-Expose-Headers", "ETag")
			if r.Method == http.MethodOptions {
				h.Set("Access-Control-Allow-Methods", "GET, POST")
				h.Set("Access-Control-Allow-Headers", "Authorization, X-Muxway-Token, Content-Type, Accept, If-None-Match")
				h.Set("Access-Control-Max-Age", "600")
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func corsPath(p string) bool {
	for _, base := range []string{"/v1/hosts", "/v1/panes", "/v1/events", "/v1/windows", "/v1/me"} {
		if p == base || strings.HasPrefix(p, base+"/") {
			return true
		}
	}
	return false
}
