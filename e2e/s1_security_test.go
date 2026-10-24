//go:build e2e

package e2e

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/notmarkopadjen/muxway/internal/secure"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

// Security tests come first. Each starts its own hub, agent and tmux.

const (
	host   = "alice-laptop"
	shell0 = host + "/work/0.0"
)

// basic is a hub with one agent and the first pane exposed for writing.
func basic(t *testing.T, hubArgs ...string) (*env, *tmuxServer, *agentProc) {
	e := newEnv(t, hubArgs...)
	ts := newTmux(t)
	a := e.pairAgent(host, ts)
	e.expose(ts, "work:0.0", "--write")
	return e, ts, a
}

func endpoints() [][2]string {
	return [][2]string{
		{"GET", "/v1/hosts"}, {"GET", "/v1/panes"}, {"GET", "/v1/hosts/" + host + "/tree"},
		{"GET", "/v1/panes/" + shell0}, {"POST", "/v1/panes/" + shell0 + "/input"}, {"GET", "/v1/events"},
		{"GET", "/v1/me"},
	}
}

// 1
func TestSec01_EveryEndpointNeedsAValidToken(t *testing.T) {
	e, _, _ := basic(t, "--trust-proxy")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	expired := e.mustCLI("hub", "token", "create", "--dir", e.hubDir, "--name", "old", "--read", host+"/*", "--ttl", "1s")
	revoked := e.token("revoked", []string{host + "/*"}, nil)
	remember(expired)
	list := e.mustCLI("hub", "token", "list", "--dir", e.hubDir)
	for _, line := range strings.Split(list, "\n") {
		if strings.Contains(line, "revoked") {
			e.mustCLI("hub", "token", "revoke", "--dir", e.hubDir, strings.Fields(line)[0])
		}
	}
	time.Sleep(1100 * time.Millisecond)
	cases := map[string]string{"none": "", "wrong": "mxt_" + secure.Random(32), "expired": expired, "revoked": revoked,
		"malformed": "x"}
	n := 0
	for name, tok := range cases {
		for _, ep := range endpoints() {
			n++
			// A fresh client address per request keeps the lockout out of this test.
			r := e.do(ep[0], tok, ep[1], "", `{"key":"Enter"}`, "X-Forwarded-For", fmt.Sprintf("198.51.100.%d", n))
			expect(t, r, http.StatusUnauthorized, name+" "+ep[0]+" "+ep[1])
			if strings.TrimSpace(r.body) != `{"error":"unauthorized"}` {
				t.Fatalf("%s %s: body says more than unauthorized: %s", name, ep[1], r.body)
			}
		}
	}
	expect(t, e.get(full, "/v1/panes"), http.StatusOK, "valid token")

	// The alternative header: valid alone, refused when it disagrees with
	// Authorization or carries a wrong token, and never unlocked by a
	// Basic header a WAP gateway made out of a Bearer one.
	alt := func(headers ...string) int {
		n++
		return e.do("GET", "", "/v1/panes", "", "", append(headers, "X-Forwarded-For", fmt.Sprintf("198.51.100.%d", n))...).status
	}
	if s := alt("X-Muxway-Token", full); s != http.StatusOK {
		t.Fatalf("X-Muxway-Token alone: %d", s)
	}
	if s := alt("X-Muxway-Token", full, "Authorization", "Bearer "+full); s != http.StatusOK {
		t.Fatalf("both headers, same token: %d", s)
	}
	for name, headers := range map[string][]string{
		"wrong alt":        {"X-Muxway-Token", "mxt_" + secure.Random(32)},
		"alt disagrees":    {"X-Muxway-Token", full, "Authorization", "Bearer " + revoked},
		"bearer disagrees": {"X-Muxway-Token", revoked, "Authorization", "Bearer " + full},
		"wap basic":        {"Authorization", "Basic " + base64.StdEncoding.EncodeToString([]byte("Bearer "+full+":ap"))},
		"empty bearer":     {"Authorization", "Bearer ", "X-Muxway-Token", ""},
	} {
		if s := alt(headers...); s != http.StatusUnauthorized {
			t.Fatalf("%s: %d", name, s)
		}
	}
}

