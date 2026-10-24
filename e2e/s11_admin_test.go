//go:build e2e

package e2e

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The admin overview: a principal with the admin flag reads the hub's
// log, manages tokens and sessions and sets the address lists.

func (e *env) adminToken() string {
	e.t.Helper()
	tok := e.mustCLI("hub", "token", "create", "--dir", e.hubDir, "--name", "admin", "--read", host+"/*", "--admin")
	remember(tok)
	return tok
}

type overview struct {
	Hub    map[string]any `json:"hub"`
	Tokens []struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Admin bool   `json:"admin"`
	} `json:"tokens"`
	Clients []struct {
		Kind      string `json:"kind"`
		ID        string `json:"id"`
		Client    string `json:"client"`
		Principal string `json:"principal"`
		Addr      string `json:"addr"`
	} `json:"clients"`
	Access struct {
		Allow []string `json:"allow"`
		Deny  []string `json:"deny"`
	} `json:"access"`
	You struct {
		Addr string `json:"addr"`
	} `json:"you"`
}

func (e *env) overview(tok string, headers ...string) overview {
	e.t.Helper()
	r := e.do("GET", tok, "/v1/admin/overview", "", "", headers...)
	expect(e.t, r, http.StatusOK, "overview")
	var o overview
	if err := json.Unmarshal([]byte(r.body), &o); err != nil {
		e.t.Fatalf("overview: %v", err)
	}
	return o
}

func (o overview) tokenID(name string) string {
	for _, t := range o.Tokens {
		if t.Name == name {
			return t.ID
		}
	}
	return ""
}

type logPage struct {
	Records []struct {
		Seq   uint64            `json:"seq"`
		Level string            `json:"level"`
		Msg   string            `json:"msg"`
		Attrs map[string]string `json:"attrs"`
	} `json:"records"`
	Next uint64 `json:"next"`
}

func (e *env) adminLog(tok, query string, headers ...string) logPage {
	e.t.Helper()
	r := e.do("GET", tok, "/v1/admin/log"+query, "", "", headers...)
	expect(e.t, r, http.StatusOK, "log")
	var p logPage
	if err := json.Unmarshal([]byte(r.body), &p); err != nil {
		e.t.Fatalf("log: %v", err)
	}
	return p
}

func adminEndpoints() [][3]string {
	return [][3]string{
		{"GET", "/v1/admin/overview", ""},
		{"GET", "/v1/admin/log", ""},
		{"POST", "/v1/admin/tokens", `{"name":"sneaky","read":["*"],"write":["*"],"admin":true}`},
		{"DELETE", "/v1/admin/tokens/00000000", ""},
		{"POST", "/v1/admin/users", `{"email":"bob@example.com","read":["*"],"admin":true}`},
		{"DELETE", "/v1/admin/users/00000000", ""},
		{"DELETE", "/v1/admin/sessions/00000000", ""},
		{"PUT", "/v1/admin/access", `{"allow":[],"deny":["192.0.2.0/24"]}`},
		{"POST", "/v1/admin/unlock", `{"addr":"192.0.2.1"}`},
	}
}

// 100
func TestSec100_AdminEndpointsNeedTheAdminFlag(t *testing.T) {
	e, idp := oidcEnv(t)
	writer := e.token("writer", []string{"*"}, []string{"*"})
	e.mustCLI("hub", "user", "create", "--dir", e.hubDir, "--email", idp.Account.Email, "--read", "*", "--write", "*")
	status, cookie := e.oidcSignIn(idp, nil)
	if status != http.StatusOK || cookie == "" {
		t.Fatalf("user sign-in: %d", status)
	}
	before := e.mustCLI("hub", "token", "list", "--dir", e.hubDir)
	for _, ep := range adminEndpoints() {
		expect(t, e.do(ep[0], "", ep[1], "", ep[2]), http.StatusUnauthorized, "no credential "+ep[1])
		expect(t, e.do(ep[0], writer, ep[1], "", ep[2]), http.StatusForbidden, "write-everything token "+ep[1])
		expect(t, e.withSession(cookie, ep[0], ep[1], ep[2], true), http.StatusForbidden, "user without the flag "+ep[1])
	}
	if after := e.mustCLI("hub", "token", "list", "--dir", e.hubDir); after != before {
		t.Fatalf("tokens changed:\n%s\n%s", before, after)
	}
	if out := e.mustCLI("hub", "access", "list", "--dir", e.hubDir); out != "" {
		t.Fatalf("address lists changed: %q", out)
	}
	if r := e.get(writer, "/v1/me"); strings.Contains(r.body, "admin") {
		t.Fatalf("/v1/me of a non-admin says admin: %s", r.body)
	}
	admin := e.adminToken()
	if r := e.get(admin, "/v1/me"); !strings.Contains(r.body, `"admin":true`) {
		t.Fatalf("/v1/me of an admin: %s", r.body)
	}
	e.overview(admin)
}

