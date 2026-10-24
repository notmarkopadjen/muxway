package hub

import (
	"encoding/binary"
	"strings"
	"testing"
)

func wav(rate, channels, bits int, samples int) []byte {
	data := make([]byte, samples*channels*bits/8)
	b := make([]byte, 44+len(data))
	copy(b[0:4], "RIFF")
	binary.LittleEndian.PutUint32(b[4:8], uint32(36+len(data)))
	copy(b[8:12], "WAVE")
	copy(b[12:16], "fmt ")
	binary.LittleEndian.PutUint32(b[16:20], 16)
	binary.LittleEndian.PutUint16(b[20:22], 1)
	binary.LittleEndian.PutUint16(b[22:24], uint16(channels))
	binary.LittleEndian.PutUint32(b[24:28], uint32(rate))
	binary.LittleEndian.PutUint32(b[28:32], uint32(rate*channels*bits/8))
	binary.LittleEndian.PutUint16(b[32:34], uint16(channels*bits/8))
	binary.LittleEndian.PutUint16(b[34:36], uint16(bits))
	copy(b[36:40], "data")
	binary.LittleEndian.PutUint32(b[40:44], uint32(len(data)))
	copy(b[44:], data)
	return b
}

func TestWavSeconds(t *testing.T) {
	if s, ok := wavSeconds(wav(16000, 1, 16, 16000)); !ok || s != 1 {
		t.Fatalf("one second: %v %v", s, ok)
	}
	for name, b := range map[string][]byte{
		"stereo": wav(16000, 2, 16, 16000), "8 bit": wav(16000, 1, 8, 16000), "44.1 kHz": wav(44100, 1, 16, 16000),
		"not a wav": []byte(strings.Repeat("x", 100)), "short": {1, 2, 3}, "no data": wav(16000, 1, 16, 0),
	} {
		if _, ok := wavSeconds(b); ok {
			t.Fatalf("%s accepted", name)
		}
	}
	// A data chunk cut short still counts what is there.
	if s, ok := wavSeconds(wav(16000, 1, 16, 16000)[:44+8000]); !ok || s != 0.25 {
		t.Fatalf("truncated: %v %v", s, ok)
	}
}

func TestCleanTranscript(t *testing.T) {
	if got := cleanTranscript("  run\x1b[1m the\n\ttests  again \x00"); got != "run [1m the tests again" {
		t.Fatalf("got %q", got)
	}
	long := cleanTranscript(strings.Repeat("ä", 5000))
	if len(long) > maxTranscript || len(long) < maxTranscript-2 || !strings.HasSuffix(long, "ä") {
		t.Fatalf("cut to %d bytes", len(long))
	}
	if cleanTranscript("\x07\x07") != "" {
		t.Fatal("bells kept")
	}
}
