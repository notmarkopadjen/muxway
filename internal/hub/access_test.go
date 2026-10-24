package hub

import "testing"

func TestParseAccess(t *testing.T) {
	a, lists, err := parseAccess(Access{Allow: []string{"198.51.100.7/24", " 2001:db8::1 ", "::ffff:192.0.2.1"}, Deny: []string{"198.51.100.9"}})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"198.51.100.0/24", "2001:db8::1/128", "192.0.2.1/32"}
	for i, s := range want {
		if a.Allow[i] != s {
			t.Fatalf("allow[%d] = %q, want %q", i, a.Allow[i], s)
		}
	}
	for addr, ok := range map[string]bool{"198.51.100.1": true, "198.51.100.9": false, "192.0.2.1": true,
		"::ffff:198.51.100.2": true, "192.0.2.2": false, "2001:db8::1": true, "not-an-ip": false} {
		if lists.admits(addr) != ok {
			t.Errorf("admits(%s) = %v", addr, !ok)
		}
	}
	for _, bad := range []string{"198.51.100.0/33", "fe80::1%eth0", "hub.example.com", "1.2.3"} {
		if _, _, err := parseAccess(Access{Deny: []string{bad}}); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
	if !(accessLists{}).admits("anything") {
		t.Error("empty lists refuse")
	}
	_, deny, _ := parseAccess(Access{Deny: []string{"203.0.113.0/24"}})
	if !deny.admits("not-an-ip") || deny.admits("203.0.113.9") {
		t.Error("deny-only lists")
	}
}
