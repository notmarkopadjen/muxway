package hub

import (
	"context"
	"errors"
	"net/http"
	"net/netip"
	"runtime/debug"
	"sort"
	"time"
)

// The admin API: the same controls as the admin socket, for a principal
// with the admin flag. Not in the CORS list, so only the hub's own page
// and bearer clients reach it.

const (
	adminTokenTTL = 24 * time.Hour
	tokenTTL      = 30 * 24 * time.Hour
	userTTL       = 365 * 24 * time.Hour
	maxTTL        = 10 * 365 * 24 * time.Hour
	maxLogPage    = 500
)

var errNotFound = errors.New("not found")

func (h *Hub) adminRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/admin/overview", h.withAdmin(h.handleAdminOverview))
	mux.HandleFunc("GET /v1/admin/log", h.withAdmin(h.handleAdminLog))
	mux.HandleFunc("POST /v1/admin/tokens", h.withAdmin(h.handleAdminTokenCreate))
	mux.HandleFunc("DELETE /v1/admin/tokens/{id}", h.withAdmin(h.handleAdminTokenRevoke))
	mux.HandleFunc("POST /v1/admin/users", h.withAdmin(h.handleAdminUserCreate))
	mux.HandleFunc("DELETE /v1/admin/users/{id}", h.withAdmin(h.handleAdminUserRemove))
	mux.HandleFunc("DELETE /v1/admin/sessions/{id}", h.withAdmin(h.handleAdminSessionEnd))
	mux.HandleFunc("PUT /v1/admin/access", h.withAdmin(h.handleAdminAccess))
	mux.HandleFunc("POST /v1/admin/unlock", h.withAdmin(h.handleAdminUnlock))
}

func (h *Hub) withAdmin(next principalHandler) http.HandlerFunc {
	return h.withPrincipal(func(w http.ResponseWriter, r *http.Request, p Principal) {
		if !p.Admin {
			h.log.Warn("admin refused", "principal", p.ID, "path", r.URL.Path)
			fail(w, http.StatusForbidden, "forbidden")
			return
		}
		next(w, r, p)
	})
}

// The actions both the socket and the API take; by names who acted.

func (h *Hub) newToken(name string, read, write []string, admin bool, ttl time.Duration, by string) (string, Token, error) {
	if name == "" || len(name) > 64 || !cleanName(name) || len(read) == 0 {
		return "", Token{}, errors.New("a token needs a name and at least one read grant")
	}
	if err := checkGrants(read, write); err != nil {
		return "", Token{}, err
	}
	if ttl <= 0 {
		ttl = tokenTTL
		if admin {
			ttl = adminTokenTTL
		}
	}
	secret, t, err := h.store.createToken(name, read, write, admin, min(ttl, maxTTL))
	if err != nil {
		return "", Token{}, err
	}
	h.log.Info("token created", "token", t.ID, "name", t.Name, "admin", admin, "by", by)
	t.Hash = ""
	return secret, t, nil
}

func (h *Hub) newUser(email, name string, read, write []string, admin bool, ttl time.Duration, by string) (User, error) {
	if len(read) == 0 {
		return User{}, errors.New("a user needs at least one read grant")
	}
	if len(name) > 64 || !cleanName(name) {
		return User{}, errors.New("a name is at most 64 printable characters")
	}
	if err := checkGrants(read, write); err != nil {
		return User{}, err
	}
	if ttl <= 0 {
		ttl = userTTL
	}
	u, err := h.store.createUser(email, name, read, write, admin, min(ttl, maxTTL))
	if err != nil {
		return User{}, err
	}
	h.log.Info("user created", "user", u.ID, "admin", admin, "by", by)
	return u, nil
}

func checkGrants(read, write []string) error {
	if len(read)+len(write) > 64 {
		return errors.New("at most 64 grants")
	}
	return validPatterns(append(append([]string{}, read...), write...))
}

func (h *Hub) dropToken(id, by string) error {
	ok, err := h.store.revokeToken(id)
	if err != nil {
		return err
	}
	if !ok {
		return errNotFound
	}
	h.sessions.dropRef("token", id)
	h.bearers.forget(id)
	h.log.Info("token revoked", "token", id, "by", by)
	return nil
}

func (h *Hub) dropUser(key, by string) error {
	u, ok, err := h.store.removeUser(key)
	if err != nil {
		return err
	}
	if !ok {
		return errNotFound
	}
	h.sessions.dropRef("user", u.ID)
	h.log.Info("user removed", "user", u.ID, "by", by)
	return nil
}

func (h *Hub) putAccess(in Access, by string) (Access, error) {
	a, lists, err := parseAccess(in)
	if err != nil {
		return Access{}, err
	}
	if err := h.store.setAccess(a, lists); err != nil {
		return Access{}, err
	}
	h.log.Info("address lists changed", "allow", len(a.Allow), "deny", len(a.Deny), "by", by)
	return a, nil
}

// --- handlers ----------------------------------------------------------------

