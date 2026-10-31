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
	"sync"
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
	// A second hub, reached as localhost so the browser keeps its cookie
	// apart from the first's; each names the other as a peer, so the first
	// hub's page lists and opens the second's panes.
	addr2 := freeAddr(t)
	_, port2, _ := net.SplitHostPort(addr2)
	hub2URL := "https://localhost:" + port2
	e := newEnv(t, "--oidc-issuer", idp.Issuer, "--oidc-client-id", idp.ClientID,
		"--oidc-client-secret-file", secret, "--oidc-label", "Sign in with Test", "--peer", hub2URL)
	defer remember(idp.Secrets...)
	ts := newTmux(t)
	// A preview root with a few files, where the first pane's shell starts.
	preview := filepath.Join(e.dir, "work")
	os.MkdirAll(filepath.Join(preview, "docs", "plans"), 0o700)
	os.WriteFile(filepath.Join(preview, "docs", "plans", "a.md"), []byte("# plan a\n\nThe goal, in a line.\n\n- one\n- two\n"), 0o600)
	os.WriteFile(filepath.Join(preview, "docs", "report.csv"), []byte("day,count\n1,2\n2,3\n"), 0o600)
	os.WriteFile(filepath.Join(preview, "docs", "evil.md"), []byte("# Hostile\n\n<script>alert(1)</script> <img src=x onerror=alert(1)>\n\n[go](javascript:alert(1)) and [fine](https://example.com/x)\n\n- a `code` span\n\n```js\nconst x = 1; // one\n```\n"), 0o600)
	os.WriteFile(filepath.Join(preview, "docs", "Program.cs"), []byte("// a program\npublic class Program { static void Main() { var s = \"hi\"; int n = 42; } }\n"), 0o600)
	os.WriteFile(filepath.Join(preview, "docs", "data.json"), []byte("{\"name\": \"muxway\", \"ports\": [7600, 7601], \"on\": true}\n"), 0o600)
	os.WriteFile(filepath.Join(preview, "docs", "page.html"), []byte("<b>bold?</b><script>alert(1)</script>\n"), 0o600)
	os.WriteFile(filepath.Join(preview, "docs", "note.pdf"), []byte("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"), 0o600)
	os.WriteFile(filepath.Join(preview, "docs", "shot.png"), png2, 0o600)
	os.WriteFile(filepath.Join(preview, "docs", "tx.py"), []byte("# a script\ndef run(n):\n    return \"ok\" * n + str(42)\n"), 0o600)
	os.WriteFile(filepath.Join(preview, "docs", "Makefile"), []byte("all:\n\t@echo built\n"), 0o600)
	os.WriteFile(filepath.Join(preview, ".env"), []byte("SECRET=1\n"), 0o600)
	os.WriteFile(filepath.Join(preview, "run.sh"), []byte("#!/bin/sh\n"), 0o600)
	// The root is a repository with a change of each kind, for the changes window.
	gitRepo(t, preview)
	a := e.pairAgent(host, ts, "--allow-sessions", "--inbox", "default", "--preview", preview)
	ts.must("send-keys", "-t", "work:0.0", "cd "+filepath.Join(preview, "docs")+" && clear", "Enter")
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

	e2 := newEnvOn(t, "localhost", addr2, "--peer", e.url())
	ts3 := newTmux(t)
	a2 := e2.pairAgent("carol-desk", ts3)
	e2.expose(ts3, "work:0.0", "--write")
	hub2 := e2.token("work-browser", []string{"*"}, []string{"*"})

	control := e.startControl(t, ts, a)
	control2 := e2.startControl(t, ts3, a2)
	attack := startAttackPage(t, e.url())
	runPlaywright(t, e, npx, webDir, os.Getenv("MX_GREP"),
		"MX_TOKEN="+full, "MX_RO_TOKEN="+readOnly, "MX_ADMIN_TOKEN="+admin, "MX_CONTROL="+control, "MX_ATTACK="+attack,
		"MX_HUB2="+e2.url(), "MX_HUB2_TOKEN="+hub2, "MX_CONTROL2="+control2, "MX_PREVIEW="+preview)
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

