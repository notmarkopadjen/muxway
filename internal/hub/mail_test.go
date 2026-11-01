package hub

import (
	"testing"
	"time"
)

func TestMailIDsRememberADayAndOneReply(t *testing.T) {
	l := newMailIDs()
	id := l.issue(mailRecord{ToHost: "bob-desktop", ToPane: "%5", FromHost: "alice-laptop", FromPane: "%3"})
	if id == 0 || l.issue(mailRecord{}) != id+1 {
		t.Fatal("ids do not count up")
	}
	rec, ok := l.get(id)
	if !ok || rec.ToHost != "bob-desktop" || rec.FromPane != "%3" || rec.Replied {
		t.Fatalf("record: %+v %v", rec, ok)
	}
	l.replied(id)
	if rec, _ := l.get(id); !rec.Replied {
		t.Fatal("not marked replied")
	}
	l.drop(id)
	if _, ok := l.get(id); ok {
		t.Fatal("dropped id still there")
	}
	l.m[id+1].At = time.Now().Add(-25 * time.Hour)
	if _, ok := l.get(id + 1); ok {
		t.Fatal("a day-old record answers")
	}
	l.issue(mailRecord{})
	if _, ok := l.m[id+1]; ok {
		t.Fatal("a day-old record was not swept")
	}
}

func TestTalkEntryWithoutAnOriginIsVisibleAndUnpaired(t *testing.T) {
	e := talkEntry{ToHost: "bob-desktop", Kind: "mail", MailID: 7}
	if e.hasFrom() {
		t.Fatal("no from, yet hasFrom")
	}
	if (talkEntry{FromHost: "alice-laptop"}).hasFrom() == false {
		t.Fatal("from, yet not hasFrom")
	}
}
