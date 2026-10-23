package hub

import (
	"errors"
	"regexp"
	"strconv"
	"strings"

	"github.com/notmarkopadjen/muxway/internal/tmux"
)

// A grant pattern is host/session/window.pane with * matching any run of
// characters within a segment. Missing trailing segments mean "all":
// "alice-laptop" and "alice-laptop/*" are the whole host. host/@alias is
// the one pane with that alias.
type pattern struct {
	host, session, window, pane string
	alias                       string
}

var hostName = regexp.MustCompile(`^[a-z0-9-]{1,32}$`)

func parsePattern(s string) (pattern, error) {
	p := pattern{host: "*", session: "*", window: "*", pane: "*"}
	parts := strings.SplitN(s, "/", 3)
	if parts[0] == "" {
		return p, errors.New("empty pattern")
	}
	p.host = parts[0]
	if len(parts) == 2 && strings.HasPrefix(parts[1], "@") {
		p.alias = parts[1][1:]
		if !hostName.MatchString(p.alias) {
			return p, errors.New("bad alias in pattern " + s)
		}
		return p, nil
	}
	if len(parts) > 1 {
		p.session = parts[1]
	}
	if len(parts) > 2 {
		wp := parts[2]
		if i := strings.LastIndex(wp, "."); i >= 0 {
			p.window, p.pane = wp[:i], wp[i+1:]
		} else {
			p.window = wp
		}
	}
	for _, seg := range []string{p.host, p.session, p.window, p.pane} {
		if seg == "" || strings.ContainsAny(seg, "/") {
			return p, errors.New("bad pattern " + s)
		}
	}
	return p, nil
}

// glob matches * against any run of characters; nothing else is special.
func glob(pat, s string) bool {
	parts := strings.Split(pat, "*")
	if len(parts) == 1 {
		return pat == s
	}
	if !strings.HasPrefix(s, parts[0]) {
		return false
	}
	s = s[len(parts[0]):]
	for _, mid := range parts[1 : len(parts)-1] {
		i := strings.Index(s, mid)
		if i < 0 {
			return false
		}
		s = s[i+len(mid):]
	}
	return strings.HasSuffix(s, parts[len(parts)-1])
}

func (p pattern) matchesHost(host string) bool { return glob(p.host, host) }

func (p pattern) matches(host string, pane tmux.Pane) bool {
	if p.alias != "" {
		return glob(p.host, host) && pane.Alias == p.alias
	}
	return glob(p.host, host) && glob(p.session, pane.SessionName) &&
		(glob(p.window, strconv.Itoa(pane.WindowIndex)) || glob(p.window, pane.WindowName)) &&
		glob(p.pane, strconv.Itoa(pane.PaneIndex))
}

func anyMatch(patterns []string, f func(pattern) bool) bool {
	for _, s := range patterns {
		if p, err := parsePattern(s); err == nil && f(p) {
			return true
		}
	}
	return false
}

func (t Token) canSeeHost(host string) bool {
	return anyMatch(t.Read, func(p pattern) bool { return p.matchesHost(host) })
}

func (t Token) canRead(host string, pane tmux.Pane) bool {
	return anyMatch(t.Read, func(p pattern) bool { return p.matches(host, pane) })
}

// canWrite needs a write grant as well as a read grant.
func (t Token) canWrite(host string, pane tmux.Pane) bool {
	return t.canRead(host, pane) && anyMatch(t.Write, func(p pattern) bool { return p.matches(host, pane) })
}

func validPatterns(list []string) error {
	for _, s := range list {
		if _, err := parsePattern(s); err != nil {
			return err
		}
	}
	return nil
}