type tokenView struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Read    []string `json:"read"`
	Write   []string `json:"write"`
	Admin   bool     `json:"admin"`
	Created int64    `json:"created"`
	Expires int64    `json:"expires"`
}

type userView struct {
	ID      string   `json:"id"`
	Email   string   `json:"email"`
	Name    string   `json:"name"`
	Read    []string `json:"read"`
	Write   []string `json:"write"`
	Admin   bool     `json:"admin"`
	Created int64    `json:"created"`
	Expires int64    `json:"expires"`
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func viewToken(t Token) tokenView {
	return tokenView{t.ID, t.Name, nonNil(t.Read), nonNil(t.Write), t.Admin, t.Created.Unix(), t.Expires.Unix()}
}

func viewUser(u User) userView {
	return userView{u.ID, u.Email, u.Name, nonNil(u.Read), nonNil(u.Write), u.Admin, u.Created.Unix(), u.Expires.Unix()}
}

func hubVersion() string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "unknown"
	}
	rev, dirty := "", false
	for _, s := range info.Settings {
		switch s.Key {
		case "vcs.revision":
			rev = s.Value
		case "vcs.modified":
			dirty = s.Value == "true"
		}
	}
	if len(rev) > 12 {
		rev = rev[:12]
	}
	if rev == "" {
		return info.Main.Version
	}
	if dirty {
		rev += "+dirty"
	}
	return rev
}

func (h *Hub) handleAdminOverview(w http.ResponseWriter, r *http.Request, p Principal) {
	type agentView struct {
		Host      string `json:"host"`
		Online    bool   `json:"online"`
		Paired    int64  `json:"paired"`
		Connected int64  `json:"connected,omitempty"`
		Addr      string `json:"addr,omitempty"`
	}
	type clientView struct {
		Kind      string `json:"kind"`
		ID        string `json:"id,omitempty"`
		Client    string `json:"client"`
		Principal string `json:"principal"`
		Method    string `json:"method"`
		Addr      string `json:"addr"`
		Since     int64  `json:"since"`
		Seen      int64  `json:"seen"`
		Expires   int64  `json:"expires,omitempty"`
	}
	type lockView struct {
		Addr  string `json:"addr"`
		Until int64  `json:"until"`
	}
	var providers []string
	for _, prov := range h.cfg.Providers {
		providers = append(providers, prov.Name())
	}
	facts := map[string]any{"version": hubVersion(), "tls": h.cfg.TLSCert != "", "trust_proxy": h.cfg.TrustProxy,
		"providers": nonNil(providers), "transcriber": h.hasSTT(), "web": !h.cfg.NoWeb, "public_url": h.cfg.PublicURL,
		"session_ttl": int64(h.cfg.SessionTTL / time.Second)}

	agents := []agentView{}
	h.store.mu.RLock()
	for host, rec := range h.store.s.Agents {
		agents = append(agents, agentView{Host: host, Paired: rec.Paired.Unix()})
	}
	h.store.mu.RUnlock()
	for i := range agents {
		if a := h.agent(agents[i].Host); a != nil {
			agents[i].Online, agents[i].Connected, agents[i].Addr = true, a.since.Unix(), a.addr
		}
	}
	sort.Slice(agents, func(i, j int) bool { return agents[i].Host < agents[j].Host })

	tokens, users := []tokenView{}, []userView{}
	for _, t := range h.store.tokens() {
		tokens = append(tokens, viewToken(t))
	}
	for _, u := range h.store.users() {
		users = append(users, viewUser(u))
	}

	clients := []clientView{}
	for _, s := range h.sessions.list() {
		clients = append(clients, clientView{"session", s.handle, s.client, s.ref, s.method, s.addr,
			s.created.Unix(), s.seen.Unix(), s.expires.Unix()})
	}
	for _, b := range h.bearers.list() {
		clients = append(clients, clientView{Kind: "bearer", Client: b.Client, Principal: b.Token, Method: "token",
			Addr: b.Addr, Since: b.First.Unix(), Seen: b.Seen.Unix()})
	}
	sort.Slice(clients, func(i, j int) bool { return clients[i].Seen > clients[j].Seen })

	locked := []lockView{}
	for addr, until := range h.limits.lockedOut() {
		locked = append(locked, lockView{addr, until.Unix()})
	}
	sort.Slice(locked, func(i, j int) bool { return locked[i].Addr < locked[j].Addr })

	reply(w, map[string]any{"hub": facts, "agents": agents, "tokens": tokens, "users": users, "clients": clients,
		"locked": locked, "access": h.store.access(), "you": map[string]string{"id": p.ID, "addr": h.clientAddr(r)}})
}

