package hub

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/notmarkopadjen/muxway/internal/secure"
)

// AgentRecord is a paired agent.
type AgentRecord struct {
	Key    string    `json:"key"`
	Paired time.Time `json:"paired"`
}

// Token is a client credential. Only the hash of its secret is kept.
type Token struct {
	ID      string    `json:"id"`
	Name    string    `json:"name"`
	Hash    string    `json:"hash"`
	Read    []string  `json:"read"`
	Write   []string  `json:"write,omitempty"`
	Created time.Time `json:"created"`
	Expires time.Time `json:"expires"`
}

type stateFile struct {
	Agents map[string]AgentRecord `json:"agents"`
	Tokens []Token                `json:"tokens"`
}

// Store is the hub's state on disk: one JSON file, replaced atomically.
type Store struct {
	path string
	mu   sync.RWMutex
	s    stateFile
}

func openStore(dir string) (*Store, error) {
	st := &Store{path: filepath.Join(dir, "hub.json"), s: stateFile{Agents: map[string]AgentRecord{}}}
	raw, err := os.ReadFile(st.path)
	if errors.Is(err, os.ErrNotExist) {
		return st, st.save()
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &st.s); err != nil {
		return nil, err
	}
	if st.s.Agents == nil {
		st.s.Agents = map[string]AgentRecord{}
	}
	return st, nil
}

func (st *Store) save() error {
	raw, _ := json.MarshalIndent(st.s, "", "  ")
	tmp := st.path + ".tmp"
	if err := os.WriteFile(tmp, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, st.path)
}

func (st *Store) agentKey(host string) (ed25519.PublicKey, bool) {
	st.mu.RLock()
	defer st.mu.RUnlock()
	rec, ok := st.s.Agents[host]
	if !ok {
		return nil, false
	}
	pub, err := secure.DecodePublic(rec.Key)
	return pub, err == nil
}

func (st *Store) addAgent(host string, pub ed25519.PublicKey) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	st.s.Agents[host] = AgentRecord{Key: secure.EncodePublic(pub), Paired: time.Now().UTC()}
	return st.save()
}

func (st *Store) removeAgent(host string) (bool, error) {
	st.mu.Lock()
	defer st.mu.Unlock()
	if _, ok := st.s.Agents[host]; !ok {
		return false, nil
	}
	delete(st.s.Agents, host)
	return true, st.save()
}

func (st *Store) agents() []string {
	st.mu.RLock()
	defer st.mu.RUnlock()
	var out []string
	for h := range st.s.Agents {
		out = append(out, h)
	}
	sort.Strings(out)
	return out
}

func hashToken(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

// createToken returns the secret, shown once, and the stored record.
func (st *Store) createToken(name string, read, write []string, ttl time.Duration) (string, Token, error) {
	secret := "mxt_" + secure.Random(32)
	h := hashToken(secret)
	now := time.Now().UTC()
	t := Token{ID: h[:8], Name: name, Hash: h, Read: read, Write: write, Created: now, Expires: now.Add(ttl)}
	st.mu.Lock()
	defer st.mu.Unlock()
	st.s.Tokens = append(st.s.Tokens, t)
	return secret, t, st.save()
}

// lookupToken finds a valid, unexpired token by its secret.
func (st *Store) lookupToken(secret string) (Token, bool) {
	h := hashToken(secret)
	st.mu.RLock()
	defer st.mu.RUnlock()
	for _, t := range st.s.Tokens {
		if t.Hash == h {
			return t, time.Now().Before(t.Expires)
		}
	}
	return Token{}, false
}

func (st *Store) tokens() []Token {
	st.mu.RLock()
	defer st.mu.RUnlock()
	return append([]Token{}, st.s.Tokens...)
}

func (st *Store) revokeToken(id string) (bool, error) {
	st.mu.Lock()
	defer st.mu.Unlock()
	for i, t := range st.s.Tokens {
		if t.ID == id {
			st.s.Tokens = append(st.s.Tokens[:i], st.s.Tokens[i+1:]...)
			return true, st.save()
		}
	}
	return false, nil
}