// 2
func TestSec02_TokenForOneHostCannotSeeAnother(t *testing.T) {
	e, _, _ := basic(t)
	ts2 := newTmux(t)
	e.pairAgent("bob-desktop", ts2)
	e.expose(ts2, "work", "--write")
	tok := e.token("alice-only", []string{host + "/*"}, []string{host + "/*"})
	for _, path := range []string{"/v1/hosts", "/v1/panes"} {
		r := e.get(tok, path)
		expect(t, r, http.StatusOK, path)
		if strings.Contains(r.body, "bob-desktop") {
			t.Fatalf("%s shows the other host: %s", path, r.body)
		}
	}
	expect(t, e.get(tok, "/v1/panes/bob-desktop/work/0.0"), http.StatusNotFound, "read other host")
	expect(t, e.get(tok, "/v1/hosts/bob-desktop/tree"), http.StatusNotFound, "tree of other host")
	expect(t, e.input(tok, "bob-desktop/work/0.0", map[string]string{"key": "Enter"}), http.StatusNotFound, "write other host")
	missing := e.get(tok, "/v1/panes/nobody/work/0.0")
	forbidden := e.get(tok, "/v1/panes/bob-desktop/work/0.0")
	if missing.status != forbidden.status || missing.body != forbidden.body {
		t.Fatalf("a forbidden host answers differently from a missing one: %v / %v", missing, forbidden)
	}
}

// 3
func TestSec03_ReadOnlyTokenCannotType(t *testing.T) {
	e, ts, _ := basic(t)
	tok := e.token("reader", []string{host + "/*"}, nil)
	before := ts.capture("work:0.0")
	expect(t, e.input(tok, shell0, map[string]string{"text": "echo nope"}), http.StatusForbidden, "text")
	expect(t, e.input(tok, shell0, map[string]string{"key": "C-c"}), http.StatusForbidden, "key")
	time.Sleep(300 * time.Millisecond)
	if after := ts.capture("work:0.0"); after != before {
		t.Fatalf("pane changed:\n%s", after)
	}
	expect(t, e.get(tok, "/v1/panes/"+shell0), http.StatusOK, "read still works")
}

// 4
func TestSec04_UnexposedPaneIsInvisibleEvenToFullToken(t *testing.T) {
	e := newEnv(t)
	ts := newTmux(t)
	e.pairAgent(host, ts)
	tok := e.token("full", []string{"*"}, []string{"*"})
	r := e.get(tok, "/v1/panes")
	expect(t, r, http.StatusOK, "list")
	if strings.Contains(r.body, "work") {
		t.Fatalf("unexposed pane listed: %s", r.body)
	}
	expect(t, e.get(tok, "/v1/panes/"+shell0), http.StatusNotFound, "read")
	expect(t, e.input(tok, shell0, map[string]string{"key": "Enter"}), http.StatusNotFound, "write")
}

// 5
func TestSec05_ReadOnlyPaneRefusesWriteEvenWithWriteGrant(t *testing.T) {
	e := newEnv(t)
	ts := newTmux(t)
	e.pairAgent(host, ts)
	e.expose(ts, "work:0.0")
	tok := e.token("full", []string{"*"}, []string{"*"})
	before := ts.capture("work:0.0")
	expect(t, e.input(tok, shell0, map[string]string{"text": "echo nope"}), http.StatusForbidden, "write")
	r := e.get(tok, "/v1/panes")
	if !strings.Contains(r.body, `"mode":"read"`) || strings.Contains(r.body, `"mode":"write"`) {
		t.Fatalf("pane not shown as read-only: %s", r.body)
	}
	time.Sleep(300 * time.Millisecond)
	if ts.capture("work:0.0") != before {
		t.Fatal("pane changed")
	}
}

// fakeHub stands in for a compromised hub, or an impostor, on the hub's
// address. It handshakes with the given key and then hands the session to
// script.
func fakeHub(t *testing.T, e *env, hubKey ed25519.PrivateKey, agentKey ed25519.PublicKey,
	script func(ctx context.Context, s *secure.Session)) chan struct{} {
	done := make(chan struct{})
	mux := http.NewServeMux()
	var once bool
	mux.HandleFunc("/v1/agent", func(w http.ResponseWriter, r *http.Request) {
		if once {
			http.Error(w, "busy", 503)
			return
		}
		once = true
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.CloseNow()
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		_, s, err := secure.HubHandshake(ctx, wire.WS{C: c}, hubKey, func(string) (ed25519.PublicKey, bool) { return agentKey, true })
		if err == nil {
			script(ctx, s)
		}
		close(done)
	})
	srv := &http.Server{Addr: e.addr, Handler: mux}
	go srv.ListenAndServeTLS(e.cert, e.key)
	t.Cleanup(func() { srv.Close() })
	return done
}