// 101
func TestSec101_AdminEndpointsHaveNoCORS(t *testing.T) {
	e := newEnv(t)
	admin := e.adminToken()
	for _, ep := range adminEndpoints() {
		r := e.do("OPTIONS", "", ep[1], "", "", "Origin", "https://evil.example.com", "Access-Control-Request-Method", ep[0],
			"Access-Control-Request-Headers", "authorization")
		expect(t, r, http.StatusNotFound, "preflight "+ep[1])
		if r.header.Get("Access-Control-Allow-Origin") != "" {
			t.Fatalf("preflight %s allows an origin", ep[1])
		}
	}
	r := e.do("GET", admin, "/v1/admin/overview", "", "", "Origin", "https://evil.example.com")
	expect(t, r, http.StatusOK, "overview with an origin")
	if r.header.Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("overview answers with an allowed origin")
	}
}

// 102
func TestSec102_CreatedSecretsAppearInNoLogOrOverview(t *testing.T) {
	e := newEnv(t)
	admin := e.adminToken()
	r := e.post(admin, "/v1/admin/tokens", `{"name":"phone","read":["`+host+`/*"],"write":["`+host+`/work/*"],"ttl":3600}`)
	expect(t, r, http.StatusCreated, "create token")
	var out struct {
		Secret string `json:"secret"`
		Token  struct {
			ID      string `json:"id"`
			Admin   bool   `json:"admin"`
			Expires int64  `json:"expires"`
		} `json:"token"`
	}
	json.Unmarshal([]byte(r.body), &out)
	remember(out.Secret)
	if !strings.HasPrefix(out.Secret, "mxt_") || out.Token.Admin || out.Token.Expires-time.Now().Unix() > 3700 {
		t.Fatalf("created: %s", r.body)
	}
	if strings.Contains(r.body, `"hash"`) {
		t.Fatalf("the response carries a hash: %s", r.body)
	}
	expect(t, e.get(out.Secret, "/v1/me"), http.StatusOK, "the new token works")
	sum := sha256.Sum256([]byte(out.Secret))
	hash := hex.EncodeToString(sum[:])
	logBody := e.do("GET", admin, "/v1/admin/log?limit=500", "", "").body
	overviewBody := e.do("GET", admin, "/v1/admin/overview", "", "").body
	for name, body := range map[string]string{"log": logBody, "overview": overviewBody} {
		for _, s := range []string{out.Secret, hash, admin} {
			if strings.Contains(body, s) {
				t.Fatalf("the %s holds a secret or its hash (%s...)", name, s[:6])
			}
		}
	}
	if !strings.Contains(logBody, `"token created"`) || !strings.Contains(logBody, out.Token.ID) {
		t.Fatalf("the log does not record the creation: %s", logBody)
	}
	// An admin token made without a lifetime lives a day.
	r = e.post(admin, "/v1/admin/tokens", `{"name":"helper","read":["*"],"admin":true}`)
	expect(t, r, http.StatusCreated, "create admin token")
	json.Unmarshal([]byte(r.body), &out)
	remember(out.Secret)
	if left := out.Token.Expires - time.Now().Unix(); !out.Token.Admin || left > 24*3600+60 || left < 24*3600-60 {
		t.Fatalf("admin token: %s", r.body)
	}
	expect(t, e.post(admin, "/v1/admin/tokens", `{"name":"bad","read":["a/b/c/d"]}`), http.StatusBadRequest, "bad grant")
	expect(t, e.post(admin, "/v1/admin/tokens", `{"name":"","read":["*"]}`), http.StatusBadRequest, "no name")
	expect(t, e.post(admin, "/v1/admin/tokens", `{"name":"x","read":["*"],"extra":1}`), http.StatusBadRequest, "unknown field")
}

