package wire

import (
	"bytes"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
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

// A file of the inbox is named by the agent: a stamp, six random
// characters and the extension of its type. A read asks for one by that
// name and nothing else, so no path ever comes from a client.
var fileName = regexp.MustCompile(`^[0-9]{8}-[0-9]{6}-[a-z0-9]{6}\.(png|jpg|gif|webp|pdf|txt|md|json)$`)

func ValidFileName(name string) bool {
	return fileName.MatchString(name)
}

// FileTypeOf is the type a file is served as, from its name's extension:
// the images and the PDF as themselves, every text as plain text, so
// nothing in a file is interpreted by whatever shows it.
func FileTypeOf(name string) string {
	if !ValidFileName(name) {
		return ""
	}
	ext := name[strings.LastIndexByte(name, '.')+1:]
	for typ, e := range FileTypes {
		if e == ext {
			if strings.HasPrefix(typ, "text/") || typ == "application/json" {
				return "text/plain; charset=utf-8"
			}
			return typ
		}
	}
	return ""
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
