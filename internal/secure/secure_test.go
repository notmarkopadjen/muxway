package secure

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"testing"
	"time"
)

// pipe is an in-memory Conn pair.
type pipe struct{ in, out chan []byte }

func pipes() (pipe, pipe) {
	a, b := make(chan []byte, 8), make(chan []byte, 8)
	return pipe{in: a, out: b}, pipe{in: b, out: a}
}

func (p pipe) Read(ctx context.Context) ([]byte, error) {
	select {
	case m := <-p.in:
		return m, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (p pipe) Write(ctx context.Context, m []byte) error {
	p.out <- append([]byte{}, m...)
	return nil
}

func keys(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return pub, priv
}

func run(t *testing.T, hubKey ed25519.PrivateKey, pinned ed25519.PublicKey, agentKey ed25519.PrivateKey,
	registered ed25519.PublicKey) (*Session, *Session, error, error) {
	hp, ap := pipes()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	type res struct {
		s   *Session
		err error
	}
	hubDone := make(chan res, 1)
	go func() {
		_, s, err := HubHandshake(ctx, hp, hubKey, func(h string) (ed25519.PublicKey, bool) {
			return registered, h == "alice-laptop"
		})
		hubDone <- res{s, err}
	}()
	as, aerr := AgentHandshake(ctx, ap, agentKey, "alice-laptop", pinned)
	if aerr != nil {
		cancel()
	}
	h := <-hubDone
	return h.s, as, h.err, aerr
}

func TestHandshakeAndChannel(t *testing.T) {
	hubPub, hubKey := keys(t)
	agentPub, agentKey := keys(t)
	hs, as, herr, aerr := run(t, hubKey, hubPub, agentKey, agentPub)
	if herr != nil || aerr != nil {
		t.Fatalf("handshake: hub %v, agent %v", herr, aerr)
	}
	ctx := context.Background()
	for _, msg := range []string{"one", "two"} {
		if err := hs.Write(ctx, []byte(msg)); err != nil {
			t.Fatal(err)
		}
		got, err := as.Read(ctx)
		if err != nil || string(got) != msg {
			t.Fatalf("got %q, %v", got, err)
		}
	}
	as.Write(ctx, []byte("back"))
	if got, err := hs.Read(ctx); err != nil || string(got) != "back" {
		t.Fatalf("got %q, %v", got, err)
	}
}

func TestAgentWithWrongKeyIsRefused(t *testing.T) {
	hubPub, hubKey := keys(t)
	agentPub, _ := keys(t)
	_, otherKey := keys(t)
	_, _, herr, _ := run(t, hubKey, hubPub, otherKey, agentPub)
	if !errors.Is(herr, ErrHandshake) {
		t.Fatalf("hub accepted an agent with the wrong key: %v", herr)
	}
}

func TestAgentRefusesUnpinnedHub(t *testing.T) {
	hubPub, _ := keys(t)
	_, impostor := keys(t)
	agentPub, agentKey := keys(t)
	_, _, _, aerr := run(t, impostor, hubPub, agentKey, agentPub)
	if !errors.Is(aerr, ErrHandshake) {
		t.Fatalf("agent accepted a hub it did not pin: %v", aerr)
	}
}

func TestTamperedOrReplayedMessageFails(t *testing.T) {
	hubPub, hubKey := keys(t)
	agentPub, agentKey := keys(t)
	hs, as, _, _ := run(t, hubKey, hubPub, agentKey, agentPub)
	ctx := context.Background()
	// Capture a sealed message on the wire, deliver it twice.
	hp := hs.conn.(pipe)
	hs.Write(ctx, []byte("first"))
	sealed := <-hp.out
	hp.out <- sealed
	hp.out <- sealed
	if _, err := as.Read(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := as.Read(ctx); err == nil {
		t.Fatal("replayed message was accepted")
	}
	tampered := append([]byte{}, sealed...)
	tampered[len(tampered)-1] ^= 1
	hp.out <- tampered
	if _, err := as.Read(ctx); err == nil {
		t.Fatal("tampered message was accepted")
	}
}

func TestPairCodeAndProof(t *testing.T) {
	hubPub, hubKey := keys(t)
	agentPub, _ := keys(t)
	code := PairCode{URL: "https://hub.example.com", HubKey: EncodePublic(hubPub), Host: "alice-laptop", ID: "id1", Secret: Random(16)}
	parsed, err := ParsePairCode(code.String())
	if err != nil || parsed != code {
		t.Fatalf("round trip: %v %+v", err, parsed)
	}
	proof := PairProof(code.Secret, "alice-laptop", agentPub)
	if !CheckPairProof(code.Secret, "alice-laptop", agentPub, proof) {
		t.Fatal("valid proof refused")
	}
	if CheckPairProof(code.Secret, "bob-laptop", agentPub, proof) {
		t.Fatal("proof accepted for another host")
	}
	sig := SignPaired(hubKey, "alice-laptop", agentPub)
	if !VerifyPaired(hubPub, "alice-laptop", agentPub, sig) {
		t.Fatal("hub confirmation refused")
	}
	for _, bad := range []string{"", "mxw1-", "mxw1-!!", "hello"} {
		if _, err := ParsePairCode(bad); err == nil {
			t.Fatalf("parsed %q", bad)
		}
	}
}
