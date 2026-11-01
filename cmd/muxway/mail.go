package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/notmarkopadjen/muxway/internal/agent"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

const mailUsage = `muxway mail: the mail left for this pane, through the agent on this machine

mail [--wait] [--timeout D] [--all] [--peek] [--json]   print the unread mail, then it counts as read
mail reply ID TEXT                                       answer a mail to the pane it came from

--wait blocks until a mail arrives (exit 2 when the time runs out), --all
prints read mail too, --peek prints without marking anything read. The
pane is $TMUX_PANE, or --pane. Nothing here is ever typed into a pane.
`

// runMail reads or answers this pane's mail over the agent's socket; no
// token is needed, the pane is its own.
func runMail(args []string) error {
	if len(args) > 0 && (args[0] == "-h" || args[0] == "--help") {
		fmt.Print(mailUsage)
		return nil
	}
	if len(args) > 0 && args[0] == "reply" {
		return runMailReply(args[1:])
	}
	fs := flag.NewFlagSet("mail", flag.ContinueOnError)
	dir := fs.String("dir", defaultDir("agent"), "agent directory")
	pane := fs.String("pane", os.Getenv("TMUX_PANE"), "pane id, default $TMUX_PANE")
	wait := fs.Bool("wait", false, "block until a mail arrives")
	timeout := fs.Duration("timeout", 10*time.Minute, "with --wait, how long at most; 0 waits a day")
	all := fs.Bool("all", false, "print read mail too")
	peek := fs.Bool("peek", false, "print without marking anything read")
	asJSON := fs.Bool("json", false, "print the mail as JSON")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *pane == "" {
		return errors.New("not inside tmux and no --pane given")
	}
	if *timeout < 0 || *timeout > agent.MaxAskWait {
		return fmt.Errorf("--timeout: up to %s", agent.MaxAskWait)
	}
	if *timeout == 0 {
		*timeout = agent.MaxAskWait
	}
	req := agent.NotifyRequest{Pane: *pane, Mail: "take", How: "pull"}
	switch {
	case *wait:
		req.Mail, req.Timeout = "wait", int(timeout.Seconds())
	case *peek, *all:
		req.Mail = "list"
	}
	mails, err := agent.ExchangeMail(*dir, req)
	if err != nil {
		return err
	}
	if *peek && !*all {
		unread := mails[:0]
		for _, m := range mails {
			if m.ReadAt == 0 {
				unread = append(unread, m)
			}
		}
		mails = unread
	}
	if *wait && len(mails) == 0 {
		fmt.Fprintln(os.Stderr, "muxway mail: nothing came in time")
		os.Exit(2)
	}
	if *asJSON {
		if mails == nil {
			mails = []wire.Mail{}
		}
		return json.NewEncoder(os.Stdout).Encode(mails)
	}
	fmt.Print(agent.FormatMail(mails))
	return nil
}

func runMailReply(args []string) error {
	fs := flag.NewFlagSet("mail reply", flag.ContinueOnError)
	dir := fs.String("dir", defaultDir("agent"), "agent directory")
	pane := fs.String("pane", os.Getenv("TMUX_PANE"), "pane id, default $TMUX_PANE")
	var pos []string
	for i := 0; i < len(args); i++ {
		if len(args[i]) > 1 && args[i][0] == '-' {
			if err := fs.Parse(args[i:]); err != nil {
				return err
			}
			break
		}
		pos = append(pos, args[i])
	}
	if len(pos) != 2 {
		return errors.New("mail reply ID TEXT")
	}
	id, err := strconv.ParseUint(pos[0], 10, 64)
	if err != nil || id == 0 {
		return errors.New("mail reply: ID is the number on the mail's header line")
	}
	if !wire.ValidMail(pos[1]) {
		return fmt.Errorf("mail reply: 1 to %d characters, no control characters but newline and tab", wire.MaxMailChars)
	}
	if *pane == "" {
		return errors.New("not inside tmux and no --pane given")
	}
	_, err = agent.ExchangeMail(*dir, agent.NotifyRequest{Pane: *pane, Mail: "reply", MailID: id, Text: pos[1]})
	if err != nil {
		switch err.Error() {
		case wire.ErrNoMail:
			return errors.New("mail reply: no such mail here, or the hub forgot it (a day)")
		case wire.ErrNoOrigin:
			return errors.New("mail reply: that mail came from no pane; its sender reads your screen")
		case wire.ErrReplied:
			return errors.New("mail reply: answered already")
		case wire.ErrReadOnly, wire.ErrNotExposed:
			return errors.New("mail reply: the sender's pane takes no mail any more")
		}
		return fmt.Errorf("mail reply: %w", err)
	}
	fmt.Println("replied")
	return nil
}
