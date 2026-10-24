//go:build e2e

// End-to-end tests run the real binary against throwaway tmux servers on
// private sockets and a hub on loopback with a test certificate authority.
// Each test writes its components' logs under $MUXWAY_RUN_DIR/logs/<test>/.
package e2e

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/notmarkopadjen/muxway/internal/secure"
)

var (
	bin    string
	runDir string
)

func TestMain(m *testing.M) {
	runDir = os.Getenv("MUXWAY_RUN_DIR")
	tmp, err := os.MkdirTemp("", "muxway-e2e-")
	if err != nil {
		panic(err)
	}
	if runDir == "" {
		runDir = filepath.Join(tmp, "run")
	}
	bin = filepath.Join(tmp, "muxway")
	build := exec.Command("go", "build", "-o", bin, "../cmd/muxway")
	build.Stderr = os.Stderr
	if err := build.Run(); err != nil {
		panic("build failed: " + err.Error())
	}
	code := m.Run()
	os.RemoveAll(tmp)
	os.Exit(code)
}

// secrets collects every secret a test creates, to search the logs for.
var secrets struct {
	sync.Mutex
	list []string
}

func remember(s ...string) {
	secrets.Lock()
	secrets.list = append(secrets.list, s...)
	secrets.Unlock()
}

type env struct {
	t       *testing.T
	dir     string
	logs    string
	caPEM   []byte
	cert    string
	key     string
	addr    string
	hubDir  string
	hub     *exec.Cmd
	hubArgs []string
	client  *http.Client
	procs   []*exec.Cmd
	stt     *stt // the transcriber stand-in, in environments that have one
}

func newEnv(t *testing.T, hubArgs ...string) *env {
	t.Helper()
	dir, err := os.MkdirTemp("", "mxw-")
	if err != nil {
		t.Fatal(err)
	}
	os.Chmod(dir, 0o700)
	e := &env{t: t, dir: dir, logs: filepath.Join(runDir, "logs", t.Name()), hubDir: filepath.Join(dir, "hub")}
	os.MkdirAll(e.logs, 0o755)
	e.makeCA()
	e.addr = freeAddr(t)
	e.hubArgs = hubArgs
	e.startHub()
	t.Cleanup(e.close)
	return e
}

func freeAddr(t *testing.T) string {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	return ln.Addr().String()
}

func (e *env) url() string { return "https://" + e.addr }

func (e *env) makeCA() {
	caKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	ca := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "muxway test CA"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(24 * time.Hour),
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	caDER, _ := x509.CreateCertificate(rand.Reader, ca, ca, &caKey.PublicKey, caKey)
	caCert, _ := x509.ParseCertificate(caDER)
	leafKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	leaf := &x509.Certificate{SerialNumber: big.NewInt(2), Subject: pkix.Name{CommonName: "127.0.0.1"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(24 * time.Hour),
		IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	leafDER, _ := x509.CreateCertificate(rand.Reader, leaf, caCert, &leafKey.PublicKey, caKey)
	leafKeyDER, _ := x509.MarshalECPrivateKey(leafKey)
	e.caPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})
	write := func(name string, data []byte) string {
		p := filepath.Join(e.dir, name)
		os.WriteFile(p, data, 0o600)
		return p
	}
	write("ca.pem", e.caPEM)
	e.cert = write("cert.pem", pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leafDER}))
	e.key = write("key.pem", pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: leafKeyDER}))
	pool := x509.NewCertPool()
	pool.AppendCertsFromPEM(e.caPEM)
	e.client = &http.Client{Timeout: 20 * time.Second,
		Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool}, Proxy: nil}}
}

func (e *env) logFile(name string) *os.File {
	f, err := os.OpenFile(filepath.Join(e.logs, name+".log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		e.t.Fatal(err)
	}
	return f
}

func (e *env) start(logName string, args ...string) *exec.Cmd {
	cmd := exec.Command(bin, args...)
	cmd.Stdout = e.logFile(logName)
	cmd.Stderr = cmd.Stdout
	cmd.Env = append(os.Environ(), "MUXWAY_DIR=")
	if err := cmd.Start(); err != nil {
		e.t.Fatal(err)
	}
	e.procs = append(e.procs, cmd)
	return cmd
}

func (e *env) startHub() {
	args := append([]string{"hub", "serve", "--dir", e.hubDir, "--listen", e.addr, "--public-url", e.url(),
		"--tls-cert", e.cert, "--tls-key", e.key}, e.hubArgs...)
	e.hub = e.start("hub", args...)
	waitFor(e.t, "hub up", func() bool {
		c, err := net.Dial("tcp", e.addr)
		if err == nil {
			c.Close()
		}
		_, serr := os.Stat(filepath.Join(e.hubDir, "admin.sock"))
		return err == nil && serr == nil
	})
	rememberFile(filepath.Join(e.hubDir, "hub.key"))
}

func rememberFile(path string) {
	if raw, err := os.ReadFile(path); err == nil {
		remember(strings.TrimSpace(string(raw)))
	}
}

func (e *env) stopHub() {
	stop(e.hub)
	waitFor(e.t, "hub down", func() bool {
		c, err := net.Dial("tcp", e.addr)
		if err == nil {
			c.Close()
		}
		return err != nil
	})
}

func stop(cmd *exec.Cmd) {
	if cmd != nil && cmd.Process != nil {
		cmd.Process.Signal(os.Interrupt)
		done := make(chan struct{})
		go func() { cmd.Wait(); close(done) }()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			cmd.Process.Kill()
		}
	}
}

func (e *env) close() {
	for _, p := range e.procs {
		stop(p)
	}
	os.RemoveAll(e.dir)
}

