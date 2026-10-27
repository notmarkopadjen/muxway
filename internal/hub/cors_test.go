package hub

import "testing"

func TestPeerOrigin(t *testing.T) {
	good := map[string]string{
		"https://work.example.com":      "https://work.example.com",
		"https://Work.example.com:8443": "https://work.example.com:8443",
		" https://work.example.com/ ":   "https://work.example.com",
		"http://localhost:7600":         "http://localhost:7600",
		"http://127.0.0.1:7600":         "http://127.0.0.1:7600",
	}
	for in, want := range good {
		got, err := PeerOrigin(in)
		if err != nil || got != want {
			t.Errorf("%q: got %q, %v; want %q", in, got, err, want)
		}
	}
	for _, in := range []string{
		"http://work.example.com", "work.example.com", "https://work.example.com/panes",
		"https://work.example.com/?x=1", "https://work.example.com/#f", "https://alice:pw@work.example.com",
		"javascript:alert(1)", "https://", "",
	} {
		if got, err := PeerOrigin(in); err == nil {
			t.Errorf("%q: taken as %q", in, got)
		}
	}
}
