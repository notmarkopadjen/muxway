// Package auth holds the ways a person can sign in to a hub besides
// pasting a token. A provider sends the browser away to prove who it is
// and hands back a verified identity; the hub decides what that identity
// may do.
package auth

import (
	"errors"
	"net/http"
)

// Identity is what a provider vouches for.
type Identity struct {
	Issuer  string
	Subject string
	Email   string
	Name    string
}

// Provider is one way to sign in. Name is its path segment under
// /v1/auth/, Label what a client shows on the button.
type Provider interface {
	Name() string
	Label() string
	// Start sends the browser to the provider. An error means the provider
	// could not be reached; the hub answers for it.
	Start(w http.ResponseWriter, r *http.Request) error
	// Finish handles the browser's return and verifies the result.
	Finish(w http.ResponseWriter, r *http.Request) (Identity, error)
}

// ProviderError marks a failure on the provider's side rather than a
// refused sign-in, so the hub can answer 502 instead of 401.
type ProviderError struct{ Err error }

func (e *ProviderError) Error() string { return "provider: " + e.Err.Error() }
func (e *ProviderError) Unwrap() error { return e.Err }

var errRefused = errors.New("sign-in refused")
