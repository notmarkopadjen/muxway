//go:build e2e

package e2e

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// A pane shared read-only: a link and a password open one pane for an
// observer who is no principal, under /v1/share/{id}/ and nowhere else.

const shareCookie = "muxway_share"

type share struct {
	ID       string `json:"id"`
	URL      string `json:"url"`
	Password string `json:"password"`
	Expires  int64  `json:"expires"`
	Host     string `json:"host"`
	PaneID   string `json:"pane_id"`
	Address  string `json:"address"`
	Watching int    `json:"watching"`
}

func shareEnv(t *testing.T) (*env, *tmuxServer, string, string) {
	t.Helper()
	e := newEnv(t)
	ts := newTmux(t)
	e.pairAgent(host, ts)
	ts.split("work:0.0")
	e.expose(ts, "work:0.0", "--write")
	e.expose(ts, "work:0.1")
	ts.must("send-keys", "-t", "work:0.0", "-l", "echo SHARED-LINE-7")
	ts.must("send-keys", "-t", "work:0.0", "Enter")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	reader := e.token("reader", []string{host + "/*"}, nil)
	return e, ts, full, reader
}

func (e *env) share(tok, pane, body string) (resp, share) {
	e.t.Helper()
	r := e.post(tok, "/v1/panes/"+pane+"/shares", body)
	var out struct {
		Share share `json:"share"`
	}
	json.Unmarshal([]byte(r.body), &out)
	if out.Share.ID != "" {
		remember(out.Share.ID, out.Share.Password)
	}
	return r, out.Share
}

// open posts the password and returns the observer's cookie.
func (e *env) open(id, password string) (resp, string) {
	e.t.Helper()
	r := e.post("", "/v1/share/"+id+"/open", fmt.Sprintf(`{"password":%q}`, password))
	return r, cookieValue(r, shareCookie)
}

func (e *env) observe(cookie, method, path string, headers ...string) resp {
	e.t.Helper()
	all := append([]string{"Cookie", shareCookie + "=" + cookie, clientHeader, "e2e"}, headers...)
	return e.do(method, "", path, "", "", all...)
}

func showingBody(meta, typ string, data []byte) (string, string) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	p, _ := mw.CreateFormField("meta")
	p.Write([]byte(meta))
	if typ != "" {
		h := map[string][]string{"Content-Disposition": {`form-data; name="file"; filename="f"`}, "Content-Type": {typ}}
		fp, _ := mw.CreatePart(h)
		fp.Write(data)
	}
	mw.Close()
	return mw.FormDataContentType(), buf.String()
}

// 200
func TestSec200_AShareCookieOpensNothingElse(t *testing.T) {
	e, _, full, _ := shareEnv(t)
	r, sh := e.share(full, shell0, `{}`)
	expect(t, r, http.StatusCreated, "create")
	r2, sh2 := e.share(full, shell0, `{}`)
	expect(t, r2, http.StatusCreated, "a second share")
	_, cookie := e.open(sh.ID, sh.Password)
	if cookie == "" {
		t.Fatal("no share cookie")
	}
	expect(t, e.observe(cookie, "GET", "/v1/share/"+sh.ID+"/pane"), http.StatusOK, "the observer's pane")
	for _, p := range [][2]string{
		{"GET", "/v1/me"}, {"GET", "/v1/hosts"}, {"GET", "/v1/panes"}, {"GET", "/v1/panes/" + shell0},
		{"POST", "/v1/panes/" + shell0 + "/input"}, {"POST", "/v1/panes/" + shell0 + "/answer"},
		{"POST", "/v1/panes/" + shell0 + "/resize"}, {"POST", "/v1/panes/" + shell0 + "/files"},
		{"GET", "/v1/panes/" + shell0 + "/files"}, {"GET", "/v1/panes/" + shell0 + "/preview?path=a"},
		{"GET", "/v1/panes/" + shell0 + "/git"}, {"GET", "/v1/panes/" + shell0 + "/git/diff?path=a"},
		{"GET", "/v1/panes/" + shell0 + "/mail"}, {"POST", "/v1/panes/" + shell0 + "/mail"},
		{"POST", "/v1/panes/" + shell0 + "/shares"}, {"GET", "/v1/shares"}, {"DELETE", "/v1/shares/" + sh.ID},
		{"PUT", "/v1/share/" + sh.ID + "/showing"}, {"DELETE", "/v1/share/" + sh.ID + "/showing"},
		{"GET", "/v1/windows/" + host + "/work/0"}, {"GET", "/v1/hosts/" + host + "/tree"},
		{"GET", "/v1/events"}, {"GET", "/v1/inbox"}, {"GET", "/v1/talk"}, {"GET", "/v1/transcribe"},
		{"GET", "/v1/admin/overview"}, {"GET", "/v1/admin/log"},
		// Another share's endpoints, sent by hand: the browser would not even send the cookie.
		{"GET", "/v1/share/" + sh2.ID + "/pane"}, {"GET", "/v1/share/" + sh2.ID + "/showing"},
	} {
		r := e.observe(cookie, p[0], p[1])
		if r.status != http.StatusUnauthorized {
			t.Fatalf("%s %s with a share cookie: %d %s", p[0], p[1], r.status, strings.TrimSpace(r.body))
		}
	}
	// Without the client header the cookie is nothing either.
	expect(t, e.do("GET", "", "/v1/share/"+sh.ID+"/pane", "", "", "Cookie", shareCookie+"="+cookie), http.StatusUnauthorized, "cookie without the header")
}

