//go:build e2e

package e2e

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The desk: the view the owner's clients share, kept by the hub.

func (e *env) putDesk(tok, body string) resp { return e.do("PUT", tok, "/v1/desk", "", body) }

const deskTwo = `{"view":"panes","panes":["alice-laptop/work/0.0","alice-laptop/work/0.1"],"focused":"alice-laptop/work/0.1","arrangement":"custom","tree":{"kind":"h","key":"r","children":[0,1]},"weights":{"r":[0.6,0.4]},"minimised":["alice-laptop/work/0.2"],"order":["alice-laptop/work/0.1","alice-laptop/work/0.0"]}`

func TestSec196_DeskNeedsAWriteGrantAndNamesOnlyWhatTheWriterReads(t *testing.T) {
	e, ts, _ := basic(t)
	ts.split("work:0.0")
	ts.split("work:0.0")
	e.expose(ts, "work:0.1", "--write")
	e.expose(ts, "work:0.2", "--write")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	reader := e.token("reader", []string{host + "/*"}, nil)
	narrow := e.token("narrow", []string{host + "/work/0.0"}, []string{host + "/work/0.0"})
	// Nothing yet: an empty desk, readable by anyone with a session.
	r := e.get(reader, "/v1/desk")
	expect(t, r, http.StatusOK, "empty desk")
	if !strings.Contains(r.body, `"view":"panes"`) || strings.Contains(r.body, `"panes":[`) {
		t.Fatalf("empty desk: %s", r.body)
	}
	expect(t, e.putDesk(reader, deskTwo), http.StatusForbidden, "a read-only token writes the desk")
	expect(t, e.putDesk(narrow, deskTwo), http.StatusForbidden, "a desk naming a pane outside the grants")
	if r := e.putDesk(narrow, deskTwo); !strings.Contains(r.body, "not_yours") {
		t.Fatalf("the refusal's code: %s", r.body)
	}
	for name, body := range map[string]string{
		"five panes":       `{"view":"panes","panes":["alice-laptop/work/0.0","alice-laptop/work/0.1","alice-laptop/work/0.2","alice-laptop/work/0.3","alice-laptop/work/0.4"]}`,
		"a pane twice":     `{"view":"panes","panes":["alice-laptop/work/0.0","alice-laptop/work/0.0"]}`,
		"a bad address":    `{"view":"panes","panes":["alice laptop/work/0.0"]}`,
		"an unknown view":  `{"view":"board","panes":["alice-laptop/work/0.0"]}`,
		"a wrong tree":     `{"view":"panes","panes":["alice-laptop/work/0.0","alice-laptop/work/0.1"],"tree":{"kind":"h","key":"r","children":[0]}}`,
		"a weight of two":  `{"view":"panes","panes":["alice-laptop/work/0.0"],"weights":{"r":[2,0.5]}}`,
		"an unknown field": `{"view":"panes","panes":["alice-laptop/work/0.0"],"colour":"red"}`,
		"not json":         `nope`,
	} {
		if r := e.putDesk(full, body); r.status != http.StatusBadRequest {
			t.Fatalf("%s: %d %s", name, r.status, r.body)
		}
	}
	big := `{"view":"panes","panes":["alice-laptop/work/0.0"],"by":"` + strings.Repeat("x", 9000) + `"}`
	expect(t, e.putDesk(full, big), http.StatusRequestEntityTooLarge, "9 KiB")
	// Nothing of that landed.
	if r := e.get(full, "/v1/desk"); strings.Contains(r.body, `"panes":[`) {
		t.Fatalf("a refused desk landed: %s", r.body)
	}
	// An observer's cookie is no principal: no desk for it.
	_, sh := e.share(full, shell0, `{}`)
	_, cookie := e.open(sh.ID, sh.Password)
	if r := e.observe(cookie, "GET", "/v1/desk"); r.status != http.StatusUnauthorized {
		t.Fatalf("an observer read the desk: %d %s", r.status, r.body)
	}
	// Written by the full token, read by the narrow one: the panes it may
	// not read are left out, the tree with them.
	expect(t, e.putDesk(full, deskTwo), http.StatusOK, "the desk")
	r = e.get(narrow, "/v1/desk")
	expect(t, r, http.StatusOK, "the narrow token's desk")
	if !strings.Contains(r.body, `"panes":["alice-laptop/work/0.0"]`) || strings.Contains(r.body, "0.1") || strings.Contains(r.body, "0.2") || strings.Contains(r.body, `"tree"`) {
		t.Fatalf("the narrow token's desk: %s", r.body)
	}
	// Six writes in a second: the sixth is not taken.
	var statuses []int
	for i := 0; i < 6; i++ {
		statuses = append(statuses, e.putDesk(full, deskTwo).status)
	}
	if statuses[5] != http.StatusTooManyRequests {
		t.Fatalf("desk writes: %v", statuses)
	}
	// The audit log counts, never a pane's content; the file is the hub's own.
	logs, _ := os.ReadFile(filepath.Join(e.logs, "hub.log"))
	if !strings.Contains(string(logs), "audit desk") || !strings.Contains(string(logs), "result=read_only") || !strings.Contains(string(logs), "result=not_yours") {
		t.Fatalf("hub audit:\n%s", logs)
	}
	if st, err := os.Stat(filepath.Join(e.hubDir, "hub.json")); err != nil || st.Mode().Perm() != 0o600 {
		t.Fatalf("hub.json: %v %v", st, err)
	}
}

