package wire

import (
	"strings"
	"testing"
)

func TestValidChoices(t *testing.T) {
	good := [][]string{
		{"yes", "no"},
		{"PostgreSQL", "SQLite", "something else"},
		{"a", "b", "c", "d", "e", "f", "g", "h"},
		{strings.Repeat("x", 40), "y"},
		{"oui", "non, merci", "¿qué?"},
	}
	for _, cs := range good {
		if !ValidChoices(cs) {
			t.Errorf("%q refused", cs)
		}
	}
	bad := [][]string{
		nil,
		{},
		{"yes"},
		{"a", "b", "c", "d", "e", "f", "g", "h", "i"},
		{strings.Repeat("x", 41), "y"},
		{"", "y"},
		{"yes", "yes"},
		{"a|b", "c"},
		{"a\tb", "c"},
		{"a\x1b[2J", "c"},
		{" lead", "c"},
	}
	for _, cs := range bad {
		if ValidChoices(cs) {
			t.Errorf("%q accepted", cs)
		}
	}
}