// 201
func TestSec201_WrongPasswordsLockAndBurn(t *testing.T) {
	e, _, full, _ := shareEnv(t)
	_, sh := e.share(full, shell0, `{"password":"right-one-here"}`)
	expect(t, e.get("", "/v1/share/"+sh.ID), http.StatusOK, "the link is live")
	for i := 0; i < 10; i++ {
		r, c := e.open(sh.ID, "wrong-one-here")
		if r.status != http.StatusUnauthorized || c != "" {
			t.Fatalf("attempt %d: %d, cookie %q", i, r.status, c)
		}
		if i >= 4 {
			time.Sleep(1100 * time.Millisecond)
		}
	}
	r, _ := e.open(sh.ID, "right-one-here")
	expect(t, r, http.StatusTooManyRequests, "the address is locked out")
	expect(t, e.get("", "/v1/share/"+sh.ID), http.StatusNotFound, "the share is burned")
	raw, _ := os.ReadFile(filepath.Join(e.logs, "hub.log"))
	if !strings.Contains(string(raw), "share burned") || !strings.Contains(string(raw), "share refused") {
		t.Fatal("the burn is not logged")
	}
}

// 202
func TestSec202_AShareEndsWithItsPaneSharerOrRevoke(t *testing.T) {
	e, ts, full, _ := shareEnv(t)
	expect(t, e.get("", "/v1/share/nosuchshareid"), http.StatusNotFound, "a wrong id")
	r, _ := e.open("nosuchshareid", "whatever-pw")
	expect(t, r, http.StatusNotFound, "open on a wrong id")

	_, sh := e.share(full, shell0, `{}`)
	_, cookie := e.open(sh.ID, sh.Password)
	expect(t, e.observe(cookie, "GET", "/v1/share/"+sh.ID+"/pane"), http.StatusOK, "open")
	expect(t, e.do("DELETE", full, "/v1/shares/"+sh.ID, "", ""), http.StatusNoContent, "revoke")
	expect(t, e.observe(cookie, "GET", "/v1/share/"+sh.ID+"/pane"), http.StatusUnauthorized, "after the revoke")
	expect(t, e.get("", "/v1/share/"+sh.ID), http.StatusNotFound, "the link after the revoke")

	// A share of a token that is then revoked.
	other := e.token("other", []string{host + "/*"}, []string{host + "/*"})
	_, sh2 := e.share(other, shell0, `{}`)
	_, cookie2 := e.open(sh2.ID, sh2.Password)
	var me struct {
		ID string `json:"id"`
	}
	json.Unmarshal([]byte(e.get(other, "/v1/me").body), &me)
	admin := e.adminToken()
	expect(t, e.do("DELETE", admin, "/v1/admin/tokens/"+me.ID, "", ""), http.StatusNoContent, "revoke the sharer")
	expect(t, e.observe(cookie2, "GET", "/v1/share/"+sh2.ID+"/pane"), http.StatusUnauthorized, "the sharer gone")
	expect(t, e.get("", "/v1/share/"+sh2.ID), http.StatusNotFound, "the link with the sharer gone")

	// The pane closed under a share: the observer gets nothing more.
	_, sh3 := e.share(full, host+"/work/0.1", `{}`)
	expect(t, e.get("", "/v1/share/"+sh3.ID), http.StatusNotFound, "a read-only pane cannot be shared")
	_, sh4 := e.share(full, shell0, `{}`)
	_, cookie4 := e.open(sh4.ID, sh4.Password)
	e.mustCLI("expose", "--tmux-name", ts.name, "-t", "work:0.0", "--deny")
	time.Sleep(1200 * time.Millisecond)
	expect(t, e.observe(cookie4, "GET", "/v1/share/"+sh4.ID+"/pane"), http.StatusNotFound, "the pane unexposed")
}