func agentPublicKey(t *testing.T, e *env, host string) ed25519.PublicKey {
	var st struct {
		Agents map[string]struct{ Key string } `json:"agents"`
	}
	raw, _ := os.ReadFile(filepath.Join(e.hubDir, "hub.json"))
	json.Unmarshal(raw, &st)
	pub, err := secure.DecodePublic(st.Agents[host].Key)
	if err != nil {
		t.Fatal(err)
	}
	return pub
}

// 6
func TestSec06_AgentRefusesWhatACompromisedHubAsks(t *testing.T) {
	e := newEnv(t)
	ts := newTmux(t)
	ts.split("work:0.0")
	e.pairAgent(host, ts)
	e.expose(ts, "work:0.0") // read-only
	hubKey, err := secure.LoadOrCreateKey(filepath.Join(e.hubDir, "hub.key"))
	if err != nil {
		t.Fatal(err)
	}
	agentKey := agentPublicKey(t, e, host)
	e.stopHub()
	before := ts.capture("work:0.1")
	text := "echo pwned"
	type exchange struct {
		req  wire.Request
		want string
	}
	var results []string
	done := fakeHub(t, e, hubKey, agentKey, func(ctx context.Context, s *secure.Session) {
		ask := func(req wire.Request) wire.Response {
			raw, _ := json.Marshal(req)
			s.Write(ctx, raw)
			reply, err := s.Read(ctx)
			if err != nil {
				t.Errorf("no answer: %v", err)
				return wire.Response{}
			}
			var r wire.Response
			json.Unmarshal(reply, &r)
			return r
		}
		list := ask(wire.Request{ID: 1, Op: wire.OpList})
		unexposed := ""
		for _, p := range list.Panes {
			if p.PaneIndex == 1 {
				t.Errorf("agent listed the unexposed pane")
			}
		}
		out, _ := exec.Command("tmux", "-L", ts.name, "display-message", "-p", "-t", "work:0.1", "#{pane_id}").Output()
		unexposed = strings.TrimSpace(string(out))
		out, _ = exec.Command("tmux", "-L", ts.name, "display-message", "-p", "-t", "work:0.0", "#{pane_id}").Output()
		readOnly := strings.TrimSpace(string(out))
		for i, ex := range []exchange{
			{wire.Request{Op: wire.OpRead, Pane: unexposed}, wire.ErrNotExposed},
			{wire.Request{Op: wire.OpInput, Pane: unexposed, Text: &text}, wire.ErrNotExposed},
			{wire.Request{Op: wire.OpInput, Pane: readOnly, Text: &text}, wire.ErrReadOnly},
			{wire.Request{Op: wire.OpInput, Pane: readOnly, Key: "Escape"}, wire.ErrReadOnly},
			{wire.Request{Op: "exec", Pane: readOnly}, wire.ErrUnknownOp},
			{wire.Request{Op: wire.OpRead, Pane: "%999"}, wire.ErrNotExposed},
		} {
			ex.req.ID = uint64(i + 2)
			r := ask(ex.req)
			results = append(results, fmt.Sprintf("%s %s -> %s", ex.req.Op, ex.req.Pane, r.Error))
			if r.Error != ex.want {
				t.Errorf("%s on %s: got %q, want %q", ex.req.Op, ex.req.Pane, r.Error, ex.want)
			}
		}
	})
	select {
	case <-done:
	case <-time.After(20 * time.Second):
		t.Fatal("agent never connected to the fake hub")
	}
	t.Log(strings.Join(results, "\n"))
	if ts.capture("work:0.1") != before {
		t.Fatal("unexposed pane changed")
	}
	logs, _ := os.ReadFile(filepath.Join(e.logs, "agent-"+host+".log"))
	if !strings.Contains(string(logs), "result=unknown_op") || !strings.Contains(string(logs), "result=read_only") {
		t.Fatal("refusals are not in the agent's audit log")
	}
}

