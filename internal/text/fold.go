package text

import (
	"strings"
	"unicode/utf8"
)

// The charsets text mode can answer in.
const (
	UTF8   = "utf-8"
	Latin1 = "latin1"
	ASCII  = "ascii"
)

// Charset tells whether a client's charset parameter is one of ours.
func Charset(s string) bool {
	return s == UTF8 || s == Latin1 || s == ASCII
}

// ContentType names the charset the way HTTP does.
func ContentType(charset string) string {
	switch charset {
	case Latin1:
		return "text/plain; charset=iso-8859-1"
	case ASCII:
		return "text/plain; charset=us-ascii"
	}
	return "text/plain; charset=utf-8"
}

// Base letters of U+00C0..U+00FF and U+0100..U+017F; ? marks the ones the
// map below spells with two letters.
const (
	latin1Letters = "AAAAAA?CEEEEIIIIDNOOOOOxOUUUUY??aaaaaa?ceeeeiiiidnooooo/ouuuuy?y"
	extendedA     = "AaAaAaCcCcCcCcDdDdEeEeEeEeEeGgGgGgGgHhHhIiIiIiIiIi??JjKkkLlLlLlLlLlNnNnNnnNnOoOoOo??RrRrRrSsSsSsSsTtTtTtUuUuUuUuUuUuWwYyYZzZzZzs"
)

var symbols = map[rune]string{
	'\u00c6': "AE", '\u00de': "Th", '\u00df': "ss", '\u00e6': "ae", '\u00fe': "th",
	'\u0132': "IJ", '\u0133': "ij", '\u0152': "OE", '\u0153': "oe",
	'\u00a0': " ", '\u00ab': "<", '\u00bb': ">", '\u00b7': ".",
	'\u2018': "'", '\u2019': "'", '\u201a': "'", '\u201c': "\"", '\u201d': "\"", '\u201e': "\"",
	'\u2010': "-", '\u2011': "-", '\u2012': "-", '\u2013': "-", '\u2014': "-", '\u2015': "-", '\u2212': "-",
	'\u2022': "*", '\u2026': "...", '\u2039': "<", '\u203a': ">",
	'\u2190': "<", '\u2191': "^", '\u2192': ">", '\u2193': "v", '\u21d0': "<", '\u21d2': ">",
	'\u23f5': ">", '\u23fa': "*",
	'\u25a0': "*", '\u25a1': "*", '\u25aa': "*", '\u25ab': "*", '\u25b6': ">", '\u25b8': ">", '\u25ba': ">",
	'\u25c0': "<", '\u25c2': "<", '\u25c6': "*", '\u25c7': "*", '\u25cb': "*", '\u25cf': "*", '\u25e6': "*", '\u25c9': "*",
	'\u2605': "*", '\u2606': "*", '\u2611': "v", '\u2612': "x",
	'\u26a0': "!", '\u2713': "v", '\u2714': "v", '\u2716': "x", '\u2717': "x", '\u2718': "x", '\u276f': ">", '\u279c': ">",
	'\u2b22': "*", '\u2b21': "*", '\u25fc': "*", '\u25fb': "*",
}

// Box drawing, U+2500..U+257F: which are horizontal and which vertical;
// everything else there is a corner, a tee or a cross.
const (
	horizontal = "\u2500\u2501\u2504\u2505\u2508\u2509\u254c\u254d\u2574\u2576\u2578\u257a\u257c\u257e"
	vertical   = "\u2502\u2503\u2506\u2507\u250a\u250b\u254e\u254f\u2551\u2575\u2577\u2579\u257b\u257d\u257f"
)

// fold returns what one rune becomes outside UTF-8, or "" to keep it.
func fold(r rune, charset string) string {
	if r < 0x80 || (charset == Latin1 && r > 0xa0 && r < 0x100) {
		return ""
	}
	if s, ok := symbols[r]; ok {
		return s
	}
	switch {
	case r < 0xa0:
		return "?"
	case r < 0xc0:
		return "?"
	case r < 0x100:
		return string(latin1Letters[r-0xc0])
	case r < 0x180:
		return string(extendedA[r-0x100])
	case r >= 0x2500 && r < 0x2580:
		switch {
		case r == '\u2550':
			return "="
		case strings.ContainsRune(horizontal, r):
			return "-"
		case strings.ContainsRune(vertical, r):
			return "|"
		case r == '\u2571':
			return "/"
		case r == '\u2572':
			return "\\"
		case r == '\u2573':
			return "X"
		}
		return "+"
	case r >= 0x2580 && r < 0x25a0:
		return "#"
	case r >= 0x2800 && r < 0x2900:
		return "*"
	}
	return "?"
}

// Fold rewrites s for a client that reads Latin-1 or ASCII: lines and
// symbols as ASCII art, letters without the marks the charset lacks, and
// ? for the rest. UTF-8 is returned as it is.
func Fold(s, charset string) string {
	if charset != Latin1 && charset != ASCII {
		return s
	}
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if r == utf8.RuneError {
			b.WriteByte('?')
		} else if f := fold(r, charset); f == "" {
			b.WriteRune(r)
		} else {
			b.WriteString(f)
		}
	}
	return b.String()
}

// Encode gives the bytes of a folded string in its charset.
func Encode(s, charset string) []byte {
	if charset != Latin1 {
		return []byte(s)
	}
	out := make([]byte, 0, len(s))
	for _, r := range s {
		if r > 0xff {
			r = '?'
		}
		out = append(out, byte(r))
	}
	return out
}
