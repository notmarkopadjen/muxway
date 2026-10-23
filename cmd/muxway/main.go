// Command muxway is the hub, the host agent and the tools to expose panes.
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"text/tabwriter"
	"time"

	"github.com/notmarkopadjen/muxway/internal/agent"
	"github.com/notmarkopadjen/muxway/internal/hub"
	"github.com/notmarkopadjen/muxway/internal/tmux"
)

const usage = `muxway: your tmux, from anywhere

hub serve       run a hub
hub pair-code   print a one-time code to pair an agent
hub token       create, list or revoke client tokens
hub agents      list or remove paired agents
agent pair      pair this machine with a hub
agent run       run the agent
expose          make a session, window or pane reachable
unexpose        remove a mark
exposed         list what is reachable

Run "muxway <command> -h" for the flags of a command.
`

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "muxway:", err)
		os.Exit(1)
	}
}

func defaultDir(role string) string {
	if dir := os.Getenv("MUXWAY_DIR"); dir != "" {
		return dir
	}
	base, err := os.UserConfigDir()
	if err != nil {
		base = "."
	}
	return filepath.Join(base, "muxway", role)
}

func logger() *slog.Logger {
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
}

func signals() (context.Context, context.CancelFunc) {
	return signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
}

type list []string

func (l *list) String() string     { return strings.Join(*l, ",") }
func (l *list) Set(s string) error { *l = append(*l, s); return nil }

func run(args []string) error {
	if len(args) == 0 {
		fmt.Print(usage)
		return nil
	}
	switch args[0] {
	case "hub":
		if len(args) < 2 {
			return fmt.Errorf("hub what? serve, pair-code, token, agents")
		}
		return runHub(args[1], args[2:])
	case "agent":
		if len(args) < 2 {
			return fmt.Errorf("agent what? pair, run")
		}
		return runAgent(args[1], args[2:])
	case "expose", "unexpose", "exposed":
		return runExpose(args[0], args[1:])
	case "-h", "--help", "help":
		fmt.Print(usage)
		return nil
	}
	return fmt.Errorf("unknown command %q", args[0])
}

func runHub(cmd string, args []string) error {
	fs := flag.NewFlagSet("hub "+cmd, flag.ContinueOnError)
	dir := fs.String("dir", defaultDir("hub"), "state directory")
	switch cmd {
	case "serve":
		listen := fs.String("listen", "127.0.0.1:7600", "address to listen on")
		public := fs.String("public-url", "", "URL agents use to reach this hub, e.g. https://hub.example.com")
		cert := fs.String("tls-cert", "", "TLS certificate file (without it, loopback only)")
		key := fs.String("tls-key", "", "TLS key file")
		proxy := fs.Bool("trust-proxy", false, "take client addresses from X-Forwarded-For set by a loopback proxy")
		if err := fs.Parse(args); err != nil {
			return err
		}
		h, err := hub.New(hub.Config{Dir: *dir, Listen: *listen, PublicURL: strings.TrimRight(*public, "/"),
			TLSCert: *cert, TLSKey: *key, TrustProxy: *proxy}, logger())
		if err != nil {
			return err
		}
		ctx, stop := signals()
		defer stop()
		return h.Serve(ctx)
	case "pair-code":
		host := fs.String("host", "", "alias the agent will have, e.g. alice-laptop")
		ttl := fs.Duration("ttl", 10*time.Minute, "how long the code is valid (at most 1h)")
		if err := fs.Parse(args); err != nil {
			return err
		}
		resp, err := hub.Admin(*dir, hub.AdminRequest{Cmd: "pair-code", Host: *host, TTL: *ttl})
		if err != nil {
			return err
		}
		fmt.Println(resp.Code)
		return nil
	case "token":
		if len(args) == 0 {
			return fmt.Errorf("token what? create, list, revoke")
		}
		sub := args[0]
		fs = flag.NewFlagSet("hub token "+sub, flag.ContinueOnError)
		dir = fs.String("dir", defaultDir("hub"), "state directory")
		switch sub {
		case "create":
			name := fs.String("name", "", "what the token is for")
			var read, write list
			fs.Var(&read, "read", "pattern the token may read, e.g. alice-laptop/work/* (repeatable)")
			fs.Var(&write, "write", "pattern the token may type into (repeatable)")
			ttl := fs.Duration("ttl", 30*24*time.Hour, "lifetime")
			if err := fs.Parse(args[1:]); err != nil {
				return err
			}
			resp, err := hub.Admin(*dir, hub.AdminRequest{Cmd: "token-create", Name: *name, Read: read, Write: write, TTL: *ttl})
			if err != nil {
				return err
			}
			fmt.Fprintf(os.Stderr, "token %s for %q, valid until %s. It is shown only now:\n",
				resp.Token.ID, resp.Token.Name, resp.Token.Expires.Format(time.RFC3339))
			fmt.Println(resp.Secret)
			return nil
		case "list":
			if err := fs.Parse(args[1:]); err != nil {
				return err
			}
			resp, err := hub.Admin(*dir, hub.AdminRequest{Cmd: "token-list"})
			if err != nil {
				return err
			}
			tw := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
			fmt.Fprintln(tw, "ID\tNAME\tREAD\tWRITE\tEXPIRES")
			for _, t := range resp.Tokens {
				fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\n", t.ID, t.Name, strings.Join(t.Read, ","),
					strings.Join(t.Write, ","), t.Expires.Format("2006-01-02"))
			}
			return tw.Flush()
		case "revoke":
			if err := fs.Parse(args[1:]); err != nil {
				return err
			}
			if fs.NArg() != 1 {
				return fmt.Errorf("revoke takes a token id")
			}
			_, err := hub.Admin(*dir, hub.AdminRequest{Cmd: "token-revoke", ID: fs.Arg(0)})
			return err
		}
		return fmt.Errorf("token what? create, list, revoke")
	case "agents":
		if err := fs.Parse(args); err != nil {
			return err
		}
		if fs.NArg() == 2 && fs.Arg(0) == "remove" {
			_, err := hub.Admin(*dir, hub.AdminRequest{Cmd: "agent-remove", Host: fs.Arg(1)})
			return err
		}
		resp, err := hub.Admin(*dir, hub.AdminRequest{Cmd: "agent-list"})
		if err != nil {
			return err
		}
		for _, a := range resp.Agents {
			state := "offline"
			if a.Online {
				state = "online"
			}
			fmt.Printf("%s\t%s\n", a.Host, state)
		}
		return nil
	}
	return fmt.Errorf("unknown hub command %q", cmd)
}