func dialAgent(t *testing.T, e *env) *websocket.Conn {
	pool := x509.NewCertPool()
	pool.AppendCertsFromPEM(e.caPEM)
	client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool}}}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "wss://"+e.addr+"/v1/agent", &websocket.DialOptions{HTTPClient: client})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.CloseNow() })
	return c
}

// recorder keeps what an agent wrote during a handshake.
type recorder struct {
	wire.WS
	sent [][]byte
}

func (r *recorder) Write(ctx context.Context, msg []byte) error {
	r.sent = append(r.sent, append([]byte{}, msg...))
	return r.WS.Write(ctx, msg)
}

// pairKey pairs a key the test holds, through the HTTP API.
func pairKey(t *testing.T, e *env, alias string) (ed25519.PrivateKey, ed25519.PublicKey) {
	pc, err := secure.ParsePairCode(e.mustCLI("hub", "pair-code", "--dir", e.hubDir, "--host", alias))
	if err != nil {
		t.Fatal(err)
	}
	remember(pc.Secret)
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	body, _ := json.Marshal(map[string]string{"code_id": pc.ID, "host": alias, "agent_key": secure.EncodePublic(pub),
		"proof": secure.PairProof(pc.Secret, alias, pub)})
	expect(t, e.post("", "/v1/pair", string(body)), http.StatusOK, "pair")
	hubPub, _ := secure.DecodePublic(pc.HubKey)
	return priv, hubPub
}

// 9
func TestSec09_HubRefusesWrongKeyUnpairedAndReplayedAgents(t *testing.T) {
	e := newEnv(t)
	priv, hubPub := pairKey(t, e, "carol-pc")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	_, wrong, _ := ed25519.GenerateKey(rand.Reader)
	if _, err := secure.AgentHandshake(ctx, wire.WS{C: dialAgent(t, e)}, wrong, "carol-pc", hubPub); err == nil {
		t.Fatal("hub accepted an agent with the wrong key")
	}
	if _, err := secure.AgentHandshake(ctx, wire.WS{C: dialAgent(t, e)}, priv, "mallory", hubPub); err == nil {
		t.Fatal("hub accepted an unpaired alias")
	}
	rec := &recorder{WS: wire.WS{C: dialAgent(t, e)}}
	if _, err := secure.AgentHandshake(ctx, rec, priv, "carol-pc", hubPub); err != nil {
		t.Fatalf("the genuine agent was refused: %v", err)
	}
	replay := wire.WS{C: dialAgent(t, e)}
	if _, err := replay.Read(ctx); err != nil { // the hub's hello, with a fresh nonce
		t.Fatal(err)
	}
	replay.Write(ctx, rec.sent[0])
	if _, err := replay.Read(ctx); err == nil {
		t.Fatal("hub answered a replayed handshake")
	}
	logs, _ := os.ReadFile(filepath.Join(e.logs, "hub.log"))
	if n := strings.Count(string(logs), "agent handshake failed"); n != 3 {
		t.Fatalf("hub logged %d failed handshakes, want 3", n)
	}
}

// 10
func TestSec10_AgentRefusesAHubWithAnotherKey(t *testing.T) {
	e := newEnv(t)
	ts := newTmux(t)
	e.pairAgent(host, ts)
	e.expose(ts, "work", "--write")
	agentKey := agentPublicKey(t, e, host)
	e.stopHub()
	_, impostor, _ := ed25519.GenerateKey(rand.Reader)
	before := ts.capture("work:0.0")
	answered := false
	done := fakeHub(t, e, impostor, agentKey, func(ctx context.Context, s *secure.Session) {
		text := "echo pwned"
		raw, _ := json.Marshal(wire.Request{ID: 1, Op: wire.OpList})
		s.Write(ctx, raw)
		raw, _ = json.Marshal(wire.Request{ID: 2, Op: wire.OpInput, Pane: "%0", Text: &text})
		s.Write(ctx, raw)
		if _, err := s.Read(ctx); err == nil {
			answered = true
		}
	})
	select {
	case <-done:
	case <-time.After(20 * time.Second):
		t.Fatal("agent never tried the impostor")
	}
	if answered {
		t.Fatal("agent answered a hub it did not pin")
	}
	time.Sleep(300 * time.Millisecond)
	if ts.capture("work:0.0") != before {
		t.Fatal("pane changed")
	}
	logs, _ := os.ReadFile(filepath.Join(e.logs, "agent-"+host+".log"))
	if !strings.Contains(string(logs), "did not prove the pinned key") {
		t.Fatal("agent did not log the refusal")
	}
}