// 203
func TestSec203_SharingNeedsTheWriteGrantAndSaneInput(t *testing.T) {
	e, _, full, reader := shareEnv(t)
	r, _ := e.share(reader, shell0, `{}`)
	expect(t, r, http.StatusForbidden, "a reader")
	r, _ = e.share(full, host+"/work/0.1", `{}`)
	expect(t, r, http.StatusForbidden, "a read-only pane")
	one := e.token("one", []string{host + "/*"}, []string{host + "/work/0.0"})
	r, _ = e.share(one, host+"/work/0.1", `{}`)
	expect(t, r, http.StatusForbidden, "a pane outside the write grant")
	r, _ = e.share("", shell0, `{}`)
	expect(t, r, http.StatusUnauthorized, "no token")
	for _, body := range []string{`{"ttl":59}`, `{"ttl":604801}`, `{"password":"seven77"}`, `{"password":"with\ttab-in-it"}`, `{"x":1}`, `nonsense`} {
		r, _ = e.share(full, shell0, body)
		if r.status != http.StatusBadRequest {
			t.Fatalf("%s: %d", body, r.status)
		}
	}
	for i := 0; i < 20; i++ {
		r, _ = e.share(full, shell0, `{}`)
		expect(t, r, http.StatusCreated, fmt.Sprintf("share %d", i+1))
	}
	r, _ = e.share(full, shell0, `{}`)
	expect(t, r, http.StatusConflict, "the twenty-first")
	if !strings.Contains(r.body, "too_many") {
		t.Fatal(r.body)
	}
}

