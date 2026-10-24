//go:build e2e

package e2e

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/notmarkopadjen/muxway/internal/auth/authtest"
)

// The web client's tests are Playwright specs in web/e2e. This test builds
// the environment they need, runs them, and reports each as a subtest so
// the run directory stays one JUnit file. A control endpoint on loopback
// lets a spec drive tmux, notifications and the hub.

func TestUI_WebClient(t *testing.T) {
	npx, webDir := uiTools(t)
	idp := authtest.New()
	defer idp.Close()
	secretDir, _ := os.MkdirTemp("", "mxw-ui-")
	defer os.RemoveAll(secretDir)
	secret := filepath.Join(secretDir, "oidc.secret")
	os.WriteFile(secret, []byte(idp.ClientSecret+"\n"), 0o600)
	e := newEnv(t, "--oidc-issuer", idp.Issuer, "--oidc-client-id", idp.ClientID,
		"--oidc-client-secret-file", secret, "--oidc-label", "Sign in with Test")
	defer remember(idp.Secrets...)
	ts := newTmux(t)
	a := e.pairAgent(host, ts, "--allow-sessions")
	ts.split("work:0.0")
	ts.must("new-window", "-t", "work:1", "-n", "logs", shell())
	ts.title("work:1.0")
	e.expose(ts, "work", "--write")
	e.expose(ts, "work:0.1")
	e.mustCLI("expose", "--tmux-name", ts.name, "-t", "work:1.0", "--write", "--name", "logs")
	ts2 := newTmux(t)
	e.pairAgent("bob-desktop", ts2)
	e.expose(ts2, "work:0.0")
	full := e.token("browser", []string{"*"}, []string{"*"})
	readOnly := e.token("viewer", []string{host + "/*"}, nil)
	admin := e.adminToken()
	e.mustCLI("hub", "user", "create", "--dir", e.hubDir, "--email", idp.Account.Email, "--read", "*", "--write", "*")

	// A second hub, reached as localhost so the browser keeps its cookie
	// apart from the first's: the hubs list links to it.
	e2 := newEnvAs(t, "localhost")
	hub2 := e2.token("work-browser", []string{"*"}, nil)

	control := e.startControl(t, ts, a)
	attack := startAttackPage(t, e.url())
	runPlaywright(t, e, npx, webDir, os.Getenv("MX_GREP"),
		"MX_TOKEN="+full, "MX_RO_TOKEN="+readOnly, "MX_ADMIN_TOKEN="+admin, "MX_CONTROL="+control, "MX_ATTACK="+attack,
		"MX_HUB2="+e2.url(), "MX_HUB2_TOKEN="+hub2)
}

// The microphone needs a hub with a transcriber: the stand-in from the
// transcription tests, with a control hook to break it and count its calls.
// Spec 93 runs here with MX_STT set; its no-transcriber case runs above.
func TestUI_Microphone(t *testing.T) {
	npx, webDir := uiTools(t)
	if g := os.Getenv("MX_GREP"); g != "" {
		if ok, _ := regexp.MatchString(g, "93"); !ok {
			t.Skip("MX_GREP leaves spec 93 out")
		}
	}
	e, _ := sttEnv(t)
	ts := newTmux(t)
	a := e.pairAgent(host, ts)
	ts.split("work:0.0")
	e.expose(ts, "work:0.0", "--write")
	e.expose(ts, "work:0.1")
	full := e.token("browser", []string{"*"}, []string{"*"})
	readOnly := e.token("viewer", []string{host + "/*"}, nil)
	control := e.startControl(t, ts, a)
	runPlaywright(t, e, npx, webDir, "93",
		"MX_TOKEN="+full, "MX_RO_TOKEN="+readOnly, "MX_CONTROL="+control, "MX_STT=1")
}

func uiTools(t *testing.T) (npx, webDir string) {
	if os.Getenv("MUXWAY_SKIP_UI") != "" {
		t.Skip("MUXWAY_SKIP_UI set")
	}
	npx, err := exec.LookPath("npx")
	if err != nil {
		t.Skip("npx not found; the UI suite needs Node")
	}
	webDir, _ = filepath.Abs("../web")
	if _, err := os.Stat(filepath.Join(webDir, "node_modules", ".bin", "playwright")); err != nil {
		t.Skip("web/node_modules missing; run npm ci in web/")
	}
	return npx, webDir
}

