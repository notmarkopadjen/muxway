package hub

import (
	"io/fs"
	"net/http"
	"strings"

	"github.com/notmarkopadjen/muxway/web"
)

// The web client: index.html for every path that is not a file or the
// API, Vite's hashed assets with a long cache life, and a content security
// policy that allows nothing but the client's own files.
const webCSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; " +
	"connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"

func (h *Hub) webHandler() http.Handler {
	files := web.Files()
	static := http.FileServerFS(files)
	index, err := fs.ReadFile(files, "index.html")
	if err != nil {
		panic("web client not built: " + err.Error())
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			fail(w, http.StatusNotFound, "not_found")
			return
		}
		w.Header().Set("Content-Security-Policy", webCSP)
		name := strings.TrimPrefix(r.URL.Path, "/")
		if name != "" && name != "index.html" {
			if f, err := files.Open(name); err == nil {
				f.Close()
				if strings.HasPrefix(name, "assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				} else {
					w.Header().Set("Cache-Control", "public, max-age=3600")
				}
				static.ServeHTTP(w, r)
				return
			}
		}
		if !appRoute(r.URL.Path) {
			fail(w, http.StatusNotFound, "not_found")
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(index)
	})
}

// appRoute lists the paths the client renders; anything else is a 404
// like before, never the page.
func appRoute(p string) bool {
	return p == "/" || p == "/signin" || strings.HasPrefix(p, "/p/") || strings.HasPrefix(p, "/w/") ||
		strings.HasPrefix(p, "/b/")
}