// 204
func TestSec204_TheShowingIsTheSharersAlone(t *testing.T) {
	e, _, full, _ := shareEnv(t)
	_, sh := e.share(full, shell0, `{}`)
	_, cookie := e.open(sh.ID, sh.Password)
	other := e.token("other", []string{host + "/*"}, []string{host + "/*"})
	good := `{"kind":"diff","path":"src/a.go","view":"diff"}`
	put := func(tok, ctype, body string, headers ...string) resp {
		return e.do("PUT", tok, "/v1/share/"+sh.ID+"/showing", "", body, append([]string{"Content-Type", ctype}, headers...)...)
	}
	ct, body := showingBody(good, "text/plain", []byte("+ added\n- gone\n"))
	expect(t, put(other, ct, body), http.StatusNotFound, "another writer")
	expect(t, e.do("PUT", "", "/v1/share/"+sh.ID+"/showing", "", body, "Content-Type", ct, "Cookie", shareCookie+"="+cookie, clientHeader, "e2e"), http.StatusUnauthorized, "the observer")
	ct, body = showingBody(good, "text/plain", bytes.Repeat([]byte("a"), 9<<20))
	expect(t, put(full, ct, body), http.StatusRequestEntityTooLarge, "9 MiB")
	ct, body = showingBody(good, "text/html", []byte("<script>"))
	expect(t, put(full, ct, body), http.StatusBadRequest, "html")
	ct, body = showingBody(`{"kind":"file","path":"a","view":"raw"}`, "", nil)
	expect(t, put(full, ct, body), http.StatusBadRequest, "a view outside the list")
	ct, body = showingBody("{\"kind\":\"file\",\"path\":\"a\\u0001b\",\"view\":\"plain\"}", "", nil)
	expect(t, put(full, ct, body), http.StatusBadRequest, "a control character in the path")
	ct, body = showingBody(good, "", nil)
	expect(t, put(full, ct, body), http.StatusBadRequest, "meta without bytes held")
	ct, body = showingBody(good, "text/plain", []byte("+ added\n- gone\n"))
	expect(t, put(full, ct, body), http.StatusNoContent, "the sharer")
	r := e.observe(cookie, "GET", "/v1/share/"+sh.ID+"/showing?after=0&wait=5")
	expect(t, r, http.StatusOK, "the observer's showing")
	if !strings.Contains(r.body, `"rev":1`) || !strings.Contains(r.body, `"kind":"diff"`) || !strings.Contains(r.body, `"bytes":15`) {
		t.Fatal(r.body)
	}
	f := e.observe(cookie, "GET", "/v1/share/"+sh.ID+"/showing/file")
	expect(t, f, http.StatusOK, "the file")
	if f.body != "+ added\n- gone\n" || f.header.Get("Content-Type") != "text/plain" || f.header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("%q %v", f.body, f.header)
	}
	ct, body = showingBody(`{"kind":"diff","path":"src/a.go","view":"file"}`, "", nil)
	expect(t, put(full, ct, body), http.StatusNoContent, "the view alone")
	r = e.observe(cookie, "GET", "/v1/share/"+sh.ID+"/showing?after=1")
	if !strings.Contains(r.body, `"rev":2`) || !strings.Contains(r.body, `"view":"file"`) {
		t.Fatal(r.body)
	}
	expect(t, e.do("DELETE", full, "/v1/share/"+sh.ID+"/showing", "", ""), http.StatusNoContent, "cleared")
	r = e.observe(cookie, "GET", "/v1/share/"+sh.ID+"/showing?after=2")
	if !strings.Contains(r.body, `"showing":null`) {
		t.Fatal(r.body)
	}
	expect(t, e.observe(cookie, "GET", "/v1/share/"+sh.ID+"/showing/file"), http.StatusNotFound, "no file once cleared")
}

// 205
func TestSec205_ShareLogsCarryHandlesNotSecrets(t *testing.T) {
	e, _, full, _ := shareEnv(t)
	_, sh := e.share(full, shell0, `{}`)
	r, cookie := e.open(sh.ID, sh.Password)
	if !strings.Contains(r.header.Get("Set-Cookie"), "Path=/v1/share/"+sh.ID) || !strings.Contains(r.header.Get("Set-Cookie"), "HttpOnly") {
		t.Fatalf("cookie: %s", r.header.Get("Set-Cookie"))
	}
	e.open(sh.ID, "not-the-password")
	expect(t, e.observe(cookie, "GET", "/v1/share/"+sh.ID+"/pane?ansi=1"), http.StatusOK, "a read")
	ct, body := showingBody(`{"kind":"file","path":"docs/a.md","view":"rendered"}`, "text/plain", []byte("# secret heading\n"))
	expect(t, e.do("PUT", full, "/v1/share/"+sh.ID+"/showing", "", body, "Content-Type", ct), http.StatusNoContent, "showing")
	expect(t, e.do("DELETE", full, "/v1/shares/"+sh.ID, "", ""), http.StatusNoContent, "revoke")
	time.Sleep(300 * time.Millisecond)
	for _, f := range []string{"hub.log", "agent-" + host + ".log"} {
		raw, _ := os.ReadFile(filepath.Join(e.logs, f))
		s := string(raw)
		for _, secret := range []string{sh.ID, sh.Password, cookie, "SHARED-LINE-7", "secret heading", "not-the-password"} {
			if strings.Contains(s, secret) {
				t.Fatalf("%s holds %q", f, secret)
			}
		}
	}
	hub, _ := os.ReadFile(filepath.Join(e.logs, "hub.log"))
	for _, want := range []string{"share created", "share opened", "share refused", "share revoked", "audit showing", "kind=file", "bytes=17", "path_len=9"} {
		if !strings.Contains(string(hub), want) {
			t.Fatalf("hub.log lacks %q", want)
		}
	}
}

