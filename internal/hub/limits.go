package hub

import (
	"sync"
	"time"
)

// Failed authentications per client address, and request rates per token.
const (
	failWindow   = 10 * time.Minute
	failLimit    = 10
	lockout      = 10 * time.Minute
	tokenRate    = 20 // requests per second
	tokenBurst   = 40
	pairAttempts = 3
)

type limiter struct {
	mu      sync.Mutex
	fails   map[string][]time.Time
	locked  map[string]time.Time
	buckets map[string]*bucket
}

type bucket struct {
	tokens float64
	at     time.Time
}

func newLimiter() *limiter {
	return &limiter{fails: map[string][]time.Time{}, locked: map[string]time.Time{}, buckets: map[string]*bucket{}}
}

func (l *limiter) isLocked(addr string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	until, ok := l.locked[addr]
	if ok && time.Now().Before(until) {
		return true
	}
	delete(l.locked, addr)
	return false
}

// fail records a failed authentication and locks the address out after
// failLimit failures within failWindow.
func (l *limiter) fail(addr string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	recent := l.fails[addr][:0]
	for _, t := range l.fails[addr] {
		if now.Sub(t) < failWindow {
			recent = append(recent, t)
		}
	}
	recent = append(recent, now)
	l.fails[addr] = recent
	if len(recent) >= failLimit {
		l.locked[addr] = now.Add(lockout)
		delete(l.fails, addr)
	}
}

// allow takes one request from the token's bucket.
func (l *limiter) allow(tokenID string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	b, ok := l.buckets[tokenID]
	if !ok {
		b = &bucket{tokens: tokenBurst, at: now}
		l.buckets[tokenID] = b
	}
	b.tokens = min(tokenBurst, b.tokens+now.Sub(b.at).Seconds()*tokenRate)
	b.at = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}
