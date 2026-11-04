package hub

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/notmarkopadjen/muxway/internal/wire"
)

func TestSharePasswords(t *testing.T) {
	pw := newPassword()
	if !regexp.MustCompile(`^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}$`).MatchString(pw) {
		t.Fatalf("generated password %q", pw)
	}
	if newPassword() == pw {
		t.Fatal("two passwords alike")
	}
	for _, s := range []string{"short", "", "has\tcontrol", strings.Repeat("a", 65)} {
		if validPassword(s) {
			t.Fatalf("%q taken", s)
		}
	}
	for _, s := range []string{pw, "eightchr", "pässwörd ok", strings.Repeat("a", 64)} {
		if !validPassword(s) {
			t.Fatalf("%q refused", s)
		}
	}
	sh := Share{Salt: "00112233445566778899aabbccddeeff"}
	sh.Hash = hashPassword("k7mv-3qzp-wd8n", sh.Salt)
	if !sh.passwordIs("k7mv-3qzp-wd8n") || sh.passwordIs("k7mv-3qzp-wd8m") || sh.passwordIs("") {
		t.Fatal("the check does not follow the hash")
	}
	if hashPassword("x", sh.Salt) == hashPassword("x", "ffeeddccbbaa99887766554433221100") {
		t.Fatal("the salt plays no part")
	}
}

func TestShareStoreExpiry(t *testing.T) {
	st, err := openStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	st.addShare(Share{ID: "a", Expires: now.Add(time.Hour)})
	st.addShare(Share{ID: "b", Expires: now.Add(-time.Minute)})
	if _, ok := st.shareByID("b"); ok {
		t.Fatal("an expired share found")
	}
	if _, ok := st.shareByID("a"); !ok {
		t.Fatal("a live share not found")
	}
	gone := st.dropExpiredShares()
	if len(gone) != 1 || gone[0].ID != "b" || len(st.shares()) != 1 {
		t.Fatalf("expired %v, left %d", gone, len(st.shares()))
	}
	again, err := openStore(filepath.Dir(st.path))
	if err != nil || len(again.shares()) != 1 {
		t.Fatalf("not kept on disk: %v %d", err, len(again.shares()))
	}
}

func showingBody(t *testing.T, meta string, typ string, data []byte) (*http.Request, *httptest.ResponseRecorder) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	if meta != "" {
		p, _ := mw.CreateFormField("meta")
		p.Write([]byte(meta))
	}
	if typ != "" {
		h := make(map[string][]string)
		h["Content-Disposition"] = []string{`form-data; name="file"; filename="f"`}
		h["Content-Type"] = []string{typ}
		p, _ := mw.CreatePart(h)
		p.Write(data)
	}
	mw.Close()
	r := httptest.NewRequest("PUT", "/v1/share/x/showing", &buf)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	return r, httptest.NewRecorder()
}

func TestValidChanges(t *testing.T) {
	ok := wire.Changes{Root: "/home/alice/work", Branch: "main", Entries: []wire.Change{{Path: "a.go", Kind: "modified"}, {Path: "b", From: "c", Kind: "renamed"}, {Path: "quo\"te\n\t.txt", Kind: "untracked"}}}
	if !validChanges(ok) {
		t.Fatal("a listing as the agent gives it")
	}
	bad := []wire.Changes{
		{Root: "", Branch: "main"},
		{Root: "/w", Branch: "ma\x01in"},
		{Root: "/w", Branch: "main", Ahead: -1},
		{Root: "/w", Branch: "main", Entries: []wire.Change{{Path: "a", Kind: "edited"}}},
		{Root: "/w", Branch: "main", Entries: []wire.Change{{Path: "", Kind: "added"}}},
		{Root: "/w", Branch: "main", Entries: []wire.Change{{Path: "a", From: "b\x7f", Kind: "renamed"}}},
		{Root: "/w", Branch: "main", Entries: make([]wire.Change, wire.MaxChanges+1)},
	}
	for i, c := range bad {
		if validChanges(c) {
			t.Fatalf("bad %d taken", i)
		}
	}
}

func TestReadShowing(t *testing.T) {
	good := `{"kind":"diff","path":"src/a.go","view":"diff"}`
	cases := []struct {
		name, meta, typ string
		data            []byte
		code            string
		wantData        bool
	}{
		{"meta alone", good, "", nil, "", false},
		{"text", good, "text/plain", []byte("hello\n"), "", true},
		{"png", good, "image/png", []byte("\x89PNG\r\n\x1a\n" + strings.Repeat("\x00", 16)), "", true},
		{"html", good, "text/html", []byte("<b>"), "bad_input", false},
		{"not a png", good, "image/png", []byte("MZ"), "bad_input", false},
		{"control bytes", good, "text/plain", []byte("a\x00b"), "bad_input", false},
		{"bad kind", `{"kind":"shell","path":"a","view":"diff"}`, "", nil, "bad_input", false},
		{"bad view", `{"kind":"file","path":"a","view":"raw"}`, "", nil, "bad_input", false},
		{"control path", "{\"kind\":\"file\",\"path\":\"a\\nb\",\"view\":\"plain\"}", "", nil, "bad_input", false},
		{"extra key", `{"kind":"file","path":"a","view":"plain","x":1}`, "", nil, "bad_input", false},
		{"no meta", "", "text/plain", []byte("x"), "bad_input", false},
	}
	for _, c := range cases {
		r, w := showingBody(t, c.meta, c.typ, c.data)
		meta, typ, data, code := readShowing(w, r)
		if code != c.code {
			t.Fatalf("%s: code %q, want %q", c.name, code, c.code)
		}
		if c.code == "" && (meta.Kind == "" || (c.wantData && (typ != c.typ || !bytes.Equal(data, c.data))) || (!c.wantData && data != nil)) {
			t.Fatalf("%s: meta %+v type %q data %d", c.name, meta, typ, len(data))
		}
	}
	r, w := showingBody(t, good, "text/plain", bytes.Repeat([]byte("a"), 9<<20))
	if _, _, _, code := readShowing(w, r); code != "too_large" {
		t.Fatalf("9 MiB: %q", code)
	}
}
