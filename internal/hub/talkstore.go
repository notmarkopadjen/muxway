package hub

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// The talk log and the mail ids on disk: <dir>/talk.json, written at most
// once a second after a change and read back at start, so a hub restart
// keeps the feed, the chains it draws and the ids a reply is checked
// against. The entries hold what the feed holds: the first 200
// characters of a text, never more.
const talkFileName = "talk.json"

type talkFile struct {
	Seq     uint64                 `json:"seq"`
	Entries []talkEntry            `json:"entries"`
	Mail    map[uint64]*mailRecord `json:"mail"`
	Next    uint64                 `json:"next"`
}

func (h *Hub) talkPath() string {
	if h.cfg.Dir == "" {
		return ""
	}
	return filepath.Join(h.cfg.Dir, talkFileName)
}

// loadTalk reads the file back; a hub without one, or with one it cannot
// read, starts empty, as before.
func (h *Hub) loadTalk() {
	path := h.talkPath()
	if path == "" {
		return
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var f talkFile
	if err := json.Unmarshal(raw, &f); err != nil {
		h.log.Warn("talk.json unreadable, starting empty", "err", err)
		return
	}
	h.talk.mu.Lock()
	h.talk.seq = f.Seq
	h.talk.ring = f.Entries
	if len(h.talk.ring) > talkRing {
		h.talk.ring = h.talk.ring[len(h.talk.ring)-talkRing:]
	}
	h.talk.mu.Unlock()
	h.mails.mu.Lock()
	if f.Mail != nil {
		h.mails.m = f.Mail
	}
	// Ids go on past the ones held, and never below the ones time gives.
	h.mails.next = max(h.mails.next, f.Next)
	h.mails.mu.Unlock()
	h.log.Info("talk read back", "entries", len(f.Entries), "mail", len(f.Mail))
}

// saveTalk writes the file, replaced atomically, mode 0600.
func (h *Hub) saveTalk() {
	path := h.talkPath()
	if path == "" {
		return
	}
	h.talk.mu.Lock()
	f := talkFile{Seq: h.talk.seq, Entries: append([]talkEntry(nil), h.talk.ring...)}
	h.talk.mu.Unlock()
	h.mails.mu.Lock()
	f.Mail = make(map[uint64]*mailRecord, len(h.mails.m))
	for id, r := range h.mails.m {
		c := *r
		f.Mail[id] = &c
	}
	f.Next = h.mails.next
	h.mails.mu.Unlock()
	raw, _ := json.Marshal(f)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		h.log.Warn("talk not saved", "err", err)
		return
	}
	if err := os.Rename(tmp, path); err != nil {
		h.log.Warn("talk not saved", "err", err)
	}
}

// flushTalk writes the file once a second while there is something new,
// and once more when the hub stops.
func (h *Hub) flushTalk(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			if h.talkDirty.Swap(false) {
				h.saveTalk()
			}
			return
		case <-time.After(time.Second):
			if h.talkDirty.Swap(false) {
				h.saveTalk()
			}
		}
	}
}

// noteTalk marks the file stale.
func (h *Hub) noteTalk() { h.talkDirty.Store(true) }
