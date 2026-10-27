package hub

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/notmarkopadjen/muxway/internal/auth"
)

// Signing in: with a token pasted once, or through an identity provider.
// Either way the result is a session cookie.

func (h *Hub) handleAuthMethods(w http.ResponseWriter, r *http.Request) {
	methods := []string{"token"}
	out := map[string]any{}
	for _, p := range h.cfg.Providers {
		methods = append(methods, p.Name())
		out[p.Name()] = map[string]string{"label": p.Label()}
	}
	out["methods"] = methods
	reply(w, out)
}

func (h *Hub) handleAuthToken(w http.ResponseWriter, r *http.Request) {
	addr := h.clientAddr(r)
	if h.limits.isLocked(addr) {
		fail(w, http.StatusTooManyRequests, "locked_out")
		return
	}
	var in struct {
		Token string `json:"token"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		fail(w, http.StatusBadRequest, "bad_json")
		return
	}
	if _, err := dec.Token(); err != io.EOF {
		fail(w, http.StatusBadRequest, "bad_json")
		return
	}
	t, ok := h.store.lookupToken(in.Token)
	if !ok {
		h.limits.fail(addr)
		h.log.Warn("sign-in failed", "method", "token", "addr", addr)
		fail(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	sess := h.sessions.create("token", t.ID, "token", clientType(r), addr)
	h.setSessionCookie(w, sess)
	h.log.Info("signed in", "method", "token", "token", t.ID, "addr", addr)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Hub) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		h.sessions.drop(c.Value)
	}
	h.clearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Hub) handleMe(w http.ResponseWriter, r *http.Request, p Principal) {
	write := p.Write
	if write == nil {
		write = []string{}
	}
	out := map[string]any{"id": p.ID, "name": p.Name, "method": p.Method, "read": p.Read, "write": write,
		"expires": p.Expires.Unix()}
	if p.Admin {
		out["admin"] = true
	}
	reply(w, out)
}

func (h *Hub) handleSignInStart(prov auth.Provider) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		addr := h.clientAddr(r)
		if h.limits.isLocked(addr) {
			fail(w, http.StatusTooManyRequests, "locked_out")
			return
		}
		if err := prov.Start(w, r); err != nil {
			h.log.Warn("sign-in could not start", "method", prov.Name(), "err", err)
			fail(w, http.StatusBadGateway, "provider_unavailable")
		}
	}
}

// handleSignInFinish takes the identity the provider verified and lets in
// only an e-mail the owner created a user for.
func (h *Hub) handleSignInFinish(prov auth.Provider) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		addr := h.clientAddr(r)
		if h.limits.isLocked(addr) {
			fail(w, http.StatusTooManyRequests, "locked_out")
			return
		}
		id, err := prov.Finish(w, r)
		if err != nil {
			h.limits.fail(addr)
			var unavailable *auth.ProviderError
			if errors.As(err, &unavailable) {
				h.log.Warn("sign-in failed at the provider", "method", prov.Name(), "err", err)
				fail(w, http.StatusBadGateway, "provider_unavailable")
				return
			}
			h.log.Warn("sign-in failed", "method", prov.Name(), "addr", addr, "err", err)
			fail(w, http.StatusUnauthorized, "sign_in_failed")
			return
		}
		u, ok := h.store.userByEmail(id.Email)
		if !ok {
			h.limits.fail(addr)
			h.log.Warn("sign-in refused, no account", "method", prov.Name(), "user", userID(id.Email), "addr", addr)
			fail(w, http.StatusForbidden, "no_account")
			return
		}
		sess := h.sessions.create("user", u.ID, prov.Name(), clientType(r), addr)
		h.setSessionCookie(w, sess)
		h.log.Info("signed in", "method", prov.Name(), "user", u.ID, "addr", addr)
		// Not a redirect: the browser is still on a cross-site navigation
		// from the provider, on which it withholds a SameSite=Strict cookie.
		// A hop the page itself makes is same-site and carries it.
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Content-Security-Policy", "default-src 'none'")
		io.WriteString(w, signedInPage)
	}
}

const signedInPage = `<!doctype html>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=/">
<title>muxway</title>
<p>Signed in. <a href="/">Continue</a></p>
`