func TestFlow197_DeskIsSharedTellsEveryClientAndSurvivesTheHub(t *testing.T) {
	e, ts, _ := basic(t)
	ts.split("work:0.0")
	ts.split("work:0.0")
	e.expose(ts, "work:0.1", "--write")
	e.expose(ts, "work:0.2", "--write")
	full := e.token("full", []string{host + "/*"}, []string{host + "/*"})
	other := e.token("phone", []string{host + "/*"}, []string{host + "/*"})
	// The other client's cursor before the write.
	before := e.get(other, "/v1/events?limit=1")
	expect(t, before, http.StatusOK, "events")
	cursor := before.body[strings.LastIndex(before.body, `"next":`)+len(`"next":`):]
	cursor = strings.TrimRight(cursor, "}\n ")
	r := e.putDesk(full, deskTwo)
	expect(t, r, http.StatusOK, "the desk written")
	if !strings.Contains(r.body, `"by":"full"`) || !strings.Contains(r.body, `"updated":`) {
		t.Fatalf("the answer: %s", r.body)
	}
	// Read back with the ETag.
	r = e.get(other, "/v1/desk")
	expect(t, r, http.StatusOK, "read")
	if !strings.Contains(r.body, `"focused":"alice-laptop/work/0.1"`) || !strings.Contains(r.body, `"minimised":["alice-laptop/work/0.2"]`) {
		t.Fatalf("read: %s", r.body)
	}
	etag := r.header.Get("ETag")
	if r := e.do("GET", other, "/v1/desk", "", "", "If-None-Match", etag); r.status != http.StatusNotModified {
		t.Fatalf("with the ETag: %d", r.status)
	}
	// The event reached the other client, with the updated time and no pane.
	ev := e.get(other, "/v1/events?after="+cursor+"&wait=2")
	expect(t, ev, http.StatusOK, "events after")
	if !strings.Contains(ev.body, `"kind":"desk"`) || strings.Contains(ev.body, `"address":"/`) {
		t.Fatalf("the desk event: %s", ev.body)
	}
	// The hub restarts: the desk is as it was.
	e.stopHub()
	e.startHub()
	e.waitOnline(host, true)
	if r := e.get(other, "/v1/desk"); !strings.Contains(r.body, `"focused":"alice-laptop/work/0.1"`) || r.header.Get("ETag") != etag {
		t.Fatalf("after the restart: %d %s (etag %s, was %s)", r.status, r.body, r.header.Get("ETag"), etag)
	}
	// The window view is a desk too.
	expect(t, e.putDesk(full, `{"view":"window","window":"alice-laptop/work/0","focused":"alice-laptop/work/0.2"}`), http.StatusOK, "a window desk")
	if r := e.get(full, "/v1/desk"); !strings.Contains(r.body, `"view":"window"`) || !strings.Contains(r.body, `"window":"alice-laptop/work/0"`) {
		t.Fatalf("the window desk: %s", r.body)
	}
}
