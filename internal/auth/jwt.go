package auth

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"
)

// Just enough JWT to verify an ID token: RS256 and ES256 against the
// provider's JWKS, then the claims OpenID Connect requires checked.

type keySet struct {
	keys map[string]crypto.PublicKey // by kid
}

type jwk struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Use string `json:"use"`
	N   string `json:"n"`
	E   string `json:"e"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
}

func parseJWKS(raw []byte) (*keySet, error) {
	var in struct {
		Keys []jwk `json:"keys"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return nil, err
	}
	ks := &keySet{keys: map[string]crypto.PublicKey{}}
	for _, k := range in.Keys {
		if k.Use != "" && k.Use != "sig" {
			continue
		}
		switch k.Kty {
		case "RSA":
			n, err1 := b64.DecodeString(k.N)
			e, err2 := b64.DecodeString(k.E)
			if err1 != nil || err2 != nil || len(n) < 256 || len(e) == 0 || len(e) > 4 {
				continue
			}
			ks.keys[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}
		case "EC":
			if k.Crv != "P-256" {
				continue
			}
			x, err1 := b64.DecodeString(k.X)
			y, err2 := b64.DecodeString(k.Y)
			if err1 != nil || err2 != nil {
				continue
			}
			pub := &ecdsa.PublicKey{Curve: elliptic.P256(), X: new(big.Int).SetBytes(x), Y: new(big.Int).SetBytes(y)}
			if !pub.Curve.IsOnCurve(pub.X, pub.Y) {
				continue
			}
			ks.keys[k.Kid] = pub
		}
	}
	return ks, nil
}

// key returns the signing key for kid, refreshing the set once when the
// kid is new and the last fetch is more than a minute old.
func (o *OIDC) key(ctx context.Context, kid string) (crypto.PublicKey, error) {
	o.mu.Lock()
	ks, at := o.keys, o.keysAt
	o.mu.Unlock()
	if ks != nil {
		if k, ok := ks.keys[kid]; ok {
			return k, nil
		}
		if time.Since(at) < time.Minute {
			return nil, errors.New("unknown signing key")
		}
	}
	d, err := o.discover(ctx)
	if err != nil {
		return nil, &ProviderError{err}
	}
	var raw json.RawMessage
	if err := o.getJSON(ctx, d.JWKSURL, &raw); err != nil {
		return nil, &ProviderError{err}
	}
	ks, err = parseJWKS(raw)
	if err != nil {
		return nil, &ProviderError{err}
	}
	o.mu.Lock()
	o.keys, o.keysAt = ks, time.Now()
	o.mu.Unlock()
	k, ok := ks.keys[kid]
	if !ok {
		return nil, errors.New("unknown signing key")
	}
	return k, nil
}

func (o *OIDC) verifyIDToken(ctx context.Context, raw, nonce string) (map[string]any, error) {
	parts := strings.Split(raw, ".")
	if len(parts) != 3 {
		return nil, errors.New("malformed id token")
	}
	headRaw, err1 := b64.DecodeString(parts[0])
	bodyRaw, err2 := b64.DecodeString(parts[1])
	sig, err3 := b64.DecodeString(parts[2])
	if err1 != nil || err2 != nil || err3 != nil {
		return nil, errors.New("malformed id token")
	}
	var head struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if json.Unmarshal(headRaw, &head) != nil {
		return nil, errors.New("malformed id token header")
	}
	key, err := o.key(ctx, head.Kid)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	switch head.Alg {
	case "RS256":
		pub, ok := key.(*rsa.PublicKey)
		if !ok || rsa.VerifyPKCS1v15(pub, crypto.SHA256, sum[:], sig) != nil {
			return nil, errors.New("bad signature")
		}
	case "ES256":
		pub, ok := key.(*ecdsa.PublicKey)
		if !ok || len(sig) != 64 {
			return nil, errors.New("bad signature")
		}
		r, s := new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])
		if !ecdsa.Verify(pub, sum[:], r, s) {
			return nil, errors.New("bad signature")
		}
	default:
		return nil, fmt.Errorf("algorithm %q not accepted", head.Alg)
	}
	var claims map[string]any
	if json.Unmarshal(bodyRaw, &claims) != nil {
		return nil, errors.New("malformed claims")
	}
	if iss, _ := claims["iss"].(string); iss != o.cfg.Issuer {
		return nil, errors.New("issuer mismatch")
	}
	if !hasAudience(claims["aud"], o.cfg.ClientID) {
		return nil, errors.New("audience mismatch")
	}
	now := time.Now()
	exp, ok := number(claims["exp"])
	if !ok || now.After(time.Unix(exp, 0).Add(o.cfg.Skew)) {
		return nil, errors.New("expired")
	}
	if iat, ok := number(claims["iat"]); !ok || time.Unix(iat, 0).After(now.Add(o.cfg.Skew)) {
		return nil, errors.New("issued in the future")
	}
	if got, _ := claims["nonce"].(string); got == "" || got != nonce {
		return nil, errors.New("nonce mismatch")
	}
	return claims, nil
}

func hasAudience(aud any, clientID string) bool {
	switch v := aud.(type) {
	case string:
		return v == clientID
	case []any:
		for _, a := range v {
			if s, _ := a.(string); s == clientID {
				return true
			}
		}
	}
	return false
}

func number(v any) (int64, bool) {
	f, ok := v.(float64)
	if !ok || f < 0 || f > 1<<53 {
		return 0, false
	}
	return int64(f), true
}
