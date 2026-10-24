# Hub and agent

## What it does

A **hub** is where clients connect. An **agent** runs on each machine with
tmux and keeps an outbound connection to the hub. Together they let a
client list the panes a host's owner exposed, read them, and type into
them. See [the architecture](../ARCHITECTURE.md) for the diagrams.

## Running a hub

```sh
# directly with TLS
muxway hub serve --listen 0.0.0.0:7600 --tls-cert cert.pem --tls-key key.pem \
  --public-url https://hub.example.com:7600

# or behind a TLS-terminating reverse proxy
muxway hub serve --listen 127.0.0.1:7600 --public-url https://hub.example.com --trust-proxy
```

- State lives in `--dir` (default `~/.config/muxway/hub`), which must be
  mode 700: the hub's key, `hub.json` with paired agents and token hashes,
  and `admin.sock`, through which the `muxway hub ...` commands talk to the
  running hub.
- Without TLS the hub refuses any address but loopback.
- `--trust-proxy` takes the client address from `X-Forwarded-For` when the
  peer is loopback, so lockouts hit the real client and not the proxy. Use
  it only behind a proxy that sets that header itself.
- The proxy must pass WebSocket upgrades on `/v1/agent`.
- `--stt-url` gives the hub a transcriber for spoken clips; see
  [transcription](transcription.md).

## Pairing an agent

```sh
hub$   muxway hub pair-code --host alice-laptop
mxw1-eyJ1Ijoi...
host$  muxway agent pair mxw1-eyJ1Ijoi...
paired as alice-laptop with https://hub.example.com
host$  muxway agent run
```

The code is valid for 10 minutes (`--ttl`, at most an hour), works once,
and is burnt after three wrong attempts. It carries the hub's public key:
the agent pins it and will never talk to a hub that cannot prove it, even
if the hub's address or TLS certificate is taken over. `--ca` adds a CA
for hubs with a private certificate.

Run the agent as a service of the user who owns the tmux server, for
example a systemd user unit. `--tmux-socket` or `--tmux-name` pick a tmux
server other than the default.

`muxway hub agents` lists paired agents and whether they are connected;
`muxway hub agents remove <alias>` unpairs one and drops its connection.

## Tokens

```sh
muxway hub token create --name phone --read 'alice-laptop/*' \
  --write 'alice-laptop/work/1.*' --ttl 720h
muxway hub token list
muxway hub token revoke <id>
```

- The token is printed once; the hub keeps only its SHA-256 hash.
- Patterns are `host/session/window.pane` with `*` inside a segment;
  missing segments mean all: `alice-laptop` is the whole host,
  `alice-laptop/work` a session, `alice-laptop/work/logs.*` a window,
  `alice-laptop/@build` the one pane with that alias.
- Writing needs a write grant **and** a read grant **and** a pane marked
  for writing on the host.
- Default lifetime 30 days.
- `--admin` gives the token the admin grant (the [admin overview](admin.md)):
  it may mint tokens, end sessions and change the address lists, so it
  lives 24 hours unless `--ttl` says otherwise. `muxway hub user create
  --admin` does the same for a person.

## Address lists

```sh
muxway hub access list
muxway hub access allow 198.51.100.0/24 2001:db8::/32
muxway hub access deny 203.0.113.9
muxway hub access clear [allow|deny]
```

The hub refuses, with `403`, every request from an address on the deny
list, and with a non-empty allow list every address not on it, agents
included. These commands go over the admin socket, which the lists do not
cover, so they are the way back in. Admins change the same lists on the
web; see [the admin overview](admin.md).

## Security considerations

- A writable pane is a shell. Grant write narrowly and expose writable
  panes sparingly; see [exposing panes](exposing-panes.md).
- Every input is audited by hub and agent: time, token id, pane, key name
  or text length. The text itself and tokens are never logged.
- Ten failed authentications from one address in ten minutes lock that
  address out for ten minutes. An agent with a stale key that keeps
  reconnecting counts too, so unpair or re-pair it promptly.
- Keep the hub's directory private and backed up: losing `hub.key` means
  re-pairing every agent.