// 103
func TestSec103_AccessListsRefuseToShutOutTheCaller(t *testing.T) {
	e := newEnv(t, "--trust-proxy")
	admin := e.adminToken()
	me := []string{"X-Forwarded-For", "198.51.100.7"}
	if o := e.overview(admin, me...); o.You.Addr != "198.51.100.7" {
		t.Fatalf("the hub sees the caller as %q", o.You.Addr)
	}
	for _, body := range []string{`{"allow":[],"deny":["198.51.100.0/24"]}`, `{"allow":["192.0.2.0/24"],"deny":[]}`,
		`{"allow":["198.51.100.0/24"],"deny":["198.51.100.7"]}`} {
		r := e.do("PUT", admin, "/v1/admin/access", "", body, me...)
		expect(t, r, http.StatusConflict, "self-lockout "+body)
		if !strings.Contains(r.body, "self_lockout") {
			t.Fatalf("refusal: %s", r.body)
		}
	}
	if o := e.overview(admin, me...); len(o.Access.Allow)+len(o.Access.Deny) != 0 {
		t.Fatalf("lists changed after a refusal: %+v", o.Access)
	}
	expect(t, e.do("PUT", admin, "/v1/admin/access?force=1", "", `{"allow":[],"deny":["198.51.100.0/24"]}`, me...),
		http.StatusOK, "forced")
	expect(t, e.do("GET", admin, "/v1/admin/overview", "", "", me...), http.StatusForbidden, "shut out")
	expect(t, e.do("GET", admin, "/v1/admin/overview", "", "", "X-Forwarded-For", "192.0.2.10"), http.StatusOK, "another address")
	raw, _ := os.ReadFile(filepath.Join(e.hubDir, "hub.json"))
	if !strings.Contains(string(raw), "198.51.100.0/24") {
		t.Fatal("the list is not stored")
	}
}

// 104
func TestSec104_DeniedAddressIsRefusedBeforeAnyCredential(t *testing.T) {
	e := newEnv(t, "--trust-proxy")
	admin := e.adminToken()
	good := e.token("good", []string{host + "/*"}, nil)
	ok := []string{"X-Forwarded-For", "192.0.2.10"}
	bad := []string{"X-Forwarded-For", "203.0.113.9"}
	expect(t, e.do("PUT", admin, "/v1/admin/access", "", `{"allow":[],"deny":["203.0.113.0/24"]}`, ok...), http.StatusOK, "deny")
	for i := 0; i < 12; i++ {
		r := e.do("POST", "", "/v1/auth/token", "", `{"token":"mxt_wrong"}`, bad...)
		expect(t, r, http.StatusForbidden, "sign-in from a denied address")
	}
	expect(t, e.do("GET", good, "/v1/panes", "", "", bad...), http.StatusForbidden, "good token from a denied address")
	expect(t, e.do("POST", "", "/v1/pair", "", "{}", bad...), http.StatusForbidden, "pairing from a denied address")
	expect(t, e.do("GET", "", "/", "", "", bad...), http.StatusForbidden, "the page from a denied address")
	refused := 0
	for _, rec := range e.adminLog(admin, "?limit=500", ok...).Records {
		if rec.Msg == "address refused" && rec.Attrs["addr"] == "203.0.113.9" {
			refused++
			if rec.Level != "WARN" {
				t.Fatalf("refusal logged at %s", rec.Level)
			}
		}
	}
	if refused != 1 {
		t.Fatalf("%d refusal lines in a minute, want 1", refused)
	}
	// The refusals counted as no failed sign-in: once allowed, the address is not locked out.
	expect(t, e.do("PUT", admin, "/v1/admin/access", "", `{"allow":[],"deny":[]}`, ok...), http.StatusOK, "clear")
	expect(t, e.do("POST", "", "/v1/auth/token", "", fmt.Sprintf(`{"token":%q}`, good), bad...), http.StatusNoContent, "sign-in once allowed")
}

