```
┌─ muxway ─┐
```

Your tmux, from anywhere. A hub, a small agent per machine, and clients from the browser to smart glasses to a 2002 feature phone. Security first: a tmux pane is a shell.

**One screen, every machine.** Put up to four panes side by side from any
mix of hosts, sessions and windows: the build on your workstation, the
logs on a server, an AI agent on your laptop, all in one view, each live
and typable. Drag a header to rearrange them however you like.

```
┌─ alice-laptop/work/0.0 ───────┬─ build-server/ci/1.0 ─────────┐
│ ✻ Claude: waiting for you     │ $ make test                   │
│                               │ ok   ./...  4.2s              │
├─ bob-desktop/logs/0.1 ────────┴───────────────────────────────┤
│ $ tail -f app.log                                             │
└───────────────────────────────────────────────────────────────┘
```

> Early development. The hub, the agent, the protocol, notifications from AI CLIs, sign-in with OpenID Connect and the web client work; native clients are next.

## Quick start

```sh
go install github.com/notmarkopadjen/muxway/cmd/muxway@latest

# on the hub (behind a TLS proxy here; see docs for direct TLS)
muxway hub serve --listen 127.0.0.1:7600 --public-url https://hub.example.com --trust-proxy &
muxway hub pair-code --host alice-laptop

# on the machine with tmux
muxway agent pair <code>
muxway agent run &
muxway expose -t work:1.0 --write --name build
muxway hooks claude-code   # hooks so Claude Code in a pane can call for you

# back on the hub: a token for a client
muxway hub token create --name phone --read 'alice-laptop/*' --write 'alice-laptop/@build'
```

Then open `https://hub.example.com/` in a browser and paste the token, or
sign in with your identity provider if the hub has one. For scripts and
small clients:

```sh
curl -H "Authorization: Bearer $TOKEN" -H "Accept: text/plain" \
  "https://hub.example.com/v1/panes/alice-laptop/@build?width=40&lines=20"
```

Read [the architecture](docs/ARCHITECTURE.md) and [the protocol](docs/protocol/v1.md)
to build a client.

Contributors and AI agents: read [AGENTS.md](AGENTS.md) first.
Security issues: see [SECURITY.md](SECURITY.md).
