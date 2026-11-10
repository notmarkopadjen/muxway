//go:build e2e

package e2e

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Who holds a window's size: every pane of a window a muxway fit sized
// carries sized_by (the fitter's token name, its client label, when,
// and whether the reader sent it), cleared by a release; the label is
// checked by the hub and never looked up; the fitter's id is never
// given out. docs/plans/2026-11-09-size-holder.md.

type sizedBy struct {
	Token  string `json:"token"`
	Client string `json:"client"`
	At     int64  `json:"at"`
	Mine   bool   `json:"mine"`
	Actor  string `json:"actor"`
}

func holderOf(t *testing.T, body string) *sizedBy {
	t.Helper()
	var v struct {
		Pane struct {
			SizedBy *sizedBy `json:"sized_by"`
		} `json:"pane"`
	}
	if err := json.Unmarshal([]byte(body), &v); err != nil {
		t.Fatalf("answer: %s", body)
	}
	return v.Pane.SizedBy
}

func listedHolders(t *testing.T, body string) map[string]*sizedBy {
	t.Helper()
	var v struct {
		Panes []struct {
			Address string   `json:"address"`
			SizedBy *sizedBy `json:"sized_by"`
		} `json:"panes"`
	}
	if err := json.Unmarshal([]byte(body), &v); err != nil {
		t.Fatalf("listing: %s", body)
	}
	out := map[string]*sizedBy{}
	for _, p := range v.Panes {
		out[p.Address] = p.SizedBy
	}
	return out
}

// 226
func TestSec226_AReaderSeesTheHolderByNameNeverById(t *testing.T) {
	e, _, _ := basic(t)
	writer := e.token("phone", []string{host + "/*"}, []string{host + "/*"})
	reader := e.token("viewer", []string{host + "/*"}, nil)
	expect(t, e.resize(writer, shell0, `{"cols":120,"rows":30,"scope":"window","client":"Pixel 9"}`), http.StatusOK, "writer's fit")
	// A reader's resize is refused, label or not.
	expect(t, e.resize(reader, shell0, `{"cols":100,"rows":30,"client":"Chrome"}`), http.StatusForbidden, "reader's resize")
	r := e.get(reader, "/v1/panes/"+shell0)
	expect(t, r, http.StatusOK, "reader's read")
	h := holderOf(t, r.body)
	if h == nil || h.Token != "phone" || h.Client != "Pixel 9" || h.Mine || h.At == 0 {
		t.Fatalf("reader sees %+v in %s", h, r.body)
	}
	if h.Actor != "" || strings.Contains(r.body, `"actor"`) {
		t.Fatalf("the fitter's id went out: %s", r.body)
	}
	// Token ids are 32 hex characters; none appears in any pane answer.
	for _, body := range []string{r.body, e.get(writer, "/v1/panes").body} {
		for _, w := range strings.FieldsFunc(body, func(c rune) bool { return c == '"' || c == ',' || c == ' ' }) {
			if len(w) == 32 && strings.Trim(w, "0123456789abcdef") == "" {
				t.Fatalf("a 32-hex word in a pane answer: %s", body)
			}
		}
	}
}

// 227
func TestSec227_TheClientLabelIsBoundedPrintableAndSetsNoHolderWhenRefused(t *testing.T) {
	e, ts, _ := basic(t)
	tok := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	before := ts.windowSize("work:0")
	for _, c := range []string{
		`"` + strings.Repeat("x", 33) + `"`,
		`"tab\there"`,
		`"bell\u0007"`,
		`" padded"`,
		`12`,
	} {
		r := e.resize(tok, shell0, `{"cols":120,"rows":30,"client":`+c+`}`)
		if r.status != http.StatusBadRequest {
			t.Fatalf("label %s: %d %s", c, r.status, r.body)
		}
		if !strings.Contains(r.body, "bad_parameter") && !strings.Contains(r.body, "bad_json") {
			t.Fatalf("label %s: %s", c, r.body)
		}
	}
	if got := ts.windowSize("work:0"); got != before {
		t.Fatalf("a refused label resized the window: %s", got)
	}
	r := e.get(tok, "/v1/panes/"+shell0)
	if holderOf(t, r.body) != nil {
		t.Fatalf("a refused label set a holder: %s", r.body)
	}
	// Thirty-two characters, letters of any script, pass.
	r = e.resize(tok, shell0, `{"cols":120,"rows":30,"client":"`+strings.Repeat("é", 32)+`"}`)
	expect(t, r, http.StatusOK, "a 32-rune label")
	if h := holderOf(t, r.body); h == nil || h.Client != strings.Repeat("é", 32) {
		t.Fatalf("the label came back as %+v", h)
	}
	time.Sleep(1100 * time.Millisecond)
	// An empty label is an absent one: the client's kind from its headers stands in.
	r = e.resize(tok, shell0, `{"cols":121,"rows":30,"client":""}`)
	expect(t, r, http.StatusOK, "an empty label")
	if h := holderOf(t, r.body); h == nil || h.Client == "" || strings.ContainsAny(h.Client, " \t") {
		t.Fatalf("an empty label gave %+v", h)
	}
}

