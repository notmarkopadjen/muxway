package hub

import (
	"errors"
	"net/http"
	"net/url"
	"strings"
)

// cors lets a page on another origin, such as a glasses app's WebView,
// call the client endpoints with a bearer token. Credentials are never
// allowed, so a session cookie is of no use to such a page, and the
// sign-in and agent endpoints get none of these headers.
//
// A peer is the exception: the owner's other hub, named with --peer. Its
// page gets its origin echoed, credentials allowed and the client header
// among the allowed ones, so a browser signed in here can list and use
// this hub's panes from that page. Any other origin keeps the wildcard.
func (h *Hub) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if corsPath(r.URL.Path) {
			hd := w.Header()
			origin := r.Header.Get("Origin")
			peer := h.isPeer(origin)
			if peer {
				hd.Set("Access-Control-Allow-Origin", origin)
				hd.Set("Access-Control-Allow-Credentials", "true")
				hd.Add("Vary", "Origin")
			} else {
				hd.Set("Access-Control-Allow-Origin", "*")
			}
			hd.Set("Access-Control-Expose-Headers", "ETag")
			if r.Method == http.MethodOptions {
				hd.Set("Access-Control-Allow-Methods", "GET, POST")
				allowed := "Authorization, X-Muxway-Token, Content-Type, Accept, If-None-Match"
				if peer {
					allowed += ", " + clientHeader
				}
				hd.Set("Access-Control-Allow-Headers", allowed)
				hd.Set("Access-Control-Max-Age", "600")
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (h *Hub) isPeer(origin string) bool {
	if origin == "" {
		return false
	}
	for _, p := range h.cfg.Peers {
		if p == origin {
			return true
		}
	}
	return false
}

func corsPath(p string) bool {
	for _, base := range []string{"/v1/hosts", "/v1/panes", "/v1/inbox", "/v1/events", "/v1/windows", "/v1/me", "/v1/transcribe"} {
		if p == base || strings.HasPrefix(p, base+"/") {
			return true
		}
	}
	return false
}

// PeerOrigin checks a --peer value: an https origin, or http to this
// machine, with nothing after the host. The browser compares origins
// byte for byte, so that is what is kept.
func PeerOrigin(s string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(s))
	if err != nil {
		return "", err
	}
	loopback := u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1"
	if u.Scheme != "https" && !(u.Scheme == "http" && loopback) {
		return "", errors.New("a peer is an https origin, or http to this machine")
	}
	if u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return "", errors.New("a peer is an origin alone: scheme://host[:port]")
	}
	return u.Scheme + "://" + strings.ToLower(u.Host), nil
}