func (h *Hub) handleAdminLog(w http.ResponseWriter, r *http.Request, p Principal) {
	limit, ok1 := intParam(r, "limit", 200, 1, maxLogPage)
	wait, ok2 := intParam(r, "wait", 0, 0, int(maxWait/time.Second))
	cursor, ok3 := ^uint64(0), true
	if s := r.URL.Query().Get("after"); s != "" {
		cursor, ok3 = parseCursor(s)
	}
	if !ok1 || !ok2 || !ok3 {
		fail(w, http.StatusBadRequest, "bad_parameter")
		return
	}
	deadline := time.Now().Add(time.Duration(wait) * time.Second)
	recs, next := h.logs.after(cursor, limit)
	for len(recs) == 0 && time.Now().Before(deadline) && r.Context().Err() == nil {
		ctx, cancel := context.WithDeadline(r.Context(), deadline)
		h.logs.wait(ctx, next)
		cancel()
		recs, next = h.logs.after(next, limit)
	}
	if recs == nil {
		recs = []LogRecord{}
	}
	reply(w, map[string]any{"records": recs, "next": next})
}

func (h *Hub) handleAdminTokenCreate(w http.ResponseWriter, r *http.Request, p Principal) {
	var in struct {
		Name  string   `json:"name"`
		Read  []string `json:"read"`
		Write []string `json:"write"`
		TTL   int64    `json:"ttl"`
		Admin bool     `json:"admin"`
	}
	if !decodeBody(w, r, &in) {
		return
	}
	if in.TTL < 0 || in.TTL > int64(maxTTL/time.Second) {
		fail(w, http.StatusBadRequest, "bad_input")
		return
	}
	secret, t, err := h.newToken(in.Name, in.Read, in.Write, in.Admin, time.Duration(in.TTL)*time.Second, p.ID)
	if err != nil {
		fail(w, http.StatusBadRequest, "bad_input")
		return
	}
	created(w, map[string]any{"secret": secret, "token": viewToken(t)})
}

func (h *Hub) handleAdminTokenRevoke(w http.ResponseWriter, r *http.Request, p Principal) {
	h.answer(w, h.dropToken(r.PathValue("id"), p.ID))
}

func (h *Hub) handleAdminUserCreate(w http.ResponseWriter, r *http.Request, p Principal) {
	var in struct {
		Email string   `json:"email"`
		Name  string   `json:"name"`
		Read  []string `json:"read"`
		Write []string `json:"write"`
		TTL   int64    `json:"ttl"`
		Admin bool     `json:"admin"`
	}
	if !decodeBody(w, r, &in) {
		return
	}
	if in.TTL < 0 || in.TTL > int64(maxTTL/time.Second) {
		fail(w, http.StatusBadRequest, "bad_input")
		return
	}
	u, err := h.newUser(in.Email, in.Name, in.Read, in.Write, in.Admin, time.Duration(in.TTL)*time.Second, p.ID)
	if err != nil {
		fail(w, http.StatusBadRequest, "bad_input")
		return
	}
	created(w, map[string]any{"user": viewUser(u)})
}

func (h *Hub) handleAdminUserRemove(w http.ResponseWriter, r *http.Request, p Principal) {
	h.answer(w, h.dropUser(r.PathValue("id"), p.ID))
}

func (h *Hub) handleAdminSessionEnd(w http.ResponseWriter, r *http.Request, p Principal) {
	sess, ok := h.sessions.dropHandle(r.PathValue("id"))
	if !ok {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	h.log.Info("session ended", "session", sess.handle, "principal", sess.ref, "by", p.ID)
	w.WriteHeader(http.StatusNoContent)
}

// handleAdminAccess replaces both lists, refusing a change that would
// shut out the caller unless asked to with force=1.
func (h *Hub) handleAdminAccess(w http.ResponseWriter, r *http.Request, p Principal) {
	var in Access
	if !decodeLimited(w, r, &in, 64<<10) {
		return
	}
	a, lists, err := parseAccess(in)
	if err != nil {
		fail(w, http.StatusBadRequest, "bad_input")
		return
	}
	if addr := h.clientAddr(r); !lists.admits(addr) && r.URL.Query().Get("force") != "1" {
		fail(w, http.StatusConflict, "self_lockout")
		return
	}
	a, err = h.putAccess(a, p.ID)
	if err != nil {
		fail(w, http.StatusInternalServerError, "store_failed")
		return
	}
	reply(w, a)
}

func (h *Hub) handleAdminUnlock(w http.ResponseWriter, r *http.Request, p Principal) {
	var in struct {
		Addr string `json:"addr"`
	}
	if !decodeBody(w, r, &in) {
		return
	}
	if _, err := netip.ParseAddr(in.Addr); err != nil {
		fail(w, http.StatusBadRequest, "bad_input")
		return
	}
	if !h.limits.unlock(in.Addr) {
		fail(w, http.StatusNotFound, "not_found")
		return
	}
	h.log.Info("address unlocked", "addr", in.Addr, "by", p.ID)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Hub) answer(w http.ResponseWriter, err error) {
	switch {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, errNotFound):
		fail(w, http.StatusNotFound, "not_found")
	default:
		fail(w, http.StatusInternalServerError, "store_failed")
	}
}