func pairBody(pc secure.PairCode, proof string) string {
	pub, _, _ := ed25519.GenerateKey(rand.Reader)
	if proof == "" {
		proof = secure.PairProof(pc.Secret, pc.Host, pub)
	}
	raw, _ := json.Marshal(map[string]string{"code_id": pc.ID, "host": pc.Host, "agent_key": secure.EncodePublic(pub), "proof": proof})
	return string(raw)
}

// 11
func TestSec11_PairingCodesAreSingleUseShortLivedAndGuessProof(t *testing.T) {
	e := newEnv(t)
	code := func(ttl string) secure.PairCode {
		pc, err := secure.ParsePairCode(e.mustCLI("hub", "pair-code", "--dir", e.hubDir, "--host", "dave-pc", "--ttl", ttl))
		if err != nil {
			t.Fatal(err)
		}
		remember(pc.Secret)
		return pc
	}
	used := code("10m")
	expect(t, e.post("", "/v1/pair", pairBody(used, "")), http.StatusOK, "first use")
	expect(t, e.post("", "/v1/pair", pairBody(used, "")), http.StatusUnauthorized, "second use")

	old := code("1s")
	time.Sleep(1200 * time.Millisecond)
	expect(t, e.post("", "/v1/pair", pairBody(old, "")), http.StatusUnauthorized, "expired")

	guessed := code("10m")
	for i := 0; i < 3; i++ {
		expect(t, e.post("", "/v1/pair", pairBody(guessed, secure.Random(32))), http.StatusUnauthorized, "guess")
	}
	expect(t, e.post("", "/v1/pair", pairBody(guessed, "")), http.StatusUnauthorized, "right proof after 3 guesses")

	other := code("10m")
	other.Host = "eve-pc"
	expect(t, e.post("", "/v1/pair", pairBody(other, "")), http.StatusUnauthorized, "code for another alias")
}

// 12
func TestSec12_FailedLoginsLockOutOneAddressOnly(t *testing.T) {
	e, _, _ := basic(t, "--trust-proxy")
	tok := e.token("good", []string{host + "/*"}, nil)
	bad := "192.0.2.10"
	for i := 0; i < 10; i++ {
		expect(t, e.do("GET", "mxt_wrong", "/v1/panes", "", "", "X-Forwarded-For", bad), http.StatusUnauthorized, "bad login")
	}
	expect(t, e.do("GET", tok, "/v1/panes", "", "", "X-Forwarded-For", bad), http.StatusTooManyRequests, "locked address, good token")
	expect(t, e.do("POST", "", "/v1/pair", "", "{}", "X-Forwarded-For", bad), http.StatusTooManyRequests, "locked address, pairing")
	expect(t, e.do("GET", tok, "/v1/panes", "", "", "X-Forwarded-For", "192.0.2.11"), http.StatusOK, "other address")
}

// 13
func TestSec13_NewTmuxServerDoesNotInheritAccess(t *testing.T) {
	e, ts, _ := basic(t)
	tok := e.token("full", []string{"*"}, []string{"*"})
	expect(t, e.get(tok, "/v1/panes/"+shell0), http.StatusOK, "exposed")
	ts.must("kill-server")
	// The old server may still hold the socket for a moment.
	waitFor(t, "new tmux server", func() bool {
		_, err := ts.run("-f", "/dev/null", "new-session", "-d", "-s", "work", "-n", "shell", shell())
		return err == nil
	})
	ts.title("work:0.0")
	if id := ts.must("display-message", "-p", "-t", "work:0.0", "#{pane_id}"); id != "%0" {
		t.Logf("new pane id %s", id)
	}
	waitFor(t, "cache expiry", func() bool { return e.get(tok, "/v1/panes/"+shell0).status == http.StatusNotFound })
	expect(t, e.input(tok, shell0, map[string]string{"key": "Enter"}), http.StatusNotFound, "write")
}