// runPlaywright runs the specs (those matching grep, or all) against e and
// reports each as a subtest.
func runPlaywright(t *testing.T, e *env, npx, webDir, grep string, extraEnv ...string) {
	screens := filepath.Join(runDir, "screens")
	traces := filepath.Join(runDir, "traces")
	os.MkdirAll(screens, 0o755)
	os.MkdirAll(traces, 0o755)
	report := filepath.Join(e.dir, "playwright.json")

	args := []string{"playwright", "test", "--reporter=json"}
	if grep != "" {
		args = append(args, "--grep", grep)
	}
	cmd := exec.Command(npx, args...)
	cmd.Dir = webDir
	cmd.Env = append(os.Environ(),
		"MX_BASE_URL="+e.url(), "MX_HOST="+host, "MX_SCREENS="+screens, "MX_TRACES="+traces,
		"PLAYWRIGHT_JSON_OUTPUT_NAME="+report, "CI=1")
	cmd.Env = append(cmd.Env, extraEnv...)
	var stderr bytes.Buffer
	cmd.Stdout = e.logFile("playwright")
	cmd.Stderr = &stderr
	runErr := cmd.Run()
	raw, err := os.ReadFile(report)
	if err != nil {
		t.Fatalf("playwright produced no report (%v): %v\n%s", runErr, err, stderr.String())
	}
	var rep pwReport
	if err := json.Unmarshal(raw, &rep); err != nil {
		t.Fatalf("playwright report: %v", err)
	}
	n := 0
	rep.walk(func(title string, ok bool, msg string) {
		n++
		t.Run(title, func(t *testing.T) {
			if !ok {
				t.Error(msg)
			}
		})
	})
	if n == 0 {
		t.Fatalf("no specs ran: %v\n%s", runErr, stderr.String())
	}
}

type pwReport struct {
	Suites []pwSuite `json:"suites"`
}
type pwSuite struct {
	Title  string    `json:"title"`
	Suites []pwSuite `json:"suites"`
	Specs  []struct {
		Title string `json:"title"`
		Tests []struct {
			Results []struct {
				Status string `json:"status"`
				Error  struct {
					Message string `json:"message"`
				} `json:"error"`
			} `json:"results"`
		} `json:"tests"`
	} `json:"specs"`
}

func (r pwReport) walk(f func(title string, ok bool, msg string)) {
	var visit func(s pwSuite)
	visit = func(s pwSuite) {
		for _, sp := range s.Specs {
			for _, tc := range sp.Tests {
				if len(tc.Results) == 0 {
					f(sp.Title, false, "no result")
					continue
				}
				last := tc.Results[len(tc.Results)-1]
				f(sp.Title, last.Status == "passed" || last.Status == "skipped", last.Error.Message)
			}
		}
		for _, c := range s.Suites {
			visit(c)
		}
	}
	for _, s := range r.Suites {
		visit(s)
	}
}