// cli runs a short muxway command and returns its stdout.
func (e *env) cli(args ...string) (string, error) {
	cmd := exec.Command(bin, args...)
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	err := cmd.Run()
	if err != nil {
		return out.String(), fmt.Errorf("%v: %s", err, errb.String())
	}
	return strings.TrimSpace(out.String()), nil
}

func (e *env) mustCLI(args ...string) string {
	e.t.Helper()
	out, err := e.cli(args...)
	if err != nil {
		e.t.Fatalf("muxway %s: %v", strings.Join(args, " "), err)
	}
	return out
}

// --- tmux -----------------------------------------------------------------------

type tmuxServer struct {
	name string
	t    *testing.T
}

// newTmux starts a private tmux server with no user configuration and a
// first session "work" whose window "shell" runs a clean bash.
func newTmux(t *testing.T) *tmuxServer {
	ts := &tmuxServer{name: fmt.Sprintf("mxw-e2e-%d-%d", os.Getpid(), time.Now().UnixNano()), t: t}
	ts.must("-f", "/dev/null", "new-session", "-d", "-s", "work", "-n", "shell", "-x", "100", "-y", "30", shell())
	ts.must("set-option", "-g", "default-command", shell())
	ts.title("work:0.0")
	t.Cleanup(func() { exec.Command("tmux", "-L", ts.name, "kill-server").Run() })
	return ts
}

func shell() string {
	return "env -i PATH=/usr/bin:/bin TERM=xterm LANG=C.UTF-8 LC_ALL=C.UTF-8 PS1='$ ' bash --norc --noprofile"
}

func (ts *tmuxServer) run(args ...string) (string, error) {
	out, err := exec.Command("tmux", append([]string{"-L", ts.name}, args...)...).CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

func (ts *tmuxServer) must(args ...string) string {
	ts.t.Helper()
	out, err := ts.run(args...)
	if err != nil {
		ts.t.Fatalf("tmux %v: %v %s", args, err, out)
	}
	return out
}

// title gives a pane a synthetic title, so no real host name shows up.
func (ts *tmuxServer) title(target string) { ts.must("select-pane", "-t", target, "-T", "test-pane") }

// split makes a new pane next to target and titles it, so the machine's
// own hostname never shows up as a pane title.
func (ts *tmuxServer) split(target string) {
	id := ts.must("split-window", "-t", target, "-P", "-F", "#{pane_id}", shell())
	ts.title(id)
}

func (ts *tmuxServer) capture(target string) string {
	return ts.must("capture-pane", "-p", "-t", target)
}

// --- agents and tokens -------------------------------------------------------------

type agentProc struct {
	host string
	dir  string
	cmd  *exec.Cmd
}

func (e *env) pairAgent(host string, ts *tmuxServer) *agentProc {
	e.t.Helper()
	code := e.mustCLI("hub", "pair-code", "--dir", e.hubDir, "--host", host)
	remember(code)
	if pc, err := secure.ParsePairCode(code); err == nil {
		remember(pc.Secret)
	}
	dir := filepath.Join(e.dir, "agent-"+host)
	e.mustCLI("agent", "pair", "--dir", dir, "--ca", filepath.Join(e.dir, "ca.pem"), code)
	rememberFile(filepath.Join(dir, "agent.key"))
	a := &agentProc{host: host, dir: dir}
	e.runAgent(a, ts)
	e.waitOnline(host, true)
	return a
}

func (e *env) runAgent(a *agentProc, ts *tmuxServer) {
	a.cmd = e.start("agent-"+a.host, "agent", "run", "--dir", a.dir, "--tmux-name", ts.name)
}

func (e *env) waitOnline(host string, online bool) {
	e.t.Helper()
	want := host + "\toffline"
	if online {
		want = host + "\tonline"
	}
	waitFor(e.t, "agent "+want, func() bool {
		out, _ := e.cli("hub", "agents", "--dir", e.hubDir)
		return strings.Contains(out, want)
	})
}

func (e *env) token(name string, read, write []string) string {
	e.t.Helper()
	args := []string{"hub", "token", "create", "--dir", e.hubDir, "--name", name}
	for _, r := range read {
		args = append(args, "--read", r)
	}
	for _, w := range write {
		args = append(args, "--write", w)
	}
	tok := e.mustCLI(args...)
	remember(tok)
	return tok
}

func (e *env) expose(ts *tmuxServer, target string, flags ...string) {
	e.t.Helper()
	e.mustCLI(append([]string{"expose", "--tmux-name", ts.name, "-t", target}, flags...)...)
}

// --- HTTP -------------------------------------------------------------------------

type resp struct {
	status int
	body   string
	header http.Header
}

func (e *env) do(method, token, path, accept, body string, headers ...string) resp {
	e.t.Helper()
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, e.url()+path, rd)
	if err != nil {
		e.t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	r, err := e.client.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer r.Body.Close()
	raw, _ := io.ReadAll(r.Body)
	return resp{r.StatusCode, string(raw), r.Header}
}

func (e *env) get(token, path string) resp        { return e.do("GET", token, path, "", "") }
func (e *env) getText(token, path string) resp    { return e.do("GET", token, path, "text/plain", "") }
func (e *env) post(token, path, body string) resp { return e.do("POST", token, path, "", body) }

func (e *env) input(token, pane string, v any) resp {
	raw, _ := json.Marshal(v)
	return e.post(token, "/v1/panes/"+pane+"/input", string(raw))
}

func expect(t *testing.T, r resp, status int, what string) {
	t.Helper()
	if r.status != status {
		t.Fatalf("%s: got %d %s, want %d", what, r.status, strings.TrimSpace(r.body), status)
	}
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}