// 14
func TestSec14_PlainHubOnlyOnLoopback(t *testing.T) {
	dir := t.TempDir()
	os.Chmod(dir, 0o700)
	for _, addr := range []string{"0.0.0.0:0", "192.0.2.1:7600", "[::]:0"} {
		cmd := exec.Command(bin, "hub", "serve", "--dir", filepath.Join(dir, "h"), "--listen", addr)
		out, err := cmd.CombinedOutput()
		if err == nil || !strings.Contains(string(out), "loopback") {
			t.Fatalf("%s: hub started plain or failed for another reason: %s", addr, out)
		}
	}
	cmd := exec.Command(bin, "hub", "serve", "--dir", filepath.Join(dir, "open"), "--listen", "127.0.0.1:0")
	os.MkdirAll(filepath.Join(dir, "open"), 0o755)
	out, err := cmd.CombinedOutput()
	if err == nil || !strings.Contains(string(out), "chmod 700") {
		t.Fatalf("hub accepted a state directory others can read: %s", out)
	}
}

// 14a
func TestSec14a_SplitInExposedWindowInheritsModeAndDenyCarvesOut(t *testing.T) {
	e := newEnv(t)
	ts := newTmux(t)
	e.pairAgent(host, ts)
	e.expose(ts, "work:0")
	ts.split("work:0.0")
	ts.split("work:0.0")
	e.expose(ts, "work:0.2", "--deny")
	tok := e.token("full", []string{"*"}, []string{"*"})
	expect(t, e.get(tok, "/v1/panes/"+host+"/work/0.1"), http.StatusOK, "new split readable")
	expect(t, e.input(tok, host+"/work/0.1", map[string]string{"key": "Enter"}), http.StatusForbidden, "new split not writable")
	expect(t, e.get(tok, "/v1/panes/"+host+"/work/0.2"), http.StatusNotFound, "denied pane")
	expect(t, e.input(tok, host+"/work/0.2", map[string]string{"key": "Enter"}), http.StatusNotFound, "denied pane write")
}

// 14b
func TestSec14b_MovedWindowsFollowMarksAndGrants(t *testing.T) {
	e := newEnv(t)
	ts := newTmux(t)
	e.pairAgent(host, ts)
	ts.must("new-session", "-d", "-s", "other", "-n", "misc", shell())
	ts.title("other:0.0")
	e.expose(ts, "work", "--write")
	ts.must("new-window", "-t", "other:1", "-n", "marked", shell())
	ts.title("other:1.0")
	e.expose(ts, "other:1", "--write")
	tok := e.token("work-only", []string{host + "/work/*"}, []string{host + "/work/*"})

	// An unexposed window moved into the exposed session gains the session's mark.
	ts.must("move-window", "-s", "other:0", "-t", "work:5")
	waitFor(t, "moved in", func() bool { return e.get(tok, "/v1/panes/"+host+"/work/5.0").status == http.StatusOK })
	// A window marked on its own, moved out of the granted session, is no longer granted.
	ts.must("move-window", "-s", "work:0", "-t", "other:7")
	waitFor(t, "moved out", func() bool { return e.get(tok, "/v1/panes/"+host+"/other/7.0").status == http.StatusNotFound })
	// The moved window's mark came from its old session, so it is not exposed at all now.
	full := e.token("full", []string{"*"}, nil)
	expect(t, e.get(full, "/v1/panes/"+host+"/other/7.0"), http.StatusNotFound, "window that lost its session's mark")
	expect(t, e.get(full, "/v1/panes/"+host+"/other/1.0"), http.StatusOK, "window with its own mark")
}