// startControl serves the hooks a spec needs into the test environment.
func (e *env) startControl(t *testing.T, ts *tmuxServer, a *agentProc) string {
	mux := http.NewServeMux()
	text := func(w http.ResponseWriter, s string) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprint(w, s)
	}
	mux.HandleFunc("/pane-id", func(w http.ResponseWriter, r *http.Request) {
		out, _ := ts.run("display-message", "-p", "-t", r.URL.Query().Get("target"), "#{pane_id}")
		text(w, out)
	})
	mux.HandleFunc("/command", func(w http.ResponseWriter, r *http.Request) {
		out, _ := ts.run("display-message", "-p", "-t", r.URL.Query().Get("target"), "#{pane_current_command}")
		text(w, out)
	})
	mux.HandleFunc("/window-size", func(w http.ResponseWriter, r *http.Request) {
		out, _ := ts.run("display-message", "-p", "-t", r.URL.Query().Get("target"), "#{window_width}x#{window_height}")
		text(w, out)
	})
	mux.HandleFunc("/zoomed", func(w http.ResponseWriter, r *http.Request) {
		out, _ := ts.run("display-message", "-p", "-t", r.URL.Query().Get("target"), "#{window_zoomed_flag}")
		text(w, out)
	})
	mux.HandleFunc("/layout", func(w http.ResponseWriter, r *http.Request) {
		out, _ := ts.run("display-message", "-p", "-t", r.URL.Query().Get("target"), "#{window_layout}")
		text(w, out)
	})
	mux.HandleFunc("/split", func(w http.ResponseWriter, r *http.Request) {
		args := []string{"split-window", "-t", r.URL.Query().Get("target"), "-P", "-F", "#{pane_id}"}
		if r.URL.Query().Get("dir") == "h" {
			args = append(args, "-h")
		}
		id, _ := ts.run(append(args, shell())...)
		ts.run("select-pane", "-t", id, "-T", "test-pane")
		text(w, id)
	})
	mux.HandleFunc("/kill-pane", func(w http.ResponseWriter, r *http.Request) {
		_, err := ts.run("kill-pane", "-t", r.URL.Query().Get("target"))
		text(w, fmt.Sprint(err))
	})
	mux.HandleFunc("/capture", func(w http.ResponseWriter, r *http.Request) {
		out, _ := ts.run("capture-pane", "-p", "-t", r.URL.Query().Get("target"))
		text(w, out)
	})
	mux.HandleFunc("/send", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		ts.run("send-keys", "-t", q.Get("target"), "-l", q.Get("text"))
		ts.run("send-keys", "-t", q.Get("target"), "Enter")
		text(w, "ok")
	})
	mux.HandleFunc("/clear-history", func(w http.ResponseWriter, r *http.Request) {
		_, err := ts.run("clear-history", "-t", r.URL.Query().Get("target"))
		text(w, fmt.Sprint(err))
	})
	mux.HandleFunc("/key", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		_, err := ts.run("send-keys", "-t", q.Get("target"), q.Get("key"))
		text(w, fmt.Sprint(err))
	})
	mux.HandleFunc("/rename", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		switch q.Get("what") {
		case "window":
			_, err := ts.run("rename-window", "-t", q.Get("target"), q.Get("name"))
			text(w, fmt.Sprint(err))
		case "session":
			_, err := ts.run("rename-session", "-t", q.Get("target"), q.Get("name"))
			text(w, fmt.Sprint(err))
		case "title":
			_, err := ts.run("select-pane", "-t", q.Get("target"), "-T", q.Get("name"))
			text(w, fmt.Sprint(err))
		}
	})
	mux.HandleFunc("/notify", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		out, err := e.notify(a, "--pane", q.Get("pane"), "--kind", q.Get("kind"), "--text", q.Get("text"))
		text(w, out+fmt.Sprint(err))
	})
	// The transcriber stand-in, where the environment has one: how it answers
	// the next clips, and how many it has had.
	mux.HandleFunc("/stt", func(w http.ResponseWriter, r *http.Request) {
		if e.stt == nil {
			text(w, "none")
			return
		}
		switch r.URL.Query().Get("answer") {
		case "ok":
			e.stt.answer = sttOK
		case "500":
			e.stt.answer = func(w http.ResponseWriter) { w.WriteHeader(http.StatusInternalServerError) }
		}
		text(w, fmt.Sprint(e.stt.calls.Load()))
	})
	mux.HandleFunc("/hub", func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Query().Get("state") {
		case "stop":
			stop(e.hub)
		case "start":
			e.startHub()
			e.waitOnline(host, true)
		}
		text(w, "ok")
	})
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := &http.Server{Handler: mux}
	go srv.Serve(ln)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		srv.Shutdown(ctx)
	})
	return "http://" + ln.Addr().String()
}

// startAttackPage serves, from another origin, a page that tries to use
// the hub's cookie cross-site.
func startAttackPage(t *testing.T, hubURL string) string {
	page := strings.ReplaceAll(attackHTML, "HUB", hubURL)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, page)
	})}
	go srv.Serve(ln)
	t.Cleanup(func() { srv.Close() })
	return "http://" + ln.Addr().String() + "/attack.html?pane=" + url.QueryEscape(host+"/work/0.0")
}

const attackHTML = `<!doctype html><meta charset="utf-8"><title>attack</title>
<pre id="out"></pre>
<form id="f" method="post" target="sink" enctype="text/plain"></form>
<iframe name="sink" id="sink"></iframe>
<script>
const hub = "HUB";
const pane = new URLSearchParams(location.search).get("pane");
const out = document.getElementById("out");
const say = (k, v) => { out.textContent += k + "=" + v + "\n"; };
(async () => {
  try { const r = await fetch(hub + "/v1/me", {credentials: "include"}); say("plain", r.status); }
  catch (e) { say("plain", "blocked"); }
  try { const r = await fetch(hub + "/v1/me", {credentials: "include", headers: {"X-Muxway-Client": "evil"}}); say("header", r.status); }
  catch (e) { say("header", "blocked"); }
  const f = document.getElementById("f");
  f.action = hub + "/v1/panes/" + pane + "/input";
  const i = document.createElement("input"); i.name = '{"text":"echo attacked-'; i.value = 'x"}'; f.appendChild(i);
  f.submit();
  say("form", "submitted");
  say("done", "1");
})();
</script>`
