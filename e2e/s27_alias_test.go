//go:build e2e

package e2e

import (
	"bytes"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A pane's name from a client: the alias, set over the hub by a writer.

func (e *env) rename(tok, address, alias string) resp {
	return e.post(tok, "/v1/panes/"+address+"/alias", fmt.Sprintf(`{"alias":%q}`, alias))
}

// 188
func TestSec188_RenameNeedsTheWriteGrantAndAFreeName(t *testing.T) {
	e, ts, _ := basic(t)
	// Each split of the first pane lands at index 1 and pushes the rest along.
	ts.split("work:0.0")
	ts.split("work:0.0")
	e.expose(ts, "work:0.1", "--write", "--name", "build")
	e.expose(ts, "work:0.2") // read-only
	full := e.token("full", []string{"*"}, []string{"*"})
	reader := e.token("reader", []string{"*"}, nil)
	other := e.token("other", []string{host + "/*"}, []string{host + "/work/0.1"})
	if !strings.Contains(e.get(full, "/v1/hosts").body, `"rename":true`) {
		t.Fatal("the host does not say it renames")
	}

	expect(t, e.rename("", shell0, "review"), http.StatusUnauthorized, "no token")
	expect(t, e.rename(reader, shell0, "review"), http.StatusForbidden, "a read-only token")
	expect(t, e.rename(other, shell0, "review"), http.StatusForbidden, "a write grant elsewhere")
	expect(t, e.rename(full, host+"/work/0.2", "review"), http.StatusForbidden, "a read-only pane")
	expect(t, e.rename(full, host+"/work/0.9", "review"), http.StatusNotFound, "no such pane")
	for _, bad := range []string{"Review", "a b", "a_b", strings.Repeat("a", 33), "../x", "$(id)", "a\x00b", "ü"} {
		expect(t, e.rename(full, shell0, bad), http.StatusBadRequest, "alias "+fmt.Sprintf("%q", bad))
	}
	expect(t, e.post(full, "/v1/panes/"+shell0+"/alias", `{"alias":"x","text":"y"}`), http.StatusBadRequest, "an extra field")
	expect(t, e.post(full, "/v1/panes/"+shell0+"/alias", `{"alias":"x"} junk`), http.StatusBadRequest, "trailing junk")
	expect(t, e.rename(full, shell0, "build"), http.StatusConflict, "a name another pane has")
	if strings.Contains(e.get(full, "/v1/panes").body, `"alias":"review"`) {
		t.Fatal("a refused rename named the pane")
	}
	if got := strings.TrimSpace(ts.must("show-options", "-pqv", "-t", "work:0.0", "@muxway-alias")); got != "" {
		t.Fatalf("a refused rename reached tmux: %q", got)
	}

	// The right one: the pane comes back named, and the name is an address.
	r := e.rename(full, shell0, "review")
	expect(t, r, http.StatusOK, "rename")
	if !strings.Contains(r.body, `"alias":"review"`) || !strings.Contains(r.body, `"address":"`+shell0+`"`) {
		t.Fatalf("rename answer: %s", r.body)
	}
	expect(t, e.get(full, "/v1/panes/"+host+"/@review"), http.StatusOK, "the new alias as an address")
	expect(t, e.rename(full, host+"/@review", "review"), http.StatusOK, "the same name again")
	// A pane keeps its own name while another is renamed to a free one,
	// and an empty name takes it away.
	expect(t, e.rename(other, host+"/@build", "builder"), http.StatusOK, "the other pane renames its own")
	expect(t, e.get(full, "/v1/panes/"+host+"/@build"), http.StatusNotFound, "the old alias")
	expect(t, e.rename(full, host+"/@builder", ""), http.StatusOK, "unname")
	expect(t, e.get(full, "/v1/panes/"+host+"/@builder"), http.StatusNotFound, "an unnamed pane")
	// Now the freed name may be taken.
	expect(t, e.rename(full, shell0, "build"), http.StatusOK, "a freed name")
	tr := e.do("POST", full, "/v1/panes/"+shell0+"/alias", "text/plain", `{"alias":"review"}`)
	expect(t, tr, http.StatusOK, "text mode")
	if tr.body != shell0+"\treview\n" {
		t.Fatalf("text answer: %q", tr.body)
	}

	// The audit lines carry who, the pane and the names, never a token.
	agentLog, _ := os.ReadFile(filepath.Join(e.logs, "agent-"+host+".log"))
	hubLog, _ := os.ReadFile(filepath.Join(e.logs, "hub.log"))
	if !bytes.Contains(agentLog, []byte("op=alias")) || !bytes.Contains(agentLog, []byte("alias=review")) || !bytes.Contains(agentLog, []byte("was=build")) {
		t.Fatal("the agent's audit log lacks the rename")
	}
	if !bytes.Contains(hubLog, []byte("audit alias")) {
		t.Fatal("the hub's audit log lacks the rename")
	}
	for _, tok := range []string{full, reader, other} {
		if bytes.Contains(agentLog, []byte(tok)) || bytes.Contains(hubLog, []byte(tok)) {
			t.Fatal("a token is in a log")
		}
	}
}

// 189: the folder of every program, under a root, for a writer.
func TestSec189_TheFolderShowsForEveryProgramUnderARoot(t *testing.T) {
	e := newEnv(t)
	ts := newTmux(t)
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "project"), 0o755)
	a := e.pairAgent(host, ts, "--preview", root)
	_ = a
	ts.split("work:0.0")
	e.expose(ts, "work", "--write")
	full := e.token("full", []string{"*"}, []string{"*"})
	reader := e.token("reader", []string{"*"}, nil)
	// A long-running program that is not a shell, in the project.
	ts.must("send-keys", "-t", "work:0.0", "cd "+filepath.Join(root, "project")+" && sleep 300", "Enter")
	// A shell outside the roots.
	ts.must("send-keys", "-t", "work:0.1", "cd /", "Enter")
	waitFor(t, "the program's folder", func() bool {
		return strings.Contains(e.get(full, "/v1/panes/"+shell0).body, `"cwd":"`+filepath.Join(root, "project")+`"`)
	})
	if strings.Contains(e.get(reader, "/v1/panes/"+shell0).body, `"cwd"`) {
		t.Fatal("a reader sees the folder")
	}
	if strings.Contains(e.get(full, "/v1/panes/"+host+"/work/0.1").body, `"cwd"`) {
		t.Fatal("a folder outside the roots is shown")
	}
}
