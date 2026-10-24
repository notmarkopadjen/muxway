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
	clipRate     = 0.2 // spoken clips per second: one every five seconds
	clipBurst    = 1
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

// take refills the bucket at rate per second up to burst and takes one.
func (b *bucket) take(rate, burst float64) bool {
	now := time.Now()
	if b.at.IsZero() {
		b.tokens = burst
	}
	b.tokens = min(burst, b.tokens+now.Sub(b.at).Seconds()*rate)
	b.at = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
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
	b, ok := l.buckets[tokenID]
	if !ok {
		b = &bucket{}
		l.buckets[tokenID] = b
	}
	return b.take(tokenRate, tokenBurst)
}

// allowClip takes one spoken clip from the token's own, slower bucket.
func (l *limiter) allowClip(tokenID string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	b, ok := l.buckets["clip:"+tokenID]
	if !ok {
		b = &bucket{}
		l.buckets["clip:"+tokenID] = b
	}
	return b.take(clipRate, clipBurst)
}
