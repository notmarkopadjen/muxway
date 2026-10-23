//go:build e2e

package e2e

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 15: runs last and searches every log this run wrote for every secret the
// run created: tokens, pairing codes and their secrets, private keys.
func TestSec15_NoSecretInAnyLog(t *testing.T) {
	secrets.Lock()
	list := append([]string{}, secrets.list...)
	secrets.Unlock()
	if len(list) == 0 {
		t.Skip("no other test ran")
	}
	files := 0
	filepath.WalkDir(filepath.Join(runDir, "logs"), func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		raw, _ := os.ReadFile(path)
		files++
		for _, s := range list {
			if len(s) >= 12 && strings.Contains(string(raw), s) {
				t.Errorf("%s contains a secret (%s...)", path, s[:6])
			}
		}
		return nil
	})
	t.Logf("searched %d log files for %d secrets", files, len(list))
}
