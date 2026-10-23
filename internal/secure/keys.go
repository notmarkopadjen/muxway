// Package secure holds muxway's identities, pairing codes, the handshake
// between hub and agent, and the encrypted channel that follows it.
package secure

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"strings"
)

var b64 = base64.RawURLEncoding

// LoadOrCreateKey reads an Ed25519 private key from path, or creates one
// there (mode 0600) when the file does not exist.
func LoadOrCreateKey(path string) (ed25519.PrivateKey, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		_, priv, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return nil, err
		}
		data := []byte(b64.EncodeToString(priv.Seed()) + "\n")
		f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err != nil {
			return nil, err
		}
		if _, err := f.Write(data); err != nil {
			f.Close()
			return nil, err
		}
		return priv, f.Close()
	}
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.Mode().Perm()&0o077 != 0 {
		return nil, fmt.Errorf("%s is readable by others; chmod 600 it", path)
	}
	seed, err := b64.DecodeString(strings.TrimSpace(string(raw)))
	if err != nil || len(seed) != ed25519.SeedSize {
		return nil, fmt.Errorf("%s is not a muxway key", path)
	}
	return ed25519.NewKeyFromSeed(seed), nil
}

// EncodePublic is the text form of a public key used in codes and configs.
func EncodePublic(pub ed25519.PublicKey) string {
	return b64.EncodeToString(pub)
}

// DecodePublic parses EncodePublic's output.
func DecodePublic(s string) (ed25519.PublicKey, error) {
	raw, err := b64.DecodeString(s)
	if err != nil || len(raw) != ed25519.PublicKeySize {
		return nil, errors.New("not a public key")
	}
	return ed25519.PublicKey(raw), nil
}

// Random returns n random bytes encoded for URLs.
func Random(n int) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	return b64.EncodeToString(buf)
}
