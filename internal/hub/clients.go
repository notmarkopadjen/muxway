package hub

import (
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Clients that use a bearer token have no session; the hub remembers the
// last time each token was used from each address and kind of client, so
// admins see them next to the signed-in browsers.
const (
	bearerKeep = time.Hour
	bearerMax  = 256
)

var clientWord = regexp.MustCompile(`^[A-Za-z0-9._-]{1,32}`)

// clientType is what the client says it is: the client header, or the
// first word of its User-Agent.
func clientType(r *http.Request) string {
	for _, s := range []string{r.Header.Get(clientHeader), r.Header.Get("User-Agent")} {
		if w := clientWord.FindString(strings.TrimSpace(s)); w != "" {
			return strings.ToLower(w)
		}
	}
	return "unknown"
}

type bearerUse struct {
	Token  string
	Client string
	Addr   string
	First  time.Time
	Seen   time.Time
}

type bearerClients struct {
	mu sync.Mutex
	m  map[[3]string]*bearerUse
}

func (b *bearerClients) touch(token, client, addr string) {
	key := [3]string{token, client, addr}
	now := time.Now()
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.m == nil {
		b.m = map[[3]string]*bearerUse{}
	}
	if u, ok := b.m[key]; ok {
		u.Seen = now
		return
	}
	if len(b.m) >= bearerMax {
		b.prune(now)
	}
	if len(b.m) >= bearerMax {
		var oldest [3]string
		var at time.Time
		for k, u := range b.m {
			if at.IsZero() || u.Seen.Before(at) {
				oldest, at = k, u.Seen
			}
		}
		delete(b.m, oldest)
	}
	b.m[key] = &bearerUse{Token: token, Client: client, Addr: addr, First: now, Seen: now}
}

func (b *bearerClients) prune(now time.Time) {
	for k, u := range b.m {
		if now.Sub(u.Seen) > bearerKeep {
			delete(b.m, k)
		}
	}
}

func (b *bearerClients) list() []bearerUse {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.prune(time.Now())
	var out []bearerUse
	for _, u := range b.m {
		out = append(out, *u)
	}
	return out
}

// forget drops a revoked token's entries.
func (b *bearerClients) forget(token string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for k := range b.m {
		if k[0] == token {
			delete(b.m, k)
		}
	}
}
