package wire

import (
	"bytes"
	"encoding/json"
	"net/http"
	"unicode/utf8"
)

// The files a client may hand a pane's program, by type, and the
// extension the agent names them with. The extension never comes from
// the client.
var FileTypes = map[string]string{
	"image/png":        "png",
	"image/jpeg":       "jpg",
	"image/gif":        "gif",
	"image/webp":       "webp",
	"application/pdf":  "pdf",
	"text/plain":       "txt",
	"text/markdown":    "md",
	"application/json": "json",
}

// ValidFile says whether data is what its type claims: a binary type must
// sniff as itself, a text type must be UTF-8 without control bytes but
// tab, newline and return, and JSON must parse.
func ValidFile(typ string, data []byte) bool {
	if _, ok := FileTypes[typ]; !ok || len(data) == 0 || len(data) > MaxFile {
		return false
	}
	switch typ {
	case "text/plain", "text/markdown", "application/json":
		if !utf8.Valid(data) || bytes.ContainsFunc(data, func(r rune) bool {
			return (r < 0x20 && r != '\t' && r != '\n' && r != '\r') || r == 0x7f
		}) {
			return false
		}
		return typ != "application/json" || json.Valid(data)
	}
	return http.DetectContentType(data) == typ
}
