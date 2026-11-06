package agent

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/notmarkopadjen/muxway/internal/wire"
)

// Mail on disk: a mailbox is written to <dir>/mail/<pane>.json whenever
// it changes and read back when the agent starts, so a restart loses no
// mail. A file names the tmux server it was written under: one for
// another server, or for a pane that is gone, is removed at start.
const mailDirName = "mail"

type mailFile struct {
	ServerPID int         `json:"server_pid"`
	Items     []wire.Mail `json:"items"`
}

func (a *Agent) mailDir() string {
	if a.cfg.Dir == "" {
		return ""
	}
	return filepath.Join(a.cfg.Dir, mailDirName)
}

func (a *Agent) mailPath(paneID string) string {
	return filepath.Join(a.mailDir(), strings.TrimPrefix(paneID, "%")+".json")
}

// saveMail writes a pane's mailbox, or removes the file of an empty one.
// Called with a.mu held.
func (a *Agent) saveMail(paneID string, serverPID int) {
	dir := a.mailDir()
	if dir == "" {
		return
	}
	path := a.mailPath(paneID)
	b := a.mail[paneID]
	if b == nil || len(b.items) == 0 {
		os.Remove(path)
		return
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		a.log.Warn("mail dir", "err", err)
		return
	}
	raw, _ := json.Marshal(mailFile{ServerPID: serverPID, Items: b.items})
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		a.log.Warn("mail not saved", "pane", paneID, "err", err)
		return
	}
	if err := os.Rename(tmp, path); err != nil {
		a.log.Warn("mail not saved", "pane", paneID, "err", err)
	}
}

// loadMail reads the mailboxes back for the panes that still exist under
// the server that is running, and drops the rest.
func (a *Agent) loadMail(ctx context.Context) {
	dir := a.mailDir()
	if dir == "" {
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	panes, _, _ := a.tmux.List(ctx)
	server := map[string]int{}
	for _, p := range panes {
		server[p.PaneID] = p.ServerPID
	}
	now := time.Now()
	boxes, mails := 0, 0
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".json") {
			continue
		}
		path := filepath.Join(dir, name)
		id := "%" + strings.TrimSuffix(name, ".json")
		raw, err := os.ReadFile(path)
		var f mailFile
		if err != nil || json.Unmarshal(raw, &f) != nil || server[id] == 0 || server[id] != f.ServerPID {
			os.Remove(path)
			continue
		}
		b := a.box(id)
		b.items = f.Items
		if !b.sweep(now) {
			delete(a.mail, id)
			os.Remove(path)
			continue
		}
		boxes++
		mails += len(b.items)
	}
	if boxes > 0 {
		a.log.Info("mail read back", "panes", boxes, "mails", mails)
	}
}