// 105
func TestSec105_AllowListShutsOutAnAgentUntilClearedOnTheSocket(t *testing.T) {
	e, ts, a := basic(t, "--trust-proxy")
	admin := e.adminToken()
	me := []string{"X-Forwarded-For", "192.0.2.10"}
	expect(t, e.do("PUT", admin, "/v1/admin/access", "", `{"allow":["192.0.2.0/24"],"deny":[]}`, me...), http.StatusOK, "allow list")
	if out := e.mustCLI("hub", "access", "list", "--dir", e.hubDir); out != "allow\t192.0.2.0/24" {
		t.Fatalf("access list: %q", out)
	}
	stop(a.cmd)
	e.waitOnline(host, false)
	e.runAgent(a, ts)
	waitFor(t, "the agent refused", func() bool {
		for _, rec := range e.adminLog(admin, "?limit=500", me...).Records {
			if rec.Msg == "address refused" && rec.Attrs["path"] == "/v1/agent" {
				return true
			}
		}
		return false
	})
	if out, _ := e.cli("hub", "agents", "--dir", e.hubDir); !strings.Contains(out, host+"\toffline") {
		t.Fatalf("agent online through the allow list: %s", out)
	}
	if out := e.mustCLI("hub", "access", "clear", "--dir", e.hubDir); out != "" {
		t.Fatalf("after clear: %q", out)
	}
	e.waitOnline(host, true)
	if _, err := e.cli("hub", "access", "deny", "--dir", e.hubDir, "not-an-address"); err == nil {
		t.Fatal("the socket took a bad address")
	}
}

// 106
func TestSec106_AccessListInputIsChecked(t *testing.T) {
	e := newEnv(t)
	admin := e.adminToken()
	many := make([]string, 257)
	for i := range many {
		many[i] = fmt.Sprintf("198.51.%d.%d", i/256, i%256)
	}
	raw, _ := json.Marshal(map[string][]string{"allow": {}, "deny": many})
	expect(t, e.do("PUT", admin, "/v1/admin/access", "", string(raw)), http.StatusBadRequest, "257 entries")
	expect(t, e.do("PUT", admin, "/v1/admin/access", "", `{"allow":[],"deny":["198.51.100.0/33"]}`), http.StatusBadRequest, "bad CIDR")
	expect(t, e.do("PUT", admin, "/v1/admin/access", "", `{"allow":[],"deny":["fe80::1%eth0"]}`), http.StatusBadRequest, "zone")
	expect(t, e.do("PUT", admin, "/v1/admin/access", "", `{"allow":[],"deny":"x"}`), http.StatusBadRequest, "not a list")
	expect(t, e.do("PUT", admin, "/v1/admin/access", "", strings.Repeat(" ", 70<<10)+"{}"), http.StatusRequestEntityTooLarge, "oversized")
	r := e.do("PUT", admin, "/v1/admin/access", "", `{"allow":["0.0.0.0/0","::/0"],"deny":["203.0.113.9","198.51.100.77/24"]}`)
	expect(t, r, http.StatusOK, "everything allowed")
	if !strings.Contains(r.body, `"203.0.113.9/32"`) || !strings.Contains(r.body, `"198.51.100.0/24"`) {
		t.Fatalf("lists are not normalised: %s", r.body)
	}
	expect(t, e.post(admin, "/v1/admin/unlock", `{"addr":"not an address"}`), http.StatusBadRequest, "unlock a non-address")
	expect(t, e.post(admin, "/v1/admin/unlock", `{"addr":"192.0.2.1"}`), http.StatusNotFound, "unlock what is not locked")
}

