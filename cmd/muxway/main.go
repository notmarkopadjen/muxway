// Command muxway is the hub, the host agent and the tools to expose panes.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
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
	"github.com/notmarkopadjen/muxway/internal/auth"
	"github.com/notmarkopadjen/muxway/internal/hub"
	"github.com/notmarkopadjen/muxway/internal/tmux"
	"github.com/notmarkopadjen/muxway/internal/wire"
)

const usage = `muxway: your tmux, from anywhere

hub serve       run a hub
hub pair-code   print a one-time code to pair an agent
hub token       create, list or revoke client tokens
hub user        create, list or remove people who sign in through a provider
hub agents      list or remove paired agents
hub access      list or change the address lists
agent pair      pair this machine with a hub
agent run       run the agent
notify          tell the agent that this pane needs attention
ask             ask the owner a question with fixed answers, wait for one
hooks           print a harness's hooks that call notify: claude-code, codex, gemini, copilot, opencode
expose          make a session, window or pane reachable
unexpose        remove a mark
exposed         list what is reachable
client          a hub from the command line: panes, inbox, read, send, key, answer, wait, events
mcp             the same as MCP tools over stdio, for an AI agent's MCP configuration
skill           print the guide an AI agent in a pane reads to use muxway

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

func jsonMarshal(v any) ([]byte, error) { return json.Marshal(v) }

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
			return fmt.Errorf("hub what? serve, pair-code, token, user, agents")
		}
		return runHub(args[1], args[2:])
	case "agent":
		if len(args) < 2 {
			return fmt.Errorf("agent what? pair, run")
		}
		return runAgent(args[1], args[2:])
	case "expose", "unexpose", "exposed":
		return runExpose(args[0], args[1:])
	case "notify":
		return runNotify(args[1:])
	case "hooks":
		return runHooks(args[1:])
	case "ask":
		return runAsk(args[1:])
	case "client":
		return runClient(args[1:])
	case "mcp":
		return runMCP(args[1:])
	case "skill":
		return runSkill(args[1:])
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
		sessionTTL := fs.Duration("session-ttl", 12*time.Hour, "how long a browser stays signed in")
		issuer := fs.String("oidc-issuer", "", "OpenID Connect issuer URL, to let people sign in with it")
		clientID := fs.String("oidc-client-id", "", "client id registered at the issuer")
		secretFile := fs.String("oidc-client-secret-file", "", "file (mode 600) holding the client secret")
		label := fs.String("oidc-label", "Sign in", "what the sign-in button says")
		claim := fs.String("oidc-claim", "email", "ID token claim that carries the e-mail")
		noWeb := fs.Bool("no-web", false, "do not serve the web client")
		sttURL := fs.String("stt-url", "", "transcriber for spoken clips: an OpenAI-compatible /v1/audio/transcriptions, e.g. whisper.cpp's server")
		sttKeyFile := fs.String("stt-key-file", "", "file (mode 600) holding the transcriber's key, if it needs one")
		sttModel := fs.String("stt-model", "whisper-1", "model name sent to the transcriber")
		sttPrompt := fs.String("stt-prompt", "", "vocabulary hint sent with every clip: host and project names")
		var peers repeated
		fs.Var(&peers, "peer", "origin of another hub of yours whose web page may use a session here, e.g. https://work.example.com (repeatable)")
		if err := fs.Parse(args); err != nil {
			return err
		}
		cfg := hub.Config{Dir: *dir, Listen: *listen, PublicURL: strings.TrimRight(*public, "/"),
			TLSCert: *cert, TLSKey: *key, TrustProxy: *proxy, SessionTTL: *sessionTTL, NoWeb: *noWeb}
		for _, p := range peers {
			origin, err := hub.PeerOrigin(p)
			if err != nil {
				return fmt.Errorf("--peer %q: %w", p, err)
			}
			cfg.Peers = append(cfg.Peers, origin)
		}
		if *sttURL != "" {
			if !strings.HasPrefix(*sttURL, "https://") && !strings.HasPrefix(*sttURL, "http://") {
				return fmt.Errorf("--stt-url must be an http(s) URL")
			}
			cfg.STT = hub.STT{URL: *sttURL, Model: *sttModel, Prompt: *sttPrompt}
			if *sttKeyFile != "" {
				key, err := readSecretFile(*sttKeyFile, "--stt-key-file")
				if err != nil {
					return err
				}
				cfg.STT.Key = key
			}
		}
		if *issuer != "" {
			if cfg.PublicURL == "" {
				return fmt.Errorf("--oidc-issuer needs --public-url for the redirect address")
			}
			secret, err := readSecretFile(*secretFile, "--oidc-client-secret-file")
			if err != nil {
				return err
			}
			prov, err := auth.NewOIDC(auth.OIDCConfig{Issuer: *issuer, ClientID: *clientID, ClientSecret: secret,
				RedirectURL: cfg.PublicURL + "/v1/auth/oidc/callback", Label: *label, Claim: *claim})
			if err != nil {
				return fmt.Errorf("oidc: %w", err)
			}
			cfg.Providers = append(cfg.Providers, prov)
		}
		h, err := hub.New(cfg, logger())
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
			ttl := fs.Duration("ttl", 0, "lifetime (default 30 days, 24h with --admin)")
			admin := fs.Bool("admin", false, "may administer the hub: mint tokens, end sessions, change the address lists")
			if err := fs.Parse(args[1:]); err != nil {
				return err
			}
			resp, err := hub.Admin(*dir, hub.AdminRequest{Cmd: "token-create", Name: *name, Read: read, Write: write, TTL: *ttl, Admin: *admin})
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
			fmt.Fprintln(tw, "ID\tNAME\tREAD\tWRITE\tADMIN\tEXPIRES")
			for _, t := range resp.Tokens {
				fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\t%s\n", t.ID, t.Name, strings.Join(t.Read, ","),
					strings.Join(t.Write, ","), yes(t.Admin), t.Expires.Format("2006-01-02"))
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
	case "user":
		if len(args) == 0 {
			return fmt.Errorf("user what? create, list, remove")
		}
		sub := args[0]
		fs = flag.NewFlagSet("hub user "+sub, flag.ContinueOnError)
		dir = fs.String("dir", defaultDir("hub"), "state directory")
		switch sub {
		case "create":
			email := fs.String("email", "", "the address the identity provider verifies")
			name := fs.String("name", "", "display name")
			var read, write list
			fs.Var(&read, "read", "pattern the user may read (repeatable)")
			fs.Var(&write, "write", "pattern the user may type into (repeatable)")
			ttl := fs.Duration("ttl", 365*24*time.Hour, "how long the account lasts")
			admin := fs.Bool("admin", false, "may administer the hub")
			if err := fs.Parse(args[1:]); err != nil {
				return err
			}
			resp, err := hub.Admin(*dir, hub.AdminRequest{Cmd: "user-create", Email: *email, Name: *name, Read: read, Write: write, TTL: *ttl, Admin: *admin})
			if err != nil {
				return err
			}
			fmt.Printf("user %s (%s), valid until %s\n", resp.User.ID, resp.User.Email, resp.User.Expires.Format(time.RFC3339))
			return nil
		case "list":
			if err := fs.Parse(args[1:]); err != nil {
				return err
			}
			resp, err := hub.Admin(*dir, hub.AdminRequest{Cmd: "user-list"})
			if err != nil {
				return err
			}
			tw := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
			fmt.Fprintln(tw, "ID\tEMAIL\tREAD\tWRITE\tADMIN\tEXPIRES")
			for _, u := range resp.Users {
				fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\t%s\n", u.ID, u.Email, strings.Join(u.Read, ","),
					strings.Join(u.Write, ","), yes(u.Admin), u.Expires.Format("2006-01-02"))
			}
			return tw.Flush()
		case "remove":
			if err := fs.Parse(args[1:]); err != nil {
				return err
			}
			if fs.NArg() != 1 {
				return fmt.Errorf("remove takes a user id or e-mail")
			}
			_, err := hub.Admin(*dir, hub.AdminRequest{Cmd: "user-remove", ID: fs.Arg(0)})
			return err
		}
		return fmt.Errorf("user what? create, list, remove")
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
	case "access":
		// Over the socket, so this works when the lists shut out every client.
		sub := "list"
		if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
			sub, args = args[0], args[1:]
		}
		if err := fs.Parse(args); err != nil {
			return err
		}
		var req hub.AdminRequest
		switch sub {
		case "list":
			req = hub.AdminRequest{Cmd: "access-list"}
		case "allow", "deny":
			if fs.NArg() == 0 {
				return fmt.Errorf("access %s takes one or more addresses or CIDRs", sub)
			}
			req = hub.AdminRequest{Cmd: "access-add", List: sub, Addrs: fs.Args()}
		case "clear":
			req = hub.AdminRequest{Cmd: "access-clear", List: fs.Arg(0)}
		default:
			return fmt.Errorf("access what? list, allow, deny, clear [allow|deny]")
		}
		resp, err := hub.Admin(*dir, req)
		if err != nil {
			return err
		}
		for _, a := range resp.Access.Allow {
			fmt.Printf("allow\t%s\n", a)
		}
		for _, a := range resp.Access.Deny {
			fmt.Printf("deny\t%s\n", a)
		}
		return nil
	}
	return fmt.Errorf("unknown hub command %q", cmd)
}

func yes(b bool) string {
	if b {
		return "yes"
	}
	return "-"
}

// readSecretFile reads a secret kept in a file only its owner can read.
func readSecretFile(path, flag string) (string, error) {
	if path == "" {
		return "", fmt.Errorf("%s is required here", flag)
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if info.Mode().Perm()&0o077 != 0 {
		return "", fmt.Errorf("%s must be readable by its owner only (chmod 600)", path)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	secret := strings.TrimSpace(string(raw))
	if secret == "" {
		return "", fmt.Errorf("%s is empty", path)
	}
	return secret, nil
}

// repeated is a flag given more than once.
type repeated []string

func (r *repeated) String() string     { return strings.Join(*r, ",") }
func (r *repeated) Set(v string) error { *r = append(*r, v); return nil }

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
		sessions := fs.Bool("allow-sessions", false, "let clients with a write grant start new sessions, marked writable")
		closes := fs.Bool("allow-close", false, "let clients with a write grant close writable panes, ending what runs in them")
		inbox := fs.String("inbox", "", `directory for files clients send a writable pane ("default": inbox/ in --dir); off when empty`)
		inboxMax := fs.Int("inbox-max-files", 0, "files the inbox holds at most (default 500)")
		var preview []string
		fs.Func("preview", "directory under which clients with a write grant may preview files the pane printed paths of (repeatable); off without", func(dir string) error {
			abs, err := filepath.Abs(dir)
			if err != nil {
				return err
			}
			preview = append(preview, abs)
			return nil
		})
		watch := fs.Bool("watch", true, "read the screens of panes that run a known AI harness and report their state when no hook does")
		previewHidden := fs.Bool("preview-hidden", false, "serve hidden files and directories under the preview roots too (.github, .vscode); never .git, .ssh, .config, .env and the like")
		if err := fs.Parse(args); err != nil {
			return err
		}
		cfg, key, err := agent.LoadConfig(*dir)
		if err != nil {
			return err
		}
		cfg.AllowSessions = *sessions
		cfg.AllowClose = *closes
		if *inbox != "" {
			path := *inbox
			if path == "default" {
				path = filepath.Join(*dir, "inbox")
			}
			if cfg.Inbox, err = filepath.Abs(path); err != nil {
				return err
			}
			cfg.InboxMaxFiles = *inboxMax
		}
		cfg.Preview = preview
		cfg.PreviewHidden = *previewHidden
		cfg.Watch = *watch
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

// runNotify hands one notification to the agent. As a Claude Code hook it
// exits 0 whatever happens, so a stopped agent never disturbs the session.
func runNotify(args []string) error {
	fs := flag.NewFlagSet("notify", flag.ContinueOnError)
	dir := fs.String("dir", defaultDir("agent"), "agent directory")
	pane := fs.String("pane", os.Getenv("TMUX_PANE"), "pane id, default $TMUX_PANE")
	kind := fs.String("kind", "", "question, permission, idle, done or working")
	text := fs.String("text", "", "a short line about it")
	from := fs.String("from", "", "read a harness's hook payload from stdin: "+strings.Join(agent.Harnesses, ", "))
	if err := fs.Parse(args); err != nil {
		return err
	}
	hook := *from != ""
	quiet := func(err error) error {
		if hook && err != nil {
			fmt.Fprintln(os.Stderr, "muxway notify:", err)
			return nil
		}
		return err
	}
	if hook {
		if !agent.KnownHarness(*from) {
			return fmt.Errorf("unknown source %q; one of %s", *from, strings.Join(agent.Harnesses, ", "))
		}
		raw, err := io.ReadAll(io.LimitReader(os.Stdin, 1<<20))
		if err != nil {
			return quiet(err)
		}
		k, t, ok := agent.ParseHook(*from, raw)
		if !ok {
			return nil
		}
		*kind, *text = k, t
	}
	if *pane == "" {
		return quiet(fmt.Errorf("not inside tmux and no --pane given"))
	}
	if *kind == "" {
		return fmt.Errorf("--kind is required: question, permission, idle, done or working")
	}
	return quiet(agent.SendNotify(*dir, agent.NotifyRequest{Pane: *pane, Kind: *kind, Text: *text}))
}

func runHooks(args []string) error {
	if len(args) == 0 || !agent.KnownHarness(args[0]) {
		return fmt.Errorf("hooks what? one of %s", strings.Join(agent.Harnesses, ", "))
	}
	harness := args[0]
	fs := flag.NewFlagSet("hooks "+harness, flag.ContinueOnError)
	dir := fs.String("dir", defaultDir("agent"), "agent directory to pass to notify")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	exe, err := os.Executable()
	if err != nil {
		exe = "muxway"
	}
	// The directory is spelled out: hooks run in the harness's environment,
	// which may resolve the default differently from this shell. OpenCode's
	// plugin passes the kind itself.
	cmd := exe + " notify --from " + harness + " --dir " + *dir
	if harness == "opencode" {
		cmd = exe + " notify --dir " + *dir
	}
	config, where, err := agent.HookConfig(harness, cmd)
	if err != nil {
		return err
	}
	fmt.Fprintln(os.Stderr, "Add to "+where+":")
	os.Stdout.Write(config)
	return nil
}

// runAsk puts a question with fixed answers on this pane and waits for
// the answer: exit 0 with it on stdout, 2 when the time ran out, 3 when
// the owner answered in the pane instead, 1 for anything else.
func runAsk(args []string) error {
	fs := flag.NewFlagSet("ask", flag.ContinueOnError)
	dir := fs.String("dir", defaultDir("agent"), "agent directory")
	pane := fs.String("pane", os.Getenv("TMUX_PANE"), "pane id, default $TMUX_PANE")
	text := fs.String("text", "", "the question, a short line")
	timeout := fs.Duration("timeout", 10*time.Minute, "how long to wait for an answer; 0 waits a day")
	var choices list
	fs.Var(&choices, "choice", "an answer to offer (repeat: 2 to 8, each 1 to 40 characters)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *pane == "" {
		return fmt.Errorf("not inside tmux and no --pane given")
	}
	if *text == "" {
		return fmt.Errorf("--text is required: the question")
	}
	if !wire.ValidChoices(choices) {
		return fmt.Errorf("--choice: %d to %d distinct answers of 1 to %d characters, without | or control characters", wire.MinChoices, wire.MaxChoices, wire.MaxChoiceLen)
	}
	if *timeout < 0 || *timeout > agent.MaxAskWait {
		return fmt.Errorf("--timeout: up to %s", agent.MaxAskWait)
	}
	if *timeout == 0 {
		*timeout = agent.MaxAskWait
	}
	answer, err := agent.Exchange(*dir, agent.NotifyRequest{Pane: *pane, Kind: wire.KindQuestion, Text: *text,
		Choices: choices, Ask: true, Timeout: int(timeout.Seconds())})
	if err != nil {
		switch err.Error() {
		case agent.AskTimeout:
			fmt.Fprintln(os.Stderr, "muxway ask: no answer in time")
			os.Exit(2)
		case agent.AskTyped, agent.AskReplaced:
			fmt.Fprintln(os.Stderr, "muxway ask: answered in the pane")
			os.Exit(3)
		}
		return err
	}
	fmt.Println(answer)
	return nil
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
		panes, skipped, err := srv.List(ctx)
		if err != nil {
			return err
		}
		if skipped > 0 {
			fmt.Fprintf(os.Stderr, "warning: %d panes could not be read (a name containing %q?)\n", skipped, "|mxw|")
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
