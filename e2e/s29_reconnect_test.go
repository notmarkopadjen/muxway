//go:build e2e

package e2e

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The reconnect gap: an agent that held its connection comes straight
// back, and the hub waits a moment for an agent it just lost before it
// says host_offline.

func (e *env) agentLog(host string) string {
	raw, _ := os.ReadFile(filepath.Join(e.logs, "agent-"+host+".log"))
	return string(raw)
}

// 208
func TestFlow208_ARequestInTheGapWaitsForTheAgent(t *testing.T) {
	e, ts, a := basic(t)
	tok := e.token("reader", []string{host + "/*"}, nil)
	expect(t, e.get(tok, "/v1/panes/"+shell0), http.StatusOK, "before")
	// The agent goes away and the hub notices at once: the operator's
	// status does not wait.
	stop(a.cmd)
	e.waitOnline(host, false)
	// A request now waits; the agent is back within the grace, and the
	// request is answered by it, not with host_offline.
	done := make(chan resp, 1)
	start := time.Now()
	go func() { done <- e.get(tok, "/v1/panes/"+shell0) }()
	time.Sleep(300 * time.Millisecond)
	e.runAgent(a, ts)
	r := <-done
	expect(t, r, http.StatusOK, "in the gap")
	if took := time.Since(start); took > 3*time.Second {
		t.Fatalf("the request in the gap took %s", took.Round(time.Millisecond))
	}
	if !strings.Contains(e.getText(tok, "/v1/hosts").body, host+"\tonline") {
		t.Fatal("the host after the gap")
	}
	// A host that stays gone is offline once the grace has run out.
	stop(a.cmd)
	e.waitOnline(host, false)
	start = time.Now()
	expect(t, e.get(tok, "/v1/panes/"+shell0), http.StatusServiceUnavailable, "agent gone")
	if took := time.Since(start); took < 2*time.Second || took > 6*time.Second {
		t.Fatalf("the hub's patience lasted %s", took.Round(time.Millisecond))
	}
	start = time.Now()
	expect(t, e.get(tok, "/v1/panes/"+shell0), http.StatusServiceUnavailable, "agent still gone")
	if took := time.Since(start); took > time.Second {
		t.Fatalf("a host gone past the grace made a request wait %s", took.Round(time.Millisecond))
	}
}

// 209
func TestFlow209_AnAgentThatHeldItsConnectionRetriesAtOnce(t *testing.T) {
	e, _, _ := basic(t)
	tok := e.token("reader", []string{host + "/*"}, nil)
	// The connection has to have held; then the hub restarts under it.
	time.Sleep(5 * time.Second)
	e.stopHub()
	e.startHub()
	e.waitOnline(host, true)
	expect(t, e.get(tok, "/v1/panes/"+shell0), http.StatusOK, "after the hub restart")
	log := e.agentLog(host)
	if !strings.Contains(log, "retry_in=0s") {
		t.Fatalf("the agent waited after losing a held connection:\n%s", log)
	}
	if strings.Contains(log, "failed authentication") {
		t.Fatalf("a frame failed to open:\n%s", log)
	}
}