// 107
func TestAdmin107_RevokeEndsItsSessionsAtOnce(t *testing.T) {
	e := newEnv(t)
	admin := e.adminToken()
	phone := e.token("phone", []string{host + "/*"}, nil)
	cookie := e.signInWithToken(phone)
	expect(t, e.withSession(cookie, "GET", "/v1/me", "", true), http.StatusOK, "session")
	expect(t, e.get(phone, "/v1/me"), http.StatusOK, "bearer")
	o := e.overview(admin)
	id := o.tokenID("phone")
	kinds := map[string]bool{}
	for _, c := range o.Clients {
		if c.Principal == id {
			kinds[c.Kind] = true
		}
	}
	if !kinds["session"] || !kinds["bearer"] {
		t.Fatalf("clients of the token: %+v", o.Clients)
	}
	expect(t, e.do("DELETE", admin, "/v1/admin/tokens/"+id, "", ""), http.StatusNoContent, "revoke")
	expect(t, e.do("DELETE", admin, "/v1/admin/tokens/"+id, "", ""), http.StatusNotFound, "revoke twice")
	r := e.withSession(cookie, "GET", "/v1/me", "", true)
	expect(t, r, http.StatusUnauthorized, "session after revoke")
	if !strings.Contains(r.header.Get("Set-Cookie"), "Max-Age=0") {
		t.Fatal("the stale cookie is not cleared")
	}
	expect(t, e.get(phone, "/v1/me"), http.StatusUnauthorized, "bearer after revoke")
	for _, c := range e.overview(admin).Clients {
		if c.Principal == id {
			t.Fatalf("revoked token still listed: %+v", c)
		}
	}
}

// 108
func TestAdmin108_EndOneSession(t *testing.T) {
	e := newEnv(t)
	admin := e.adminToken()
	phone := e.token("phone", []string{host + "/*"}, nil)
	first := e.signInWithToken(phone)
	var handle string
	for _, c := range e.overview(admin).Clients {
		if c.Kind == "session" {
			handle = c.ID
		}
	}
	if len(handle) != 8 || strings.Contains(first, handle) {
		t.Fatalf("session handle %q", handle)
	}
	second := e.signInWithToken(phone)
	expect(t, e.do("DELETE", admin, "/v1/admin/sessions/"+handle, "", ""), http.StatusNoContent, "end")
	expect(t, e.withSession(first, "GET", "/v1/me", "", true), http.StatusUnauthorized, "ended session")
	expect(t, e.withSession(second, "GET", "/v1/me", "", true), http.StatusOK, "the other session")
	expect(t, e.do("DELETE", admin, "/v1/admin/sessions/"+handle, "", ""), http.StatusNotFound, "end twice")
	expect(t, e.get(phone, "/v1/me"), http.StatusOK, "the token itself")
}

// 109
func TestAdmin109_LogLongPoll(t *testing.T) {
	e := newEnv(t)
	admin := e.adminToken()
	phone := e.token("phone", []string{host + "/*"}, nil)
	start := e.adminLog(admin, "")
	if len(start.Records) == 0 || start.Records[0].Msg != "hub listening" {
		t.Fatalf("first records: %+v", start.Records)
	}
	go func() {
		time.Sleep(300 * time.Millisecond)
		e.client.Post(e.url()+"/v1/auth/token", "application/json", strings.NewReader(fmt.Sprintf(`{"token":%q}`, phone)))
	}()
	began := time.Now()
	page := e.adminLog(admin, fmt.Sprintf("?after=%d&wait=10", start.Next))
	if took := time.Since(began); took > 2*time.Second {
		t.Fatalf("the long poll took %s", took)
	}
	found := false
	for _, rec := range page.Records {
		if rec.Seq <= start.Next {
			t.Fatalf("record %d at or before the cursor %d", rec.Seq, start.Next)
		}
		found = found || rec.Msg == "signed in"
	}
	if !found {
		t.Fatalf("no sign-in in %+v", page.Records)
	}
	if again := e.adminLog(admin, fmt.Sprintf("?after=%d", page.Next)); len(again.Records) != 0 {
		t.Fatalf("after skips nothing: %+v", again.Records)
	}
	expect(t, e.get(admin, "/v1/admin/log?limit=501"), http.StatusBadRequest, "limit too high")
	expect(t, e.get(admin, "/v1/admin/log?after=x"), http.StatusBadRequest, "bad cursor")
}
