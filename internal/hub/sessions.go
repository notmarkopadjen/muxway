package hub

import (
	"net/http"
	"sync"
	"time"

	"github.com/notmarkopadjen/muxway/internal/secure"
)

// A session is a signed-in browser: a random id in a cookie that stands
// for a token or a user. It lives in memory and dies with the hub. The
// principal behind it is looked up afresh on every request, so revoking
// the token or removing the user ends the session at once.
const (
	sessionCookie = "muxway_session"
	// A cookie counts only together with this header, which a browser
	// cannot add cross-origin without a preflight the hub never answers.
	clientHeader = "X-Muxway-Client"
)

type session struct {
	id      string
	kind    string // "token" or "user"
	ref     string // the token's or user's id
	method  string
	created time.Time
	expires time.Time
}

type sessions struct {
	mu  sync.Mutex
	m   map[string]*session
	ttl time.Duration
}

func newSessions(ttl time.Duration) *sessions {
	return &sessions{m: map[string]*session{}, ttl: ttl}
}

func (s *sessions) create(kind, ref, method string) *session {
	now := time.Now()
	sess := &session{id: secure.Random(32), kind: kind, ref: ref, method: method, created: now, expires: now.Add(s.ttl)}
	s.mu.Lock()
	for id, old := range s.m {
		if now.After(old.expires) {
			delete(s.m, id)
		}
	}
	s.m[sess.id] = sess
	s.mu.Unlock()
	return sess
}

func (s *sessions) get(id string) (*session, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.m[id]
	if !ok {
		return nil, false
	}
	if time.Now().After(sess.expires) {
		delete(s.m, id)
		return nil, false
	}
	return sess, true
}

func (s *sessions) drop(id string) {
	s.mu.Lock()
	delete(s.m, id)
	s.mu.Unlock()
}

// dropRef ends every session of one token or user.
func (s *sessions) dropRef(kind, ref string) {
	s.mu.Lock()
	for id, sess := range s.m {
		if sess.kind == kind && sess.ref == ref {
			delete(s.m, id)
		}
	}
	s.mu.Unlock()
}

// sessionPrincipal resolves a cookie value to a live principal.
func (h *Hub) sessionPrincipal(id string) (Principal, bool) {
	sess, ok := h.sessions.get(id)
	if !ok {
		return Principal{}, false
	}
	var p Principal
	switch sess.kind {
	case "token":
		t, ok := h.store.tokenByID(sess.ref)
		if !ok {
			return Principal{}, false
		}
		p = t.principal()
	case "user":
		u, ok := h.store.userByID(sess.ref)
		if !ok {
			return Principal{}, false
		}
		p = u.principal(sess.method)
	default:
		return Principal{}, false
	}
	if sess.expires.Before(p.Expires) {
		p.Expires = sess.expires
	}
	return p, true
}

func setSessionCookie(w http.ResponseWriter, sess *session) {
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: sess.id, Path: "/", Expires: sess.expires,
		HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode})
}

func clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode})
}