// 206
func TestSec206_TheObserverSeesThePaneAndNothingOfTheSharer(t *testing.T) {
	e, _, full, _ := shareEnv(t)
	r, sh := e.share(full, shell0, `{"ttl":3600}`)
	expect(t, r, http.StatusCreated, "create")
	if sh.URL != e.url()+"/s/"+sh.ID || sh.Address != shell0 || sh.Password == "" || len(sh.ID) < 20 {
		t.Fatalf("%+v", sh)
	}
	if sh.Expires > time.Now().Add(3601*time.Second).Unix() || sh.Expires < time.Now().Add(3500*time.Second).Unix() {
		t.Fatalf("expires %d", sh.Expires)
	}
	// Listed for the sharer, with the pane's count; not for another principal.
	list := e.get(full, "/v1/shares")
	expect(t, list, http.StatusOK, "list")
	if !strings.Contains(list.body, sh.ID) || strings.Contains(list.body, sh.Password) {
		t.Fatal(list.body)
	}
	if !strings.Contains(e.get(full, "/v1/panes").body, `"shared":1`) {
		t.Fatal("the sharer's listing lacks the count")
	}
	other := e.token("other", []string{host + "/*"}, []string{host + "/*"})
	if strings.Contains(e.get(other, "/v1/panes").body, `"shared"`) || strings.Contains(e.get(other, "/v1/shares").body, sh.ID) {
		t.Fatal("another principal sees the share")
	}

	_, cookie := e.open(sh.ID, sh.Password)
	r = e.observe(cookie, "GET", "/v1/share/"+sh.ID+"/pane?ansi=1&lines=50")
	expect(t, r, http.StatusOK, "the pane")
	var got struct {
		Pane    map[string]any `json:"pane"`
		Content string         `json:"content"`
		Expires int64          `json:"expires"`
	}
	json.Unmarshal([]byte(r.body), &got)
	if !strings.Contains(got.Content, "SHARED-LINE-7") || got.Pane["address"] != shell0 || got.Pane["mode"] != "read" || got.Expires != sh.Expires {
		t.Fatalf("%s", r.body)
	}
	for _, key := range []string{"cwd", "talk", "mail", "shared"} {
		if _, has := got.Pane[key]; has {
			t.Fatalf("the observer's pane carries %s", key)
		}
	}
	etag := r.header.Get("ETag")
	expect(t, e.observe(cookie, "GET", "/v1/share/"+sh.ID+"/pane?ansi=1&lines=50", "If-None-Match", etag), http.StatusNotModified, "etag")
	expect(t, e.observe(cookie, "GET", "/v1/share/"+sh.ID+"/pane?lines=0"), http.StatusBadRequest, "lines out of range")
	expect(t, e.observe(cookie, "GET", "/v1/share/"+sh.ID+"/showing?after=0"), http.StatusOK, "no showing yet")
	if w := e.get(full, "/v1/shares"); !strings.Contains(w.body, `"watching":1`) {
		t.Fatal(w.body)
	}
	admin := e.adminToken()
	ov := e.get(admin, "/v1/admin/overview")
	if !strings.Contains(ov.body, `"shares":[{`) || !strings.Contains(ov.body, sh.ID) {
		t.Fatal("the overview lacks the share")
	}
	expect(t, e.observe(cookie, "POST", "/v1/share/"+sh.ID+"/close"), http.StatusNoContent, "close")
	expect(t, e.observe(cookie, "GET", "/v1/share/"+sh.ID+"/pane"), http.StatusUnauthorized, "after close")
	expect(t, e.do("DELETE", admin, "/v1/shares/"+sh.ID, "", ""), http.StatusNoContent, "an admin revokes")
	expect(t, e.do("DELETE", admin, "/v1/shares/"+sh.ID, "", ""), http.StatusNotFound, "twice")
}
