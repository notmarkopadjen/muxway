package wire

import (
	"bytes"
	"testing"
)

// A 1x1 PNG, and the start of a PDF.
var (
	png1 = []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89")
	pdf1 = []byte("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n")
)

func TestValidFile(t *testing.T) {
	good := []struct {
		typ  string
		data []byte
	}{
		{"image/png", png1},
		{"application/pdf", pdf1},
		{"text/plain", []byte("hello\tworld\r\n")},
		{"text/markdown", []byte("# notes\n\n- one ✓\n")},
		{"application/json", []byte(`{"a": [1, 2]}`)},
	}
	for _, g := range good {
		if !ValidFile(g.typ, g.data) {
			t.Errorf("%s refused", g.typ)
		}
	}
	bad := []struct {
		typ  string
		data []byte
	}{
		{"image/png", []byte("\x7fELF\x02\x01\x01\x00rest of a binary")},
		{"image/png", pdf1},
		{"text/plain", []byte("red\x1b[31m text")},
		{"text/plain", []byte("\xff\xfe not utf-8")},
		{"text/plain", []byte("del\x7f")},
		{"application/json", []byte(`{"a": `)},
		{"application/x-sh", []byte("#!/bin/sh\n")},
		{"image/svg+xml", []byte("<svg/>")},
		{"text/plain", nil},
		{"text/plain", bytes.Repeat([]byte("a"), MaxFile+1)},
	}
	for _, b := range bad {
		if ValidFile(b.typ, b.data) {
			t.Errorf("%s %q accepted", b.typ, b.data[:min(len(b.data), 12)])
		}
	}
}

func TestFileNames(t *testing.T) {
	good := []string{"20261025-102235-56fwge.png", "20261025-102235-a1b2c3.json", "20261025-102235-zzzzzz.jpg"}
	for _, n := range good {
		if !ValidFileName(n) {
			t.Errorf("%q refused", n)
		}
	}
	bad := []string{
		"", "../agent.key", "a/20261025-102235-56fwge.png", "/20261025-102235-56fwge.png",
		"20261025-102235-56fwge.png.exe", "20261025-102235-56fwge.PNG", "20261025-102235-56fwge.svg",
		"20261025-102235-56fwg.png", "20261025-102235-56fwge.png\n", "20261025-102235-56fwge",
	}
	for _, n := range bad {
		if ValidFileName(n) {
			t.Errorf("%q taken", n)
		}
	}
	for n, typ := range map[string]string{
		"20261025-102235-56fwge.png":  "image/png",
		"20261025-102235-56fwge.jpg":  "image/jpeg",
		"20261025-102235-56fwge.pdf":  "application/pdf",
		"20261025-102235-56fwge.json": "text/plain; charset=utf-8",
		"20261025-102235-56fwge.md":   "text/plain; charset=utf-8",
		"20261025-102235-56fwge.exe":  "",
		"20261025-102235-56fwge.zip":  "application/zip",
	} {
		if got := FileTypeOf(n); got != typ {
			t.Errorf("%s: %q, want %q", n, got, typ)
		}
	}
}