// Closing panes needs an agent run with --allow-close; it gets its own
// environment so no other spec's x reaches the host. Spec 89 runs here with
// MX_CLOSE set; its without-the-flag case runs in the main environment.
// Spec 110, the last pane of a session, runs here too.
func TestUI_Close(t *testing.T) {
	npx, webDir := uiTools(t)
	if g := os.Getenv("MX_GREP"); g != "" {
		if ok89, _ := regexp.MatchString(g, "89-"); !ok89 {
			if ok110, _ := regexp.MatchString(g, "110-"); !ok110 {
				t.Skip("MX_GREP leaves specs 89 and 110 out")
			}
		}
	}
	e := newEnv(t)
	ts := newTmux(t)
	a := e.pairAgent(host, ts, "--allow-close")
	ts.split("work:0.0")
	ts.split("work:0.0")
	e.expose(ts, "work:0.0", "--write")
	e.expose(ts, "work:0.1", "--write")
	e.expose(ts, "work:0.2")
	// A session of one pane, for the last pane's question (spec 110).
	ts.must("new-session", "-d", "-s", "solo", shell())
	ts.title("solo:0.0")
	e.expose(ts, "solo", "--write")
	full := e.token("browser", []string{"*"}, []string{"*"})
	control := e.startControl(t, ts, a)
	runPlaywright(t, e, npx, webDir, "89-|110-", "MX_TOKEN="+full, "MX_CONTROL="+control, "MX_CLOSE=1")
}

// One window's tiles kept in step with the window need a window whose
// panes are all writable; spec 100 runs here with MX_ARRANGE set, its
// read-only case in the main environment.
func TestUI_Arrange(t *testing.T) {
	npx, webDir := uiTools(t)
	if g := os.Getenv("MX_GREP"); g != "" {
		if ok, _ := regexp.MatchString(g, "100-"); !ok {
			t.Skip("MX_GREP leaves spec 100 out")
		}
	}
	e := newEnv(t)
	ts := newTmux(t)
	a := e.pairAgent(host, ts)
	ts.split("work:0.0")
	ts.split("work:0.0")
	e.expose(ts, "work", "--write")
	full := e.token("browser", []string{"*"}, []string{"*"})
	control := e.startControl(t, ts, a)
	runPlaywright(t, e, npx, webDir, "100-", "MX_TOKEN="+full, "MX_CONTROL="+control, "MX_ARRANGE=1")
}

// The keyboard and direct typing need a pane whose program shows each
// byte it reads; specs 102 and 104 run here with MX_KEYS set, their
// read-only cases in the main environment.
func TestUI_Keyboard(t *testing.T) {
	npx, webDir := uiTools(t)
	grep := "10[24]-"
	if g := os.Getenv("MX_GREP"); g != "" {
		ok2, _ := regexp.MatchString(g, "102-")
		ok4, _ := regexp.MatchString(g, "104-")
		if !ok2 && !ok4 {
			t.Skip("MX_GREP leaves specs 102 and 104 out")
		}
		grep = g
	}
	e := newEnv(t)
	ts := newTmux(t)
	a := e.pairAgent(host, ts)
	script := filepath.Join(t.TempDir(), "echo.py")
	os.WriteFile(script, []byte("import os,sys,tty\ntty.setraw(0)\nwhile True:\n  b=os.read(0,64)\n  os.write(1,(repr(b)+'\\r\\n').encode())\n"), 0o600)
	ts.must("respawn-pane", "-k", "-t", "work:0.0", "python3", script)
	ts.title("work:0.0")
	e.expose(ts, "work:0.0", "--write")
	full := e.token("browser", []string{"*"}, []string{"*"})
	control := e.startControl(t, ts, a)
	runPlaywright(t, e, npx, webDir, grep, "MX_TOKEN="+full, "MX_CONTROL="+control, "MX_KEYS=1")
}

