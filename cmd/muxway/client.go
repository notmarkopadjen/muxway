package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/notmarkopadjen/muxway/internal/client"
	"github.com/notmarkopadjen/muxway/internal/mcp"
	"github.com/notmarkopadjen/muxway/internal/skill"
)

const clientUsage = `muxway client: a hub from the command line, for a script or an agent

connect   --hub URL --token-file F [--ca F]   keep a hub and a token
panes     [--json]                            every pane the token may read
inbox     [--json]                            what waits for its owner, oldest first
read      ADDRESS [--lines N]                 the last lines of a pane
send      ADDRESS TEXT [--enter]              type into a pane
key       ADDRESS KEY [--count N]             press a key: Enter, C-c, M-x, F5...
answer    ADDRESS CHOICE                      answer a question with one of its choices
wait      [ADDRESS] [--timeout D] [--json]    until a pane (or any) needs its owner; exit 2 on timeout
events    [--follow] [--json]                 the recent events, or a feed

MUXWAY_HUB, MUXWAY_TOKEN and MUXWAY_CA override what connect kept.
`

// clientFor loads the kept hub and token, or the environment's.
func clientFor(dir string) (*client.Client, error) {
	cfg, token, err := client.Load(dir)
	if err != nil {
		return nil, err
	}
	return client.New(cfg.Hub, token, cfg.CA)
}

func runClient(args []string) error {
	if len(args) == 0 || args[0] == "-h" || args[0] == "--help" {
		fmt.Print(clientUsage)
		return nil
	}
	verb, rest := args[0], args[1:]
	fs := flag.NewFlagSet("client "+verb, flag.ContinueOnError)
	dir := fs.String("dir", defaultDir("client"), "client directory")
	asJSON := fs.Bool("json", false, "print the hub's answer as it is")
	// Flags may follow the positional arguments: "read ADDRESS --lines 50".
	var pos []string
	var flagsOnly []string
	for i := 0; i < len(rest); i++ {
		if strings.HasPrefix(rest[i], "-") {
			flagsOnly = append(flagsOnly, rest[i:]...)
			break
		}
		pos = append(pos, rest[i])
	}
	ctx, stop := signals()
	defer stop()
	switch verb {
	case "connect":
		hub := fs.String("hub", "", "the hub's URL, https://hub.example.com")
		tokenFile := fs.String("token-file", "", "file holding the token; - reads stdin")
		ca := fs.String("ca", "", "certificate authority file for a hub with its own certificate")
		if err := fs.Parse(flagsOnly); err != nil {
			return err
		}
		if *hub == "" || *tokenFile == "" {
			return errors.New("--hub and --token-file are required")
		}
		var raw []byte
		var err error
		if *tokenFile == "-" {
			raw, err = io.ReadAll(io.LimitReader(os.Stdin, 4096))
		} else {
			raw, err = os.ReadFile(*tokenFile)
		}
		if err != nil {
			return err
		}
		token := strings.TrimSpace(string(raw))
		if token == "" {
			return errors.New("the token file is empty")
		}
		c, err := client.New(*hub, token, *ca)
		if err != nil {
			return err
		}
		if _, err := c.Do(ctx, "GET", "/v1/me", "application/json", nil); err != nil {
			return fmt.Errorf("the hub refused the token: %w", err)
		}
		if err := client.Save(*dir, client.Config{Hub: *hub, CA: *ca}, token); err != nil {
			return err
		}
		fmt.Printf("connected to %s; kept in %s\n", *hub, *dir)
		return nil
	case "panes", "inbox":
		if err := fs.Parse(flagsOnly); err != nil {
			return err
		}
		c, err := clientFor(*dir)
		if err != nil {
			return err
		}
		accept := "text/plain"
		if *asJSON {
			accept = "application/json"
		}
		raw, err := c.Do(ctx, "GET", "/v1/"+verb, accept, nil)
		if err != nil {
			return err
		}
		os.Stdout.Write(raw)
		if *asJSON && len(raw) > 0 && raw[len(raw)-1] != '\n' {
			fmt.Println()
		}
		return nil
	case "read":
		lines := fs.Int("lines", 0, "lines from the bottom, default 100, at most 2000")
		if err := fs.Parse(flagsOnly); err != nil {
			return err
		}
		if len(pos) != 1 {
			return errors.New("read ADDRESS")
		}
		c, err := clientFor(*dir)
		if err != nil {
			return err
		}
		out, err := c.Read(ctx, pos[0], *lines)
		if err != nil {
			return err
		}
		fmt.Print(out)
		if !strings.HasSuffix(out, "\n") {
			fmt.Println()
		}
		return nil
	case "send":
		enter := fs.Bool("enter", false, "press Enter after the text")
		if err := fs.Parse(flagsOnly); err != nil {
			return err
		}
		if len(pos) != 2 {
			return errors.New("send ADDRESS TEXT")
		}
		c, err := clientFor(*dir)
		if err != nil {
			return err
		}
		if err := c.Input(ctx, pos[0], map[string]string{"text": pos[1]}); err != nil {
			return err
		}
		if *enter {
			return c.Input(ctx, pos[0], map[string]string{"key": "Enter"})
		}
		return nil
	case "key":
		count := fs.Int("count", 0, "how many times, 1 to 50")
		if err := fs.Parse(flagsOnly); err != nil {
			return err
		}
		if len(pos) != 2 {
			return errors.New("key ADDRESS KEY")
		}
		c, err := clientFor(*dir)
		if err != nil {
			return err
		}
		body := map[string]any{"key": pos[1]}
		if *count > 0 {
			body["count"] = *count
		}
		return c.Input(ctx, pos[0], body)
	case "answer":
		if err := fs.Parse(flagsOnly); err != nil {
			return err
		}
		if len(pos) != 2 {
			return errors.New("answer ADDRESS CHOICE")
		}
		c, err := clientFor(*dir)
		if err != nil {
			return err
		}
		return c.Answer(ctx, pos[0], pos[1])
	case "wait":
		timeout := fs.Duration("timeout", 10*time.Minute, "how long to wait at most")
		if err := fs.Parse(flagsOnly); err != nil {
			return err
		}
		if len(pos) > 1 {
			return errors.New("wait [ADDRESS]")
		}
		address := ""
		if len(pos) == 1 {
			address = pos[0]
		}
		c, err := clientFor(*dir)
		if err != nil {
			return err
		}
		wctx, cancel := context.WithTimeout(ctx, *timeout)
		defer cancel()
		e, err := c.Wait(wctx, address)
		if err != nil {
			return err
		}
		if e == nil {
			if ctx.Err() != nil {
				return nil
			}
			fmt.Fprintln(os.Stderr, "muxway client wait: nothing waited in time")
			os.Exit(2)
		}
		if *asJSON {
			return printJSON(e)
		}
		line := e.Address + "\t" + e.Kind + "\t" + e.Text
		if len(e.Choices) > 0 {
			line += "\t" + strings.Join(e.Choices, "|")
		}
		fmt.Println(line)
		return nil
	case "events":
		follow := fs.Bool("follow", false, "keep printing events as they come")
		if err := fs.Parse(flagsOnly); err != nil {
			return err
		}
		c, err := clientFor(*dir)
		if err != nil {
			return err
		}
		events, cursor, err := c.Events(ctx, 0, 0, 100)
		if err != nil {
			return err
		}
		if err := printEvents(events, *asJSON); err != nil {
			return err
		}
		for *follow && ctx.Err() == nil {
			events, cursor, err = c.Events(ctx, cursor, 30, 100)
			if err != nil {
				if ctx.Err() != nil {
					return nil
				}
				return err
			}
			if err := printEvents(events, *asJSON); err != nil {
				return err
			}
		}
		return nil
	}
	return fmt.Errorf("unknown client command %q\n%s", verb, clientUsage)
}

