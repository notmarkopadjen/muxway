package secure

import (
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"strings"
)

const codePrefix = "mxw1-"

// PairCode is what the hub owner hands to a new agent: where the hub is,
// the hub's public key to pin, and a one-time secret.
type PairCode struct {
	URL    string `json:"u"`
	HubKey string `json:"k"`
	Host   string `json:"h"`
	ID     string `json:"i"`
	Secret string `json:"s"`
}

func (c PairCode) String() string {
	raw, _ := json.Marshal(c)
	return codePrefix + b64.EncodeToString(raw)
}

// ParsePairCode reads a code printed by `muxway hub pair-code`.
func ParsePairCode(s string) (PairCode, error) {
	var c PairCode
	s = strings.TrimSpace(s)
	if !strings.HasPrefix(s, codePrefix) {
		return c, errors.New("not a muxway pairing code")
	}
	raw, err := b64.DecodeString(s[len(codePrefix):])
	if err != nil {
		return c, errors.New("not a muxway pairing code")
	}
	if err := json.Unmarshal(raw, &c); err != nil || c.URL == "" || c.ID == "" || c.Secret == "" || c.Host == "" {
		return c, errors.New("not a muxway pairing code")
	}
	if _, err := DecodePublic(c.HubKey); err != nil {
		return c, errors.New("not a muxway pairing code")
	}
	return c, nil
}

// PairProof shows the agent knows the code's secret, bound to its key.
func PairProof(secret, host string, agentPub ed25519.PublicKey) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("muxway-v1-pair\x00" + host + "\x00"))
	mac.Write(agentPub)
	return b64.EncodeToString(mac.Sum(nil))
}

// CheckPairProof compares in constant time.
func CheckPairProof(secret, host string, agentPub ed25519.PublicKey, proof string) bool {
	return hmac.Equal([]byte(PairProof(secret, host, agentPub)), []byte(proof))
}

func pairedMessage(host string, agentPub ed25519.PublicKey) []byte {
	return append([]byte("muxway-v1-paired\x00"+host+"\x00"), agentPub...)
}

// SignPaired is the hub's confirmation that it registered the agent.
func SignPaired(hub ed25519.PrivateKey, host string, agentPub ed25519.PublicKey) string {
	return b64.EncodeToString(ed25519.Sign(hub, pairedMessage(host, agentPub)))
}

// VerifyPaired checks the hub's confirmation against the pinned hub key.
func VerifyPaired(hubPub ed25519.PublicKey, host string, agentPub ed25519.PublicKey, sig string) bool {
	raw, err := b64.DecodeString(sig)
	return err == nil && ed25519.Verify(hubPub, pairedMessage(host, agentPub), raw)
}
