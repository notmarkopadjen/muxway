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

- State lives in `--dir`, which must be mode 700: the hub's key, `hub.json`
  with paired agents and token hashes, and `admin.sock`, through which the
  `muxway hub ...` commands talk to the running hub. The default is
  `muxway/hub` under the user's configuration directory: `$XDG_CONFIG_HOME`
  or `~/.config` on Linux, `~/Library/Application Support` on macOS. The
  `MUXWAY_DIR` environment variable replaces the whole default as it is,
  for the hub and the agent alike (no role is appended), so a service can
  keep its state where its unit says; a hub and an agent on one machine
  need different values, or `--dir`.
- The default port is 7600, on loopback. Without TLS the hub refuses any
  address but loopback.
- `--trust-proxy` takes the client address from `X-Forwarded-For` when the
  peer is loopback, so lockouts hit the real client and not the proxy. Use
  it only behind a proxy that sets that header itself.
- The proxy must pass WebSocket upgrades on `/v1/agent`; see
  [operations](#operations) for the rest a proxy needs.
- `--stt-url` gives the hub a transcriber for spoken clips; see
  [transcription](transcription.md).

| `hub serve` flag | Does |
|---|---|
| `--dir <path>` | state directory (see above) |
| `--listen <addr>` | address to listen on; default `127.0.0.1:7600` |
| `--public-url <url>` | the URL agents use to reach this hub, carried in pairing codes, e.g. `https://hub.example.com` |
| `--tls-cert <file>`, `--tls-key <file>` | serve TLS with these; without them the hub listens on loopback only |
| `--trust-proxy` | take client addresses from `X-Forwarded-For` set by a loopback proxy |
| `--no-web` | do not serve the web client; `GET /` then only sends a browser to the sign-in provider, if any |
| `--session-ttl <duration>` | how long a browser stays signed in; default `12h` |
| `--peer <origin>` | another hub of yours, `https://work.example.com`, whose web page may use a session here (repeatable); see [several hubs](web-client.md#several-hubs) |
| `--oidc-issuer <url>` | OpenID Connect issuer, to let people sign in with it (see [signing in](sign-in.md)) |
| `--oidc-client-id <id>` | client id registered at the issuer |
| `--oidc-client-secret-file <file>` | file, mode 600, holding the client secret |
| `--oidc-claim <name>` | ID token claim that carries the e-mail; default `email` |
| `--oidc-label <text>` | what the sign-in button says; default `Sign in` |
| `--stt-url <url>` | transcriber for spoken clips: an OpenAI-compatible `/v1/audio/transcriptions` |
| `--stt-key-file <file>` | file, mode 600, holding the transcriber's key, if it needs one |
| `--stt-model <name>` | model name sent to the transcriber; default `whisper-1` |
| `--stt-prompt <text>` | vocabulary hint sent with every clip: host and project names |

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

`muxway hub agents` lists paired agents and whether they are connected;
`muxway hub agents remove <alias>` unpairs one and drops its connection.

## Running an agent

```sh
muxway agent run                       # the default tmux server of this user
muxway agent run --tmux-name work      # a server started with tmux -L work
muxway agent run --inbox default --allow-sessions
muxway agent run --preview ~/work --preview ~/notes   # files under these, previewed by writers
muxway agent run --preview ~/work --preview-hidden    # .github and such too; never .git, .ssh, .env
muxway agent run --watch=false         # do not read the screens of AI harnesses without hooks
```

Run it as the user who owns the tmux server, as a service (a systemd user
unit, see [operations](#operations)). `--tmux-socket` or `--tmux-name` pick
a tmux server other than the default. Once the server answers, the agent
turns its `extended-keys` option on if it is off, so a modified key a
client sends (`Shift+Enter`, which Claude Code takes as a new line)
reaches a program that asked for modified keys. Before sending such a
key the agent asks tmux whether the pane's program asked (`pane_key_mode`,
tmux 3.5 and newer) and sends the plain key to a program that did not,
as a terminal would; a tmux before 3.5 cannot say, so there every program
gets the plain key and Shift+Enter is an Enter. `on` and `always` are left as
set; a tmux older than 3.2 has no such option, which the agent logs once.
The agent's state is its `--dir`
(default `muxway/agent` under the configuration directory, or
`MUXWAY_DIR`), mode 700:

| File | Holds |
|---|---|
| `agent.json` | the hub's URL and public key, this host's alias, the path of the extra CA if one was given |
| `agent.key` | the agent's Ed25519 key, the one the hub pinned at pairing |
| `notify.sock` | the socket the AI CLI hooks post attention events to (see [notifications](notifications.md)) |
| `inbox/` | files clients hand a pane's program, with `--inbox default` (see [attachments](attachments.md)) |

Losing `agent.key` means pairing again: the hub knows the host by that key
and refuses any other, so `muxway hub agents remove <alias>` on the hub,
then a new code. `--allow-sessions` and `--allow-close` let clients with a
write grant start sessions and close panes; both are off by default (see
[new panes and sessions](new-panes.md)). `--preview <dir>`, repeatable,
lets clients with a write grant read files under that directory when a
pane prints their paths (see [preview](preview.md)) and see the changes of
a repository under it with read-only `git status` and `git diff` run by
the agent (see [changes](changes.md)); the agent reads them with its own
rights, so choose roots the agent's user should show. `--watch`, on by
default, reads the visible screens of exposed panes that run a known AI
harness and reports working, a prompt or done when no hook does (see
[the watcher](notifications.md#the-watcher)).

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

## Operations

### As a service

The hub as a system service under its own user, its state in a directory
that user alone can read:

```ini
# /etc/systemd/system/muxway-hub.service
[Unit]
Description=muxway hub
After=network-online.target
Wants=network-online.target

[Service]
User=muxway
Group=muxway
ExecStart=/usr/local/bin/muxway hub serve --dir /var/lib/muxway/hub \
  --listen 127.0.0.1:7600 --public-url https://hub.example.com --trust-proxy
Restart=on-failure
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/lib/muxway/hub
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
```

`muxway hub token create` and the other hub commands talk to the running
hub through `admin.sock` in that directory, so run them as the same user
with the same `--dir` (or `MUXWAY_DIR=/var/lib/muxway/hub`).

The agent as a user unit of whoever owns the tmux server, so it finds
that user's tmux socket and state:

```ini
# ~/.config/systemd/user/muxway-agent.service
[Unit]
Description=muxway agent
After=default.target

[Service]
ExecStart=%h/go/bin/muxway agent run
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

`systemctl --user enable --now muxway-agent`; `loginctl enable-linger
alice` keeps it running when that user is not logged in.

### Behind a reverse proxy

The hub does what a proxy cannot: authentication, grants, rate limits,
audit. The proxy only needs to pass everything through unchanged. What it
must get right:

- the WebSocket upgrade on `/v1/agent`;
- `X-Forwarded-For` set by the proxy itself, with `--trust-proxy` on the
  hub, so lockouts hit the client and not the proxy;
- a body of at least 8 MiB on `/v1/panes/.../files` (the hub's limit),
  16 KiB suffices elsewhere;
- no buffering and a read timeout above 30 s on `/v1/events` and
  `/v1/admin/log`, which long-poll for up to 30 s, and above 90 s on
  `/v1/transcribe`, which waits for the transcriber;
- `Strict-Transport-Security`: the hub sets it only when it ends TLS
  itself, so behind a proxy the proxy must.

Caddy does most of this by default:

```
hub.example.com {
    header Strict-Transport-Security "max-age=31536000"
    request_body {
        max_size 9MB
    }
    reverse_proxy 127.0.0.1:7600 {
        flush_interval -1
        transport http {
            read_timeout 120s
        }
    }
}
```

nginx:

```nginx
server {
    listen 443 ssl;
    server_name hub.example.com;
    ssl_certificate     /etc/letsencrypt/live/hub.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/hub.example.com/privkey.pem;
    add_header Strict-Transport-Security "max-age=31536000" always;
    client_max_body_size 9m;

    location / {
        proxy_pass http://127.0.0.1:7600;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $http_connection;
        proxy_buffering off;
        proxy_read_timeout 120s;
    }
}
```

`$remote_addr`, not `$proxy_add_x_forwarded_for`: the hub must see the
address the proxy saw, never one the client wrote in a header of its own.

### Backup, upgrade, rotation

- **Back up** the hub's directory: `hub.key` (losing it means re-pairing
  every agent) and `hub.json` (paired agents, token hashes, users, the
  address lists). Browser sessions and the log ring live in memory and
  are gone with a restart: people sign in again. The agent's directory
  holds `agent.key` and `agent.json`; without them the host pairs again.
- **Upgrade** the hub first, then the agents: the hub answers an older
  agent, and a client learns what a host takes from the hosts list (see
  [feature detection](../protocol/v1.md#feature-detection)). The web
  client is embedded in the binary, so `go install
  github.com/notmarkopadjen/muxway/cmd/muxway@latest` (or a new release
  binary) upgrades everything at once; restart the service and reload the
  page.
- **Rotate a token** by creating the new one, putting it on the client,
  then revoking the old one by id: `muxway hub token create ...`,
  `muxway hub token list`, `muxway hub token revoke <id>`. Revocation is
  immediate and ends that token's browser sessions too. The same from the
  [admin overview](admin.md) in a browser.

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
