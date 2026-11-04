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
		// A type the inbox does not know is bytes, whatever they are.
		{"application/x-sh", []byte("#!/bin/sh\n")},
		{"image/svg+xml", []byte("<svg/>")},
		{"application/vnd.tcpdump.pcap", []byte("\xd4\xc3\xb2\xa1\x02\x00\x04\x00")},
		{Bytes, []byte("\x7fELF\x02\x01\x01\x00rest of a binary")},
		{Bytes, bytes.Repeat([]byte("a"), MaxFile)},
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
		{"text/plain", nil},
		{Bytes, nil},
		{"text/plain", bytes.Repeat([]byte("a"), MaxFile+1)},
		{Bytes, bytes.Repeat([]byte("a"), MaxFile+1)},
	}
	for _, b := range bad {
		if ValidFile(b.typ, b.data) {
			t.Errorf("%s %q accepted", b.typ, b.data[:min(len(b.data), 12)])
		}
	}
}

func TestFileNames(t *testing.T) {
	good := []string{
		"20261025-102235-56fwge.png", "20261025-102235-a1b2c3.json", "20261025-102235-zzzzzz.jpg",
		"20261025-102235-56fwge.pcap", "20261025-102235-56fwge.bin", "20261025-102235-56fwge.7z",
		"20261025-102235-56fwge.exe", "20261025-102235-56fwge.svg", "20261025-102235-56fwge.abcdefgh",
	}
	for _, n := range good {
		if !ValidFileName(n) {
			t.Errorf("%q refused", n)
		}
	}
	bad := []string{
		"", "../agent.key", "a/20261025-102235-56fwge.png", "/20261025-102235-56fwge.png",
		"20261025-102235-56fwge.png.exe", "20261025-102235-56fwge.PNG", "20261025-102235-56fwge.tar.gz",
		"20261025-102235-56fwg.png", "20261025-102235-56fwge.png\n", "20261025-102235-56fwge",
		"20261025-102235-56fwge.", "20261025-102235-56fwge.abcdefghi", "20261025-102235-56fwge.p-ng",
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
		"20261025-102235-56fwge.zip":  "application/zip",
		// The agent decides for an extension the inbox does not know.
		"20261025-102235-56fwge.exe":  "",
		"20261025-102235-56fwge.pcap": "",
		"20261025-102235-56fwge.PNG":  "",
	} {
		if got := FileTypeOf(n); got != typ {
			t.Errorf("%s: %q, want %q", n, got, typ)
		}
	}
}

// Of a client's name only the word after the last dot is taken, lowercased.
func TestNamedExt(t *testing.T) {
	for name, ext := range map[string]string{
		"capture.pcap":        "pcap",
		"Capture.PCAP":        "pcap",
		"a.tar.gz":            "gz",
		"../../etc/passwd":    "",
		"..\\..\\x.exe":       "exe",
		"a;rm -rf x.png":      "png",
		"notes":               "",
		"notes.":              "",
		".bashrc":             "bashrc",
		"x.abcdefghi":         "",
		"x.p-ng":              "",
		"x.png\n":             "",
		"x.png/":              "",
		"dir.d/file":          "",
		"shot.jpeg":           "jpeg",
		"weird.é":             "",
		"20261025-102235.txt": "txt",
	} {
		if got := NamedExt(name); got != ext {
			t.Errorf("%q: %q, want %q", name, got, ext)
		}
	}
	for typ, want := range map[string]string{"image/jpeg": "jpg", "text/plain": "txt", Bytes: "pcap"} {
		if got := FileExt(typ, "pcap"); got != want {
			t.Errorf("FileExt(%s, pcap) = %q, want %q", typ, got, want)
		}
	}
	if got := FileExt(Bytes, ""); got != "bin" {
		t.Errorf("FileExt(bytes, none) = %q, want bin", got)
	}
	if got := FileExt("application/x-sh", "P-NG"); got != "bin" {
		t.Errorf("FileExt(unknown, bad word) = %q, want bin", got)
	}
	for ext, typ := range map[string]string{"png": "image/png", "jpeg": "image/jpeg", "jpg": "image/jpeg", "pcap": "", "": ""} {
		if got := FileTypeByExt(ext); got != typ {
			t.Errorf("FileTypeByExt(%q) = %q, want %q", ext, got, typ)
		}
	}
}
