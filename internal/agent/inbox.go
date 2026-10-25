package agent

import (
	"context"
	"crypto/rand"
	"errors"
	"os"
	"path/filepath"
	"time"

	"github.com/notmarkopadjen/muxway/internal/wire"
)

// The inbox: files a client hands a pane's program, written where the
// host's owner said, under names the agent chooses, kept a day. Nothing
// in it is ever run, unpacked or followed.
const (
	inboxBytes    = 256 << 20
	inboxFiles    = 500
	inboxLifetime = 24 * time.Hour
)

var (
	errInboxFull = errors.New("inbox full")
	errBadFile   = errors.New("not what its type says")
)

func (a *Agent) inboxMaxFiles() int {
	if a.cfg.InboxMaxFiles > 0 {
		return a.cfg.InboxMaxFiles
	}
	return inboxFiles
}

// openInbox makes the directory private to the agent's user.
func (a *Agent) openInbox() error {
	if err := os.MkdirAll(a.cfg.Inbox, 0o700); err != nil {
		return err
	}
	return os.Chmod(a.cfg.Inbox, 0o700)
}

// sweepInbox removes files older than a day, at start and every hour.
func (a *Agent) sweepInbox(ctx context.Context) {
	for {
		a.sweep()
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Hour):
		}
	}
}

func (a *Agent) sweep() {
	entries, err := os.ReadDir(a.cfg.Inbox)
	if err != nil {
		return
	}
	n := 0
	for _, e := range entries {
		info, err := e.Info()
		if err != nil || !info.Mode().IsRegular() || time.Since(info.ModTime()) < inboxLifetime {
			continue
		}
		if os.Remove(filepath.Join(a.cfg.Inbox, e.Name())) == nil {
			n++
		}
	}
	if n > 0 {
		a.log.Info("inbox swept", "removed", n)
	}
}

// saveFile writes a file a client sent, after checking it again, and
// answers its path.
func (a *Agent) saveFile(typ string, data []byte) (string, error) {
	ext, ok := wire.FileTypes[typ]
	if !ok || !wire.ValidFile(typ, data) {
		return "", errBadFile
	}
	entries, err := os.ReadDir(a.cfg.Inbox)
	if err != nil {
		return "", err
	}
	var total int64
	files := 0
	for _, e := range entries {
		if info, err := e.Info(); err == nil && info.Mode().IsRegular() {
			total += info.Size()
			files++
		}
	}
	if files >= a.inboxMaxFiles() || total+int64(len(data)) > inboxBytes {
		return "", errInboxFull
	}
	path := filepath.Join(a.cfg.Inbox, time.Now().Format("20060102-150405")+"-"+lowerRandom(6)+"."+ext)
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return "", err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		os.Remove(path)
		return "", err
	}
	return path, f.Close()
}

func lowerRandom(n int) string {
	const letters = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, n)
	rand.Read(b)
	for i := range b {
		b[i] = letters[int(b[i])%len(letters)]
	}
	return string(b)
}
