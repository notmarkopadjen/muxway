package wire

import (
	"bytes"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"
)

// The types the inbox knows, and the extension the agent names each
// with. A known type is checked against its bytes; any other file is
// kept as it came, under the extension the client's name ends in.
var FileTypes = map[string]string{
	"image/png":        "png",
	"image/jpeg":       "jpg",
	"image/gif":        "gif",
	"image/webp":       "webp",
	"application/pdf":  "pdf",
	"text/plain":       "txt",
	"text/markdown":    "md",
	"application/json": "json",
	// An archive is kept as it is: nothing in it is ever unpacked here.
	"application/zip": "zip",
}

// Bytes is the type of a file the inbox keeps without looking into it.
const Bytes = "application/octet-stream"

// A file of the inbox is named by the agent: a stamp, six random
// characters and an extension, one short word. A read asks for one by
// that name and nothing else, so no path ever comes from a client.
var (
	fileName = regexp.MustCompile(`^[0-9]{8}-[0-9]{6}-[a-z0-9]{6}\.[a-z0-9]{1,8}$`)
	extWord  = regexp.MustCompile(`^[a-z0-9]{1,8}$`)
)

func ValidFileName(name string) bool {
	return fileName.MatchString(name)
}

// NamedExt is all a client's name for a file contributes: the word after
// its last dot, lowercased, when it is one; else nothing.
func NamedExt(name string) string {
	base := name[strings.LastIndexAny(name, `/\`)+1:]
	i := strings.LastIndexByte(base, '.')
	if i < 0 {
		return ""
	}
	ext := strings.ToLower(base[i+1:])
	if !extWord.MatchString(ext) {
		return ""
	}
	return ext
}

// FileTypeByExt is the known type an extension names, or nothing.
func FileTypeByExt(ext string) string {
	if ext == "jpeg" {
		ext = "jpg"
	}
	for typ, e := range FileTypes {
		if e == ext {
			return typ
		}
	}
	return ""
}

// FileExt is the extension a file is kept under: its type's for a known
// type, else the word the client named, else bin.
func FileExt(typ, named string) string {
	if e, ok := FileTypes[typ]; ok {
		return e
	}
	if extWord.MatchString(named) {
		return named
	}
	return "bin"
}

// FileTypeOf is the type a known file is served as, from its name's
// extension: the images and the PDF as themselves, every text as plain
// text, so nothing in a file is interpreted by whatever shows it. An
// extension the inbox does not know answers nothing: the agent decides.
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

// ValidPath says whether a path as printed may be asked about at all:
// something, not too long, no control bytes. Where it leads is the
// agent's to decide.
func ValidPath(path string) bool {
	if path == "" || len(path) > MaxPathBytes || !utf8.ValidString(path) {
		return false
	}
	return !strings.ContainsFunc(path, func(r rune) bool { return r < 0x20 || r == 0x7f })
}

// ValidFile says whether data is what its type claims: a known binary
// type must sniff as itself, a known text type must be UTF-8 without
// control bytes but tab, newline and return, and JSON must parse. Any
// other type is bytes, something and not too many.
func ValidFile(typ string, data []byte) bool {
	if len(data) == 0 || len(data) > MaxFile {
		return false
	}
	if _, ok := FileTypes[typ]; !ok {
		return true
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
