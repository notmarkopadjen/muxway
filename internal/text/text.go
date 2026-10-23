// Package text renders pane content for small clients: no escape
// sequences, trailing blanks trimmed, rewrapped to a given width.
package text

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// CSI, OSC (ended by BEL or ST), and two-byte escapes.
var escapes = regexp.MustCompile(`\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-Z\\-_]`)

// Strip removes terminal escape sequences and other control characters
// except newlines.
func Strip(s string) string {
	s = escapes.ReplaceAllString(s, "")
	return strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' {
			return r
		}
		if r < 0x20 || r == 0x7f || (r >= 0x80 && r <= 0x9f) {
			return -1
		}
		return r
	}, s)
}

// Wrap breaks each line at width runes, keeping empty lines, and returns
// the last `last` lines of the result (all when last <= 0).
func Wrap(s string, width, last int) []string {
	var out []string
	for _, line := range strings.Split(Strip(s), "\n") {
		line = strings.TrimRight(strings.ReplaceAll(line, "\t", "    "), " ")
		if line == "" {
			out = append(out, "")
			continue
		}
		for utf8.RuneCountInString(line) > width {
			cut := 0
			for range width {
				_, size := utf8.DecodeRuneInString(line[cut:])
				cut += size
			}
			out = append(out, line[:cut])
			line = line[cut:]
		}
		out = append(out, line)
	}
	for len(out) > 0 && out[len(out)-1] == "" {
		out = out[:len(out)-1]
	}
	if last > 0 && len(out) > last {
		out = out[len(out)-last:]
	}
	return out
}
