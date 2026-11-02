package mcp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/notmarkopadjen/muxway/internal/client"
)

// A stand-in hub: a token, two panes, one question, an input log.
func fakeHub(t *testing.T) (*httptest.Server, *[]string) {
	var writes []string
	mux := http.NewServeMux()
	auth := func(r *http.Request) bool { return r.Header.Get("Authorization") == "Bearer mxt_test" }
	mux.HandleFunc("/v1/panes", func(w http.ResponseWriter, r *http.Request) {
		if !auth(r) {
			http.Error(w, `{"error":"unauthorized"}`, 401)
			return
		}
		if strings.HasPrefix(r.Header.Get("Accept"), "text/plain") {
			w.Write([]byte("alice-laptop/work/0.0\twrite\tbash\tbuild\t\nalice-laptop/work/1.0\tread\tclaude\t✳ x\tquestion\n"))
			return
		}
		w.Write([]byte(`{"panes":[]}`))
	})
	mux.HandleFunc("/v1/events", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"events":[],"next":7}`))
	})
	mux.HandleFunc("/v1/inbox", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"inbox":[{"host":"alice-laptop","address":"alice-laptop/work/1.0","pane_id":"%3","mode":"write","command":"claude","title":"x",
			"attention":{"kind":"question","at":1767225600,"text":"deploy?","choices":["yes","no"]}}],"count":1}`))
	})
	mux.HandleFunc("/v1/panes/alice-laptop/work/0.0", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("$ make test\nok\n"))
	})
	mux.HandleFunc("/v1/panes/alice-laptop/work/0.0/input", func(w http.ResponseWriter, r *http.Request) {
		var b bytes.Buffer
		b.ReadFrom(r.Body)
		writes = append(writes, b.String())
		w.WriteHeader(204)
	})
	mux.HandleFunc("/v1/panes/alice-laptop/work/1.0/answer", func(w http.ResponseWriter, r *http.Request) {
		var b bytes.Buffer
		b.ReadFrom(r.Body)
		writes = append(writes, "answer:"+b.String())
		w.WriteHeader(204)
	})
	mux.HandleFunc("/v1/panes/alice-laptop/work/2.0/input", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"read_only"}`, 403)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { http.Error(w, `{"error":"not_found"}`, 404) })
	return httptest.NewServer(mux), &writes
}

func TestServer(t *testing.T) {
	srv, writes := fakeHub(t)
	defer srv.Close()
	c, err := client.New(srv.URL, "mxt_test", "")
	if err != nil {
		t.Fatal(err)
	}
	in := strings.Join([]string{
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}`,
		`{"jsonrpc":"2.0","method":"notifications/initialized"}`,
		`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`,
		`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_panes","arguments":{}}}`,
		`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"inbox"}}`,
		`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"read_pane","arguments":{"address":"alice-laptop/work/0.0","lines":10}}}`,
		`{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"send_text","arguments":{"address":"alice-laptop/work/0.0","text":"make test","enter":true}}}`,
		`{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"answer","arguments":{"address":"alice-laptop/work/1.0","choice":"yes"}}}`,
		`{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"send_key","arguments":{"address":"alice-laptop/work/2.0","key":"C-c"}}}`,
		`{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"explode","arguments":{}}}`,
		`{"jsonrpc":"2.0","id":10,"method":"resources/list"}`,
		`{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"wait","arguments":{"address":"alice-laptop/work/1.0","timeout_seconds":5}}}`,
		`{"jsonrpc":"2.0","id":12,"method":"ping"}`,
		`not json`,
	}, "\n") + "\n"
	var out bytes.Buffer
	s := &Server{Client: c, Name: "muxway"}
	if err := s.Serve(context.Background(), strings.NewReader(in), &out); err != nil {
		t.Fatal(err)
	}
	var responses []map[string]any
	sc := bufio.NewScanner(&out)
	for sc.Scan() {
		var v map[string]any
		if err := json.Unmarshal(sc.Bytes(), &v); err != nil {
			t.Fatalf("not JSON: %s", sc.Text())
		}
		responses = append(responses, v)
	}
	if len(responses) != 13 {
		t.Fatalf("%d responses (the notification gets none, the garbage one):\n%s", len(responses), out.String())
	}
	byID := map[float64]map[string]any{}
	for _, r := range responses {
		if id, ok := r["id"].(float64); ok {
			byID[id] = r
		}
	}
	result := func(id float64) map[string]any {
		r, _ := byID[id]["result"].(map[string]any)
		return r
	}
	text := func(id float64) string {
		cs, _ := result(id)["content"].([]any)
		if len(cs) == 0 {
			return ""
		}
		c, _ := cs[0].(map[string]any)
		s, _ := c["text"].(string)
		return s
	}
	if result(1)["protocolVersion"] != "2025-06-18" {
		t.Errorf("initialize: %v", byID[1])
	}
	if tools, _ := result(2)["tools"].([]any); len(tools) != len(Tools) {
		t.Errorf("tools/list: %v", byID[2])
	}
	if !strings.Contains(text(3), "alice-laptop/work/0.0\twrite") {
		t.Errorf("list_panes: %q", text(3))
	}
	if !strings.Contains(text(4), "choices: yes | no") {
		t.Errorf("inbox: %q", text(4))
	}
	if !strings.Contains(text(5), "make test") {
		t.Errorf("read_pane: %q", text(5))
	}
	if text(6) != "sent" || text(7) != "answered" {
		t.Errorf("send_text %q, answer %q", text(6), text(7))
	}
	if result(8)["isError"] != true || !strings.Contains(text(8), "read_only") {
		t.Errorf("a refused write is a tool error: %v", byID[8])
	}
	if e, _ := byID[9]["error"].(map[string]any); e == nil || e["code"].(float64) != -32602 {
		t.Errorf("unknown tool: %v", byID[9])
	}
	if e, _ := byID[10]["error"].(map[string]any); e == nil || e["code"].(float64) != -32601 {
		t.Errorf("unknown method: %v", byID[10])
	}
	if !strings.Contains(text(11), "question\tdeploy?\tchoices: yes | no") {
		t.Errorf("wait: %q", text(11))
	}
	if r := result(12); r == nil {
		t.Errorf("ping: %v", byID[12])
	}
	want := []string{`{"text":"make test"}`, `{"key":"Enter"}`, `answer:{"choice":"yes"}`}
	if strings.Join(*writes, ";") != strings.Join(want, ";") {
		t.Errorf("writes: %q", *writes)
	}
	if strings.Contains(out.String(), "mxt_test") {
		t.Error("the token is in the output")
	}
}
