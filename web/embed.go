// Package web holds the browser client, built by Vite into dist/ and
// embedded in the hub binary. dist/ is committed and checked in CI, so
// `go install` needs no Node.
package web

import (
	"embed"
	"io/fs"
)

//go:embed dist
var dist embed.FS

// Files is the built client with dist/ as its root.
func Files() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err)
	}
	return sub
}