// 228
func TestSec228_TheLabelComesBackAsTextAndIsNotInterpreted(t *testing.T) {
	e, _, _ := basic(t)
	tok := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	label := `<b>&"x"</b> ${y}`
	body, _ := json.Marshal(map[string]any{"cols": 120, "rows": 30, "client": label})
	r := e.resize(tok, shell0, string(body))
	expect(t, r, http.StatusOK, "markup label")
	h := holderOf(t, r.body)
	if h == nil || h.Client != label {
		t.Fatalf("label came back as %+v", h)
	}
	if strings.Contains(r.body, "<b>") {
		t.Fatalf("markup unescaped in JSON: %s", r.body)
	}
	// The text listing is unchanged by a holder: no new column, no markup.
	text := e.getText(tok, "/v1/panes")
	expect(t, text, http.StatusOK, "text listing")
	if strings.Contains(text.body, "<b>") || strings.Contains(text.body, "writer") {
		t.Fatalf("the label or the holder leaked into text mode: %s", text.body)
	}
}

// 229
func TestSec229_RefitsStayUnderTheWindowsBucket(t *testing.T) {
	e, _, _ := basic(t)
	tok := e.token("writer", []string{host + "/*"}, []string{host + "/*"})
	ok, limited := 0, 0
	for i := 0; i < 8; i++ {
		r := e.resize(tok, shell0, `{"cols":`+itoa(100+i)+`,"rows":30,"scope":"window","client":"Chrome"}`)
		switch r.status {
		case http.StatusOK:
			ok++
		case http.StatusTooManyRequests:
			limited++
		default:
			t.Fatalf("resize %d: %d %s", i, r.status, r.body)
		}
	}
	if ok > 5 || limited == 0 {
		t.Fatalf("eight resizes with labels: %d taken, %d limited", ok, limited)
	}
}

func itoa(n int) string {
	b, _ := json.Marshal(n)
	return string(b)
}

// 227
func TestFlow227_TheHolderIsOnEveryPaneOfTheWindowAndGoesWithARelease(t *testing.T) {
	e, ts, _ := basic(t)
	ts.split("work:0.0")
	e.expose(ts, "work", "--write")
	a := e.token("phone", []string{host + "/*"}, []string{host + "/*"})
	b := e.token("web", []string{host + "/*"}, []string{host + "/*"})
	// Never fitted: no holder anywhere.
	for addr, h := range listedHolders(t, e.get(a, "/v1/panes").body) {
		if h != nil {
			t.Fatalf("%s has a holder before any fit: %+v", addr, h)
		}
	}
	// A's window fit: A sees mine, B does not, on both panes of the window.
	r := e.resize(a, shell0, `{"cols":120,"rows":30,"scope":"window","client":"Pixel 9"}`)
	expect(t, r, http.StatusOK, "A's fit")
	if h := holderOf(t, r.body); h == nil || !h.Mine || h.Token != "phone" || h.Client != "Pixel 9" {
		t.Fatalf("A's answer: %+v", h)
	}
	for who, tok := range map[string]string{"A": a, "B": b} {
		hs := listedHolders(t, e.get(tok, "/v1/panes").body)
		for _, addr := range []string{host + "/work/0.0", host + "/work/0.1"} {
			h := hs[addr]
			if h == nil || h.Token != "phone" || h.Client != "Pixel 9" || h.Mine != (who == "A") {
				t.Fatalf("%s sees %s as %+v", who, addr, h)
			}
		}
	}
	time.Sleep(1100 * time.Millisecond)
	// B's pane fit takes the hold; the label falls back to the client header's kind.
	r = e.do("POST", b, "/v1/panes/"+shell0+"/resize", "", `{"cols":110,"rows":28}`, "X-Muxway-Client", "web")
	expect(t, r, http.StatusOK, "B's fit")
	if h := holderOf(t, r.body); h == nil || !h.Mine || h.Token != "web" || h.Client != "web" {
		t.Fatalf("B's answer: %+v", h)
	}
	if h := holderOf(t, e.get(a, "/v1/panes/"+shell0).body); h == nil || h.Mine || h.Token != "web" {
		t.Fatalf("A now sees %+v", h)
	}
	// An arrangement alone leaves the holder; a release clears it.
	layout := ts.layout("work:0")
	r = e.resize(b, shell0, `{"scope":"window","layout":"`+layout+`"}`)
	expect(t, r, http.StatusOK, "arrange")
	if h := holderOf(t, e.get(b, "/v1/panes/"+shell0).body); h == nil || h.Token != "web" {
		t.Fatalf("an arrangement changed the holder: %+v", h)
	}
	expect(t, e.resize(b, shell0, `{"fit":"auto"}`), http.StatusOK, "release")
	for addr, h := range listedHolders(t, e.get(a, "/v1/panes").body) {
		if strings.HasPrefix(addr, host+"/work/0.") && h != nil {
			t.Fatalf("%s still has a holder after the release: %+v", addr, h)
		}
	}
	// Both audit lines carry the label.
	hub, _ := os.ReadFile(filepath.Join(e.logs, "hub.log"))
	if !strings.Contains(string(hub), `client="Pixel 9"`) && !strings.Contains(string(hub), `client=Pixel 9`) {
		t.Fatalf("hub audit without the label:\n%s", hub)
	}
	agent, _ := os.ReadFile(filepath.Join(e.logs, "agent-"+host+".log"))
	if !strings.Contains(string(agent), "Pixel 9") {
		t.Fatalf("agent audit without the label:\n%s", agent)
	}
}
