//go:build e2e

package e2e

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

// 16
func TestFlow16_ListTreeAndReadInJSONAndTextMode(t *testing.T) {
	e := newEnv(t)
	ts := newTmux(t)
	e.pairAgent(host, ts)
	ts.split("work:0.0")
	ts.must("new-window", "-t", "work:1", "-n", "logs", shell())
	ts.title("work:1.0")
	e.expose(ts, "work", "--write")
	e.mustCLI("expose", "--tmux-name", ts.name, "-t", "work:1.0", "--write", "--name", "logs")
	ts.must("send-keys", "-t", "work:1.0", "-l", "echo ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
	ts.must("send-keys", "-t", "work:1.0", "Enter")
	tok := e.token("full", []string{host + "/*"}, []string{host + "/*"})

	r := e.get(tok, "/v1/panes")
	expect(t, r, http.StatusOK, "list")
	var list struct {
		Panes []struct {
			Address string `json:"address"`
			Window  string `json:"window"`
			Mode    string `json:"mode"`
		} `json:"panes"`
	}
	json.Unmarshal([]byte(r.body), &list)
	var got []string
	for _, p := range list.Panes {
		got = append(got, p.Address+" "+p.Window+" "+p.Mode)
	}
	want := []string{host + "/work/0.0 shell write", host + "/work/0.1 shell write", host + "/work/1.0 logs write"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("list:\n%s", strings.Join(got, "\n"))
	}
	text := e.getText(tok, "/v1/panes")
	if lines := strings.Split(strings.TrimSpace(text.body), "\n"); len(lines) != 3 || !strings.HasPrefix(lines[2], host+"/work/1.0\twrite\t") {
		t.Fatalf("text list:\n%s", text.body)
	}

	tree := e.get(tok, "/v1/hosts/"+host+"/tree")
	var tr struct {
		Sessions []struct {
			Name    string `json:"name"`
			Windows []struct {
				Index  int    `json:"index"`
				Layout string `json:"layout"`
				Panes  []any  `json:"panes"`
			} `json:"windows"`
		} `json:"sessions"`
	}
	json.Unmarshal([]byte(tree.body), &tr)
	if len(tr.Sessions) != 1 || len(tr.Sessions[0].Windows) != 2 || len(tr.Sessions[0].Windows[0].Panes) != 2 ||
		tr.Sessions[0].Windows[0].Layout == "" {
		t.Fatalf("tree: %s", tree.body)
	}

	waitFor(t, "echo output", func() bool {
		return strings.Contains(e.getText(tok, "/v1/panes/"+host+"/work/logs.0?width=80").body, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
	})
	narrow := e.getText(tok, "/v1/panes/"+host+"/@logs?width=15&lines=50")
	expect(t, narrow, http.StatusOK, "by alias")
	for _, line := range strings.Split(strings.TrimRight(narrow.body, "\n"), "\n") {
		if len([]rune(line)) > 15 {
			t.Fatalf("line wider than 15: %q", line)
		}
	}
	if !strings.Contains(narrow.body, "ABCDEFGHIJKLMNO\nPQRSTUVWXYZ0123\n456789") {
		t.Fatalf("not wrapped at 15:\n%s", narrow.body)
	}
	// Latin-1 and ASCII clients get lines, bullets and letters they can show.
	ts.must("send-keys", "-t", "work:1.0", "-l", "echo '─── ❯ čćž 日本 ä …'")
	ts.must("send-keys", "-t", "work:1.0", "Enter")
	waitFor(t, "symbols echoed", func() bool {
		return strings.Count(e.getText(tok, "/v1/panes/"+host+"/work/1.0").body, "─── ❯ čćž 日本 ä …") == 2
	})
	utf := e.getText(tok, "/v1/panes/"+host+"/work/1.0?charset=utf-8")
	lat := e.getText(tok, "/v1/panes/"+host+"/work/1.0?charset=latin1")
	asc := e.getText(tok, "/v1/panes/"+host+"/work/1.0?charset=ascii")
	for _, c := range []struct {
		r          resp
		mime, want string
	}{
		{utf, "text/plain; charset=utf-8", "─── ❯ čćž 日本 ä …"},
		{lat, "text/plain; charset=iso-8859-1", "--- > ccz ?? \xe4 ..."},
		{asc, "text/plain; charset=us-ascii", "--- > ccz ?? a ..."},
	} {
		expect(t, c.r, http.StatusOK, c.mime)
		if c.r.header.Get("Content-Type") != c.mime || !strings.Contains(c.r.body, c.want) {
			t.Fatalf("%s: got %q\n%q", c.mime, c.r.header.Get("Content-Type"), c.r.body)
		}
	}
	if utf.header.Get("ETag") == lat.header.Get("ETag") || lat.header.Get("ETag") == asc.header.Get("ETag") {
		t.Fatal("etags do not tell the charsets apart")
	}
	expect(t, e.do("GET", tok, "/v1/panes/"+host+"/work/1.0?charset=latin1", "text/plain", "", "If-None-Match", lat.header.Get("ETag")), http.StatusNotModified, "latin1 etag")
	js := e.get(tok, "/v1/panes/"+host+"/work/1.0?ansi=1&charset=ascii")
	expect(t, js, http.StatusOK, "json read")
	var pane struct {
		Content string `json:"content"`
	}
	json.Unmarshal([]byte(js.body), &pane)
	if !strings.Contains(pane.Content, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") || !strings.Contains(pane.Content, "❯ čćž") {
		t.Fatalf("json content: %s", js.body)
	}
	etag := js.header.Get("ETag")
	again := e.do("GET", tok, "/v1/panes/"+host+"/work/1.0?ansi=1&charset=ascii", "", "", "If-None-Match", etag)
	expect(t, again, http.StatusNotModified, "etag")
	// A token granted one pane by its alias sees and writes that pane only.
	one := e.token("one", []string{host + "/@logs"}, []string{host + "/@logs"})
	if r := e.getText(one, "/v1/panes"); strings.Count(r.body, "\n") != 1 || !strings.HasPrefix(r.body, host+"/work/1.0\twrite") {
		t.Fatalf("alias token list: %q", r.body)
	}
	expect(t, e.input(one, host+"/@logs", map[string]string{"key": "C-l"}), http.StatusNoContent, "alias write")
	expect(t, e.get(one, "/v1/panes/"+host+"/work/0.0"), http.StatusNotFound, "alias token, other pane")
}

// 17
func TestFlow17_TypeTextKeysAndInterrupt(t *testing.T) {
	e, ts, _ := basic(t)
	tok := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	expect(t, e.input(tok, shell0, map[string]string{"text": "echo hi-$((40+2))"}), http.StatusNoContent, "text")
	expect(t, e.input(tok, shell0, map[string]string{"key": "Enter"}), http.StatusNoContent, "enter")
	waitFor(t, "echo output", func() bool { return strings.Contains(ts.capture("work:0.0"), "hi-42") })
	expect(t, e.input(tok, shell0, map[string]string{"text": "sleep 100"}), http.StatusNoContent, "sleep")
	expect(t, e.input(tok, shell0, map[string]string{"key": "Enter"}), http.StatusNoContent, "enter")
	waitFor(t, "sleep running", func() bool {
		return ts.must("display-message", "-p", "-t", "work:0.0", "#{pane_current_command}") == "sleep"
	})
	expect(t, e.input(tok, shell0, map[string]string{"key": "C-c"}), http.StatusNoContent, "C-c")
	waitFor(t, "sleep interrupted", func() bool {
		return ts.must("display-message", "-p", "-t", "work:0.0", "#{pane_current_command}") == "bash"
	})
	expect(t, e.input(tok, shell0, map[string]string{"text": "čćž 日本"}), http.StatusNoContent, "unicode")
	waitFor(t, "unicode typed", func() bool { return strings.Contains(ts.capture("work:0.0"), "čćž 日本") })
	// Shift-Tab reaches the pane as ESC [ Z, which the terminal echoes as ^[[Z.
	expect(t, e.input(tok, shell0, map[string]string{"key": "C-c"}), http.StatusNoContent, "clear line")
	expect(t, e.input(tok, shell0, map[string]string{"text": "cat"}), http.StatusNoContent, "cat")
	expect(t, e.input(tok, shell0, map[string]string{"key": "Enter"}), http.StatusNoContent, "enter")
	waitFor(t, "cat running", func() bool {
		return ts.must("display-message", "-p", "-t", "work:0.0", "#{pane_current_command}") == "cat"
	})
	expect(t, e.input(tok, shell0, map[string]string{"key": "BTab"}), http.StatusNoContent, "BTab")
	waitFor(t, "shift-tab typed", func() bool { return strings.Contains(ts.capture("work:0.0"), "^[[Z") })
	expect(t, e.input(tok, shell0, map[string]string{"key": "C-c"}), http.StatusNoContent, "C-c")
}

// 18
func TestFlow18_TwoHostsAreRoutedSeparately(t *testing.T) {
	e, ts1, _ := basic(t)
	ts2 := newTmux(t)
	e.pairAgent("bob-desktop", ts2)
	e.expose(ts2, "work:0.0", "--write")
	tok := e.token("both", []string{"*"}, []string{"*"})
	expect(t, e.input(tok, "bob-desktop/work/0.0", map[string]string{"text": "echo on-bob"}), http.StatusNoContent, "bob")
	e.input(tok, "bob-desktop/work/0.0", map[string]string{"key": "Enter"})
	expect(t, e.input(tok, shell0, map[string]string{"text": "echo on-alice"}), http.StatusNoContent, "alice")
	e.input(tok, shell0, map[string]string{"key": "Enter"})
	waitFor(t, "both echoed", func() bool {
		return strings.Contains(ts2.capture("work:0.0"), "on-bob") && strings.Contains(ts1.capture("work:0.0"), "on-alice")
	})
	if strings.Contains(ts1.capture("work:0.0"), "on-bob") || strings.Contains(ts2.capture("work:0.0"), "on-alice") {
		t.Fatal("input reached the wrong host")
	}
	hosts := e.getText(tok, "/v1/hosts").body
	if hosts != host+"\tonline\nbob-desktop\tonline\n" && hosts != "alice-laptop\tonline\nbob-desktop\tonline\n" {
		t.Fatalf("hosts: %q", hosts)
	}
}

// 19
func TestFlow19_ReconnectAfterHubRestartAndOfflineHost(t *testing.T) {
	e, _, a := basic(t)
	tok := e.token("reader", []string{host + "/*"}, nil)
	expect(t, e.get(tok, "/v1/panes/"+shell0), http.StatusOK, "before")
	e.stopHub()
	e.startHub()
	start := time.Now()
	e.waitOnline(host, true)
	t.Logf("agent back after %s", time.Since(start).Round(time.Millisecond))
	expect(t, e.get(tok, "/v1/panes/"+shell0), http.StatusOK, "after hub restart")
	stop(a.cmd)
	e.waitOnline(host, false)
	expect(t, e.get(tok, "/v1/panes/"+shell0), http.StatusServiceUnavailable, "agent gone")
	if !strings.Contains(e.getText(tok, "/v1/hosts").body, host+"\toffline") {
		t.Fatal("host not shown offline")
	}
}