// The inbox, questions with answers and the lens for another harness get
// their own environment: the watcher works on the panes here, and a
// question in flight must not meet another spec's typing. Specs 109 and
// 110 (talk between panes) run here with MX_AGENTS set.
func TestUI_Agents(t *testing.T) {
	npx, webDir := uiTools(t)
	if g := os.Getenv("MX_GREP"); g != "" {
		if ok, _ := regexp.MatchString(g, "109-"); !ok {
			if ok, _ := regexp.MatchString(g, "110-"); !ok {
				t.Skip("MX_GREP leaves specs 109 and 110 out")
			}
		}
	}
	e := newEnv(t)
	ts := newTmux(t)
	a := e.pairAgent(host, ts)
	ts.split("work:0.0")
	ts.split("work:0.0")
	e.expose(ts, "work:0.0", "--write")
	e.expose(ts, "work:0.1", "--write")
	e.expose(ts, "work:0.2")
	full := e.token("browser", []string{"*"}, []string{"*"})
	control := e.startControl(t, ts, a)
	runPlaywright(t, e, npx, webDir, "109-|110-", "MX_TOKEN="+full, "MX_CONTROL="+control, "MX_AGENTS=1")
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
	// Playwright empties its output directory at the start of a run, so
	// each environment's traces live under their own Go test's name.
	traces := filepath.Join(runDir, "traces", t.Name())
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
	mux.HandleFunc("/inbox", func(w http.ResponseWriter, r *http.Request) {
		entries, _ := os.ReadDir(filepath.Join(a.dir, "inbox"))
		var names []string
		for _, e := range entries {
			names = append(names, e.Name())
		}
		text(w, strings.Join(names, "\n"))
	})
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
	mux.HandleFunc("/places", func(w http.ResponseWriter, r *http.Request) {
		out, _ := ts.run("list-panes", "-t", r.URL.Query().Get("target"), "-F", "#{pane_id} #{pane_left} #{pane_top} #{pane_width} #{pane_height}")
		text(w, out)
	})
	mux.HandleFunc("/select-layout", func(w http.ResponseWriter, r *http.Request) {
		_, err := ts.run("select-layout", "-t", r.URL.Query().Get("target"), r.URL.Query().Get("layout"))
		text(w, fmt.Sprint(err))
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
	// A question with fixed answers in a pane, and how it ended: "pending",
	// or "<exit code> <answer>".
	var asksMu sync.Mutex
	asks := map[string]*askProc{}
	mux.HandleFunc("/ask", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		p := e.ask(a, q.Get("pane"), "120s", q.Get("text"), strings.Split(q.Get("choices"), ",")...)
		asksMu.Lock()
		id := fmt.Sprint(len(asks) + 1)
		asks[id] = p
		asksMu.Unlock()
		text(w, id)
	})
	mux.HandleFunc("/ask-result", func(w http.ResponseWriter, r *http.Request) {
		asksMu.Lock()
		p := asks[r.URL.Query().Get("id")]
		asksMu.Unlock()
		if p == nil {
			text(w, "unknown")
			return
		}
		select {
		case <-p.done:
			code, out := p.wait(t, time.Second)
			text(w, fmt.Sprintf("%d %s", code, out))
		default:
			text(w, "pending")
		}
	})
	// A stand-in harness in a pane, under a real one's name: it prints a
	// line a second until stopped with C-c.
	mux.HandleFunc("/fake-harness", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		ts.must("send-keys", "-t", q.Get("target"), "-l", "exec -a "+q.Get("name")+" bash -c 'clear; i=0; while true; do i=$((i+1)); echo \"tick $i\"; sleep 1; done'")
		ts.must("send-keys", "-t", q.Get("target"), "Enter")
		text(w, "ok")
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
