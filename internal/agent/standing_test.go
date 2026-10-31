package agent

import "testing"

func TestParseExpose(t *testing.T) {
	good := map[string][2]string{
		"work=write":   {"work", "write"},
		"a.b-c_1=read": {"a.b-c_1", "read"},
	}
	for in, want := range good {
		name, mode, err := ParseExpose(in)
		if err != nil || name != want[0] || mode != want[1] {
			t.Errorf("%q: %q %q %v", in, name, mode, err)
		}
	}
	bad := []string{"", "work", "work=", "=write", "work=admin", "work=deny", "a;b=write", "../x=read",
		"work:0=write", "work=write=read", "a b=write", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=write"}
	for _, in := range bad {
		if _, _, err := ParseExpose(in); err == nil {
			t.Errorf("%q accepted", in)
		}
	}
}