func tmuxFlags(fs *flag.FlagSet) (*string, *string) {
	return fs.String("tmux-socket", "", "tmux socket path (tmux -S)"), fs.String("tmux-name", "", "tmux socket name (tmux -L)")
}

func runAgent(cmd string, args []string) error {
	fs := flag.NewFlagSet("agent "+cmd, flag.ContinueOnError)
	dir := fs.String("dir", defaultDir("agent"), "agent directory")
	switch cmd {
	case "pair":
		ca := fs.String("ca", "", "extra CA certificate to trust for the hub")
		if err := fs.Parse(args); err != nil {
			return err
		}
		if fs.NArg() != 1 {
			return fmt.Errorf("pair takes the code printed by muxway hub pair-code")
		}
		ctx, stop := signals()
		defer stop()
		c, err := agent.Pair(ctx, *dir, fs.Arg(0), *ca)
		if err != nil {
			return err
		}
		fmt.Printf("paired as %s with %s\n", c.Host, c.HubURL)
		return nil
	case "run":
		socket, name := tmuxFlags(fs)
		if err := fs.Parse(args); err != nil {
			return err
		}
		cfg, key, err := agent.LoadConfig(*dir)
		if err != nil {
			return err
		}
		a, err := agent.New(cfg, key, tmux.Server{Socket: *socket, Name: *name}, logger())
		if err != nil {
			return err
		}
		ctx, stop := signals()
		defer stop()
		return a.Run(ctx)
	}
	return fmt.Errorf("unknown agent command %q", cmd)
}

var aliasName = regexp.MustCompile(`^[a-z0-9-]{1,32}$`)

func runExpose(cmd string, args []string) error {
	fs := flag.NewFlagSet(cmd, flag.ContinueOnError)
	socket, name := tmuxFlags(fs)
	target := fs.String("t", "", "session, session:window or session:window.pane")
	write := fs.Bool("write", false, "allow typing, not only reading")
	deny := fs.Bool("deny", false, "hide this pane or window even inside an exposed session or window")
	alias := fs.String("name", "", "short alias for one pane")
	if err := fs.Parse(args); err != nil {
		return err
	}
	srv := tmux.Server{Socket: *socket, Name: *name}
	ctx := context.Background()
	switch cmd {
	case "exposed":
		panes, err := srv.List(ctx)
		if err != nil {
			return err
		}
		tw := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
		fmt.Fprintln(tw, "ADDRESS\tMODE\tALIAS\tCOMMAND")
		for _, p := range panes {
			if p.Exposed() {
				fmt.Fprintf(tw, "%s\t%s\t%s\t%s\n", p.Address(), p.Mode, p.Alias, p.Command)
			}
		}
		return tw.Flush()
	case "unexpose":
		if *target == "" {
			return fmt.Errorf("-t is required")
		}
		if tmux.Scope(*target) == "pane" {
			srv.SetAlias(ctx, *target, "")
		}
		return srv.Mark(ctx, *target, "")
	}
	if *target == "" {
		return fmt.Errorf("-t is required: the session, window or pane to expose")
	}
	mode := tmux.ModeRead
	switch {
	case *deny && *write:
		return fmt.Errorf("-deny and -write together make no sense")
	case *deny:
		mode = tmux.ModeDeny
	case *write:
		mode = tmux.ModeWrite
	}
	if *alias != "" && !aliasName.MatchString(*alias) {
		return fmt.Errorf("an alias is 1 to 32 of a-z, 0-9 and -")
	}
	if err := srv.Mark(ctx, *target, mode); err != nil {
		return err
	}
	if *alias != "" {
		if err := srv.SetAlias(ctx, *target, *alias); err != nil {
			return err
		}
	}
	fmt.Printf("%s: %s\n", *target, mode)
	return nil
}
