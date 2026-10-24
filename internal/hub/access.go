package hub

import (
	"errors"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"
)

// Address lists: who may reach the hub at all. The deny list wins; a
// non-empty allow list shuts out everyone not on it. The admin socket is
// not behind them, so the owner on the machine always gets back in.
const maxAccessEntries = 256

// Access is the hub's address lists as stored and as shown.
type Access struct {
	Allow []string `json:"allow"`
	Deny  []string `json:"deny"`
}

type accessLists struct {
	allow, deny []netip.Prefix
}

// parseAccess checks and normalises both lists; a bare address is a /32
// or a /128.
func parseAccess(a Access) (Access, accessLists, error) {
	var out Access
	var lists accessLists
	conv := func(in []string) ([]string, []netip.Prefix, error) {
		if len(in) > maxAccessEntries {
			return nil, nil, errors.New("at most 256 entries in a list")
		}
		strs, prefixes := []string{}, []netip.Prefix{}
		for _, s := range in {
			s = strings.TrimSpace(s)
			if s == "" {
				continue
			}
			var p netip.Prefix
			var err error
			if strings.Contains(s, "/") {
				p, err = netip.ParsePrefix(s)
			} else {
				var ad netip.Addr
				if ad, err = netip.ParseAddr(s); err == nil && ad.Zone() != "" {
					err = errors.New("zoned")
				}
				p = netip.PrefixFrom(ad, ad.BitLen())
			}
			if err != nil {
				return nil, nil, errors.New("not an address or CIDR: " + clip(s, 64))
			}
			p = netip.PrefixFrom(p.Addr().Unmap(), p.Bits()-unmapBits(p)).Masked()
			strs = append(strs, p.String())
			prefixes = append(prefixes, p)
		}
		return strs, prefixes, nil
	}
	var err error
	if out.Allow, lists.allow, err = conv(a.Allow); err != nil {
		return out, lists, err
	}
	if out.Deny, lists.deny, err = conv(a.Deny); err != nil {
		return out, lists, err
	}
	return out, lists, nil
}

// unmapBits is what an IPv4-mapped prefix loses when written as IPv4.
func unmapBits(p netip.Prefix) int {
	if p.Addr().Is4In6() && p.Bits() >= 96 {
		return 96
	}
	return 0
}

func clip(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// admits says whether an address may reach the hub under the lists.
func (l accessLists) admits(addr string) bool {
	if len(l.allow) == 0 && len(l.deny) == 0 {
		return true
	}
	ad, err := netip.ParseAddr(addr)
	if err != nil {
		return len(l.allow) == 0
	}
	ad = ad.Unmap()
	for _, p := range l.deny {
		if p.Contains(ad) {
			return false
		}
	}
	if len(l.allow) == 0 {
		return true
	}
	for _, p := range l.allow {
		if p.Contains(ad) {
			return true
		}
	}
	return false
}

func (st *Store) access() Access {
	st.mu.RLock()
	defer st.mu.RUnlock()
	return Access{Allow: append([]string{}, st.s.Access.Allow...), Deny: append([]string{}, st.s.Access.Deny...)}
}

func (st *Store) accessLists() accessLists {
	st.mu.RLock()
	defer st.mu.RUnlock()
	return st.lists
}

func (st *Store) setAccess(a Access, lists accessLists) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	st.s.Access, st.lists = a, lists
	return st.save()
}

// refusals keeps the hub's log to one line per refused address a minute.
type refusals struct {
	mu   sync.Mutex
	last map[string]time.Time
}

func (rf *refusals) shouldLog(addr string) bool {
	rf.mu.Lock()
	defer rf.mu.Unlock()
	now := time.Now()
	if rf.last == nil || len(rf.last) > 4096 {
		rf.last = map[string]time.Time{}
	}
	if now.Sub(rf.last[addr]) < time.Minute {
		return false
	}
	rf.last[addr] = now
	return true
}

// gate refuses an address the lists shut out before anything else looks
// at the request: sign-in, pairing and agents included.
func (h *Hub) gate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		addr := h.clientAddr(r)
		if !h.store.accessLists().admits(addr) {
			if h.refused.shouldLog(addr) {
				h.log.Warn("address refused", "addr", addr, "path", r.URL.Path)
			}
			fail(w, http.StatusForbidden, "forbidden")
			return
		}
		next.ServeHTTP(w, r)
	})
}