func printEvents(events []client.Event, asJSON bool) error {
	for _, e := range events {
		if asJSON {
			if err := printJSON(e); err != nil {
				return err
			}
			continue
		}
		line := fmt.Sprintf("%d\t%d\t%s\t%s\t%s", e.Seq, e.At, e.Address, e.Kind, e.Text)
		if len(e.Choices) > 0 {
			line += "\t" + strings.Join(e.Choices, "|")
		}
		fmt.Println(line)
	}
	return nil
}

func printJSON(v any) error {
	raw, err := jsonMarshal(v)
	if err != nil {
		return err
	}
	fmt.Println(string(raw))
	return nil
}

// runMCP serves the hub's panes as MCP tools over stdin and stdout.
func runMCP(args []string) error {
	fs := flag.NewFlagSet("mcp", flag.ContinueOnError)
	dir := fs.String("dir", defaultDir("client"), "client directory")
	if err := fs.Parse(args); err != nil {
		return err
	}
	c, err := clientFor(*dir)
	if err != nil {
		return err
	}
	ctx, stop := signals()
	defer stop()
	return (&mcp.Server{Client: c, Name: "muxway"}).Serve(ctx, os.Stdin, os.Stdout)
}

// runSkill prints the guide an agent in a pane reads.
func runSkill(args []string) error {
	if len(args) > 0 {
		return errors.New("skill takes no arguments; redirect it: muxway skill > .claude/skills/muxway/SKILL.md")
	}
	fmt.Print(skill.Text)
	return nil
}
