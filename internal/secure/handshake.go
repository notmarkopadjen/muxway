package secure

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ed25519"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
)

// Conn is a message transport, such as a WebSocket.
type Conn interface {
	Read(ctx context.Context) ([]byte, error)
	Write(ctx context.Context, msg []byte) error
}

// ErrHandshake hides why a handshake failed from the other side.
var ErrHandshake = errors.New("handshake failed")

type hello struct {
	Version int    `json:"v"`
	Nonce   string `json:"nonce"`
	Eph     string `json:"eph"`
}

type agentAuth struct {
	Host  string `json:"host"`
	Nonce string `json:"nonce"`
	Eph   string `json:"eph"`
	Sig   string `json:"sig"`
}

type hubAuth struct {
	Sig string `json:"sig"`
}

// transcript binds both nonces, both ephemeral keys and the host alias, so
// a signature is valid for exactly one handshake.
func transcript(role, host string, hubNonce, hubEph, agentNonce, agentEph []byte) []byte {
	h := sha256.New()
	h.Write([]byte("muxway-v1-" + role + "\x00" + host + "\x00"))
	for _, part := range [][]byte{hubNonce, hubEph, agentNonce, agentEph} {
		var n [4]byte
		binary.BigEndian.PutUint32(n[:], uint32(len(part)))
		h.Write(n[:])
		h.Write(part)
	}
	return h.Sum(nil)
}

func readJSON(ctx context.Context, c Conn, v any) error {
	raw, err := c.Read(ctx)
	if err != nil {
		return err
	}
	if len(raw) > 4096 {
		return ErrHandshake
	}
	if err := json.Unmarshal(raw, v); err != nil {
		return ErrHandshake
	}
	return nil
}

func writeJSON(ctx context.Context, c Conn, v any) error {
	raw, _ := json.Marshal(v)
	return c.Write(ctx, raw)
}

func decode32(s string) ([]byte, bool) {
	raw, err := b64.DecodeString(s)
	return raw, err == nil && len(raw) == 32
}

// HubHandshake runs the hub's side. lookup returns the registered key of
// an agent alias. It returns the authenticated alias and the session.
func HubHandshake(ctx context.Context, c Conn, hub ed25519.PrivateKey,
	lookup func(host string) (ed25519.PublicKey, bool)) (string, *Session, error) {
	eph, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return "", nil, err
	}
	hubNonce := make([]byte, 32)
	rand.Read(hubNonce)
	hubEph := eph.PublicKey().Bytes()
	if err := writeJSON(ctx, c, hello{1, b64.EncodeToString(hubNonce), b64.EncodeToString(hubEph)}); err != nil {
		return "", nil, err
	}
	var a agentAuth
	if err := readJSON(ctx, c, &a); err != nil {
		return "", nil, err
	}
	agentNonce, ok1 := decode32(a.Nonce)
	agentEph, ok2 := decode32(a.Eph)
	sig, err := b64.DecodeString(a.Sig)
	pub, known := lookup(a.Host)
	if !ok1 || !ok2 || err != nil || !known ||
		!ed25519.Verify(pub, transcript("agent", a.Host, hubNonce, hubEph, agentNonce, agentEph), sig) {
		return "", nil, ErrHandshake
	}
	mine := ed25519.Sign(hub, transcript("hub", a.Host, hubNonce, hubEph, agentNonce, agentEph))
	if err := writeJSON(ctx, c, hubAuth{b64.EncodeToString(mine)}); err != nil {
		return "", nil, err
	}
	s, err := newSession(c, eph, agentEph, hubNonce, agentNonce, "hub")
	return a.Host, s, err
}

// AgentHandshake runs the agent's side against the pinned hub key.
func AgentHandshake(ctx context.Context, c Conn, agent ed25519.PrivateKey, host string,
	hubPub ed25519.PublicKey) (*Session, error) {
	var h hello
	if err := readJSON(ctx, c, &h); err != nil {
		return nil, err
	}
	hubNonce, ok1 := decode32(h.Nonce)
	hubEph, ok2 := decode32(h.Eph)
	if h.Version != 1 || !ok1 || !ok2 {
		return nil, ErrHandshake
	}
	eph, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	agentNonce := make([]byte, 32)
	rand.Read(agentNonce)
	agentEph := eph.PublicKey().Bytes()
	sig := ed25519.Sign(agent, transcript("agent", host, hubNonce, hubEph, agentNonce, agentEph))
	if err := writeJSON(ctx, c, agentAuth{host, b64.EncodeToString(agentNonce),
		b64.EncodeToString(agentEph), b64.EncodeToString(sig)}); err != nil {
		return nil, err
	}
	var r hubAuth
	if err := readJSON(ctx, c, &r); err != nil {
		return nil, err
	}
	hubSig, err := b64.DecodeString(r.Sig)
	if err != nil || !ed25519.Verify(hubPub, transcript("hub", host, hubNonce, hubEph, agentNonce, agentEph), hubSig) {
		return nil, fmt.Errorf("%w: the hub did not prove the pinned key", ErrHandshake)
	}
	return newSession(c, eph, hubEph, hubNonce, agentNonce, "agent")
}

// Session encrypts every message after the handshake with AES-256-GCM, one
// key per direction, and an implicit counter as nonce: a dropped, repeated
// or reordered message fails to open.
type Session struct {
	conn         Conn
	send, recv   cipher.AEAD
	sendMu       sync.Mutex
	sendN, recvN uint64
}

func newSession(c Conn, eph *ecdh.PrivateKey, peerEph, hubNonce, agentNonce []byte, role string) (*Session, error) {
	peer, err := ecdh.X25519().NewPublicKey(peerEph)
	if err != nil {
		return nil, ErrHandshake
	}
	shared, err := eph.ECDH(peer)
	if err != nil {
		return nil, ErrHandshake
	}
	salt := append(append([]byte{}, hubNonce...), agentNonce...)
	key := func(info string) (cipher.AEAD, error) {
		k, err := hkdf.Key(sha256.New, shared, salt, info, 32)
		if err != nil {
			return nil, err
		}
		block, err := aes.NewCipher(k)
		if err != nil {
			return nil, err
		}
		return cipher.NewGCM(block)
	}
	h2a, err := key("muxway-v1 hub to agent")
	if err != nil {
		return nil, err
	}
	a2h, err := key("muxway-v1 agent to hub")
	if err != nil {
		return nil, err
	}
	s := &Session{conn: c, send: h2a, recv: a2h}
	if role == "agent" {
		s.send, s.recv = a2h, h2a
	}
	return s, nil
}

func nonce(n uint64) []byte {
	b := make([]byte, 12)
	binary.BigEndian.PutUint64(b[4:], n)
	return b
}

// Write seals and sends one message. Safe for concurrent use.
func (s *Session) Write(ctx context.Context, msg []byte) error {
	s.sendMu.Lock()
	defer s.sendMu.Unlock()
	sealed := s.send.Seal(nil, nonce(s.sendN), msg, nil)
	s.sendN++
	return s.conn.Write(ctx, sealed)
}

// Read receives and opens one message. Not for concurrent use.
func (s *Session) Read(ctx context.Context) ([]byte, error) {
	sealed, err := s.conn.Read(ctx)
	if err != nil {
		return nil, err
	}
	msg, err := s.recv.Open(nil, nonce(s.recvN), sealed, nil)
	if err != nil {
		return nil, errors.New("message failed authentication")
	}
	s.recvN++
	return msg, nil
}