// 14c
func TestSec14c_HostileNamesNeverWidenAGrant(t *testing.T) {
	e := newEnv(t)
	ts := newTmux(t)
	e.pairAgent(host, ts)
	for _, name := range []string{"*", "secret", "a*b", "wörk"} {
		ts.must("new-session", "-d", "-s", name, shell())
		e.expose(ts, name, "--write")
	}
	tok := e.token("work", []string{host + "/work/*", host + "/a/*"}, nil)
	r := e.get(tok, "/v1/panes")
	for _, name := range []string{`"session":"*"`, `"session":"secret"`, `"session":"a*b"`, `"session":"wörk"`} {
		if strings.Contains(r.body, name) {
			t.Fatalf("token for work sees %s: %s", name, r.body)
		}
	}
	for _, path := range []string{"*/0.0", "secret/0.0", "a*b/0.0", "../secret/0.0", "work/..%2Fsecret.0",
		"%2A/0.0", "work/0.0/../../secret/0.0", "wörk/0.0", "work/0.-1", "work/0.0%00"} {
		r := e.get(tok, "/v1/panes/"+host+"/"+path)
		if r.status == http.StatusOK {
			t.Fatalf("%s readable: %s", path, r.body)
		}
	}
}

// 7
func TestSec07_ControlCharactersAndUnknownKeysAreRefused(t *testing.T) {
	e, ts, _ := basic(t)
	tok := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	before := ts.capture("work:0.0")
	for _, text := range []string{"\x1b[2J", "a\x1bb", "line\nbreak", "tab\there", "\x00", "del\x7f", "c1\u0085", "\u009b31m", ""} {
		expect(t, e.input(tok, shell0, map[string]string{"text": text}), http.StatusBadRequest, fmt.Sprintf("text %q", text))
	}
	for _, key := range []string{"C-b", "M-x", "F1", "enter", "Enter Enter", "\x1b", "C-c; rm", "S-Tab", "btab", "BTab Enter", ""} {
		r := e.input(tok, shell0, map[string]string{"key": key})
		if r.status != http.StatusBadRequest {
			t.Fatalf("key %q: %d", key, r.status)
		}
	}
	expect(t, e.input(tok, shell0, map[string]any{"text": "a", "key": "Enter"}), http.StatusBadRequest, "both")
	time.Sleep(300 * time.Millisecond)
	if ts.capture("work:0.0") != before {
		t.Fatal("pane changed")
	}
}

// 8
func TestSec08_MalformedOversizedAndTraversalRequests(t *testing.T) {
	e, ts, _ := basic(t)
	tok := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	before := ts.capture("work:0.0")
	big := `{"text":"` + strings.Repeat("a", 20000) + `"}`
	expect(t, e.post(tok, "/v1/panes/"+shell0+"/input", big), http.StatusRequestEntityTooLarge, "oversized")
	long := `{"text":"` + strings.Repeat("a", 5000) + `"}`
	expect(t, e.post(tok, "/v1/panes/"+shell0+"/input", long), http.StatusBadRequest, "text over 4 KiB")
	for _, body := range []string{"", "{", "[]", `{"text":1}`, `{"text":"a","extra":1}`, `{"text":"a"}{"text":"b"}`, "null"} {
		r := e.post(tok, "/v1/panes/"+shell0+"/input", body)
		if r.status != http.StatusBadRequest {
			t.Fatalf("body %q: %d %s", body, r.status, r.body)
		}
	}
	for _, q := range []string{"?lines=0", "?lines=99999", "?width=2", "?width=x", "?lines=-5", "?charset=utf-16", "?charset=", "?charset=ASCII", "?charset=latin1&charset=utf-8", "?lines=5&lines=5"} {
		expect(t, e.get(tok, "/v1/panes/"+shell0+q), http.StatusBadRequest, q)
	}
	for _, q := range []string{"?charset=utf-16", "?charset=latin1&charset=utf-8"} {
		expect(t, e.get(tok, "/v1/panes"+q), http.StatusBadRequest, "list"+q)
	}
	for _, path := range []string{"/v1/panes/" + host + "/work/0.0/../../x", "/v1/panes/..%2F..%2Fetc%2Fpasswd/x/0.0",
		"/v1/panes/" + strings.ToUpper(host) + "/work/0.0", "/v1/panes/" + host + "/work", "/v1/admin", "/v1/panes/" + host + "/@BAD"} {
		r := e.get(tok, path)
		if r.status != http.StatusNotFound && r.status != http.StatusBadRequest && r.status != http.StatusMovedPermanently {
			t.Fatalf("%s: %d %s", path, r.status, r.body)
		}
	}
	time.Sleep(300 * time.Millisecond)
	if ts.capture("work:0.0") != before {
		t.Fatal("pane changed")
	}
}
