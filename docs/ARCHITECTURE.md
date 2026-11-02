# Architecture

This page is the entry point for anyone building a muxway client or
running muxway. The wire protocol is in [protocol/v1.md](protocol/v1.md);
each feature has a page under [features/](features/).

## Components

```mermaid
flowchart LR
    subgraph Clients
        W[Web client]
        AN[Android]
        G[Glasses]
        J[Java ME phone]
        X[Your client]
    end
    H[(Hub)]
    subgraph Host_1[Host]
        A1[Agent] --- T1[tmux server]
    end
    subgraph Host_2[Host]
        A2[Agent] --- T2[tmux server]
    end
    W -- "HTTPS, session cookie" --> H
    AN & G & J & X -- "HTTPS, bearer token" --> H
    A1 -- "WSS, outbound, signed + encrypted" --> H
    A2 -- "WSS, outbound, signed + encrypted" --> H
```

- **Agent** (`muxway agent run`): runs next to a tmux server. It connects
  out to its hub, so a host needs no open port. It answers the hub's
  requests for the panes its owner exposed (list, read, input, resize,
  split, files, git's view, an answer to a question) and enforces
  exposure and modes itself. It also listens on a socket for the
  processes in its panes (`muxway notify`, `muxway ask`) and watches the
  screens of the AI harnesses it knows.
- **Hub** (`muxway hub serve`): the meeting point. It pairs agents,
  authenticates clients by token, enforces each token's grants, routes
  requests to the right agent, keeps the event feed and the talk feed
  (writes that came from a pane) and lists what waits in the inbox.
- **Clients**: anything that speaks [the protocol](protocol/v1.md). Rich
  clients use JSON; small ones use **text mode**, which returns plain lines
  rewrapped to the width the client asks for, in UTF-8, Latin-1 or ASCII
  (see [text mode](features/text-mode.md)). `muxway client` and
  `muxway mcp` are clients too, for scripts and for the AI agents
  themselves. The native clients live in their own repositories:
  [muxway-android](https://github.com/notmarkopadjen/muxway-android),
  [muxway-glasses-even](https://github.com/notmarkopadjen/muxway-glasses-even)
  and [muxway-midp](https://github.com/notmarkopadjen/muxway-midp).
- **Web client**: served by the hub from embedded files at `/`; its
  tile arrangements and the lens that says what a pane is up to
  are browser state and never reach the hub; React, plain CSS, polling
  the API with the session cookie. See
  [features/web-client.md](features/web-client.md). What every client
  shows alike, and what belongs to one device, is in
  [ui-guideline.md](ui-guideline.md).
- **Notifications**: a process in a pane, such as the hooks of an AI
  coding agent (Claude Code, Codex, Gemini CLI, Antigravity CLI, Copilot
  CLI, OpenCode),
  runs `muxway notify`; for a harness without hooks the agent's watcher
  reads the screen; the agent marks the pane and the hub tells clients,
  and lists what waits in `GET /v1/inbox`. A process can also ask a
  question with fixed answers (`muxway ask`) and get the answer back. See
  [features/notifications.md](features/notifications.md) and
  [features/inbox.md](features/inbox.md).
- **Scripts and AI agents as clients**: `muxway client` is the API from
  the command line, `muxway mcp` the same as MCP tools, `muxway skill`
  the guide an agent reads; see [features/driving.md](features/driving.md).
  A write from a pane names its origin; the hub keeps those as talk
  entries, in memory like the events, and marks the panes as a group for
  every client; see [features/talk.md](features/talk.md). A message for
  an agent is mail: held by the host agent in a mailbox per pane, beside
  the questions waiting for answers, read over the agent's socket or
  handed over by the harness's hooks, never typed; see
  [features/mail.md](features/mail.md).

One binary, `muxway`, plays every role.

## The tmux model

```mermaid
flowchart TD
    S[session: work] --> W0[window 0: editor]
    S --> W1[window 1: logs]
    W0 --> P00[pane 0.0]
    W0 --> P01[pane 0.1]
    W1 --> P10[pane 1.0]
```

Sessions hold windows, which most people use as tabs; windows hold panes,
the splits. The **pane** is the unit of access: reading and typing always
target one pane. Listings carry the whole hierarchy, including each window's
layout, so a client can group panes like tmux, show them flat, or mirror
tmux's own split. A pane's address is `<host>/<session>/<window>.<pane>`,
where the window is its index or name, for example `alice-laptop/work/1.0`
or `alice-laptop/work/logs.0`. A pane can also get a short alias:
`alice-laptop/@logs`.

## Trust boundaries

```mermaid
flowchart LR
    C[Client] -->|token: grants, expiry| H[Hub]
    H -->|pinned keys, encrypted channel| A[Agent]
    A -->|marks: read, write, deny| T[tmux]
```

Three independent checks stand between a client and a shell:

1. **The principal's grants** at the hub: which host, session, window and
   pane patterns it may read, and which it may write. A principal is a
   token, or a user who signed in through an identity provider and holds
   a session cookie; see [features/sign-in.md](features/sign-in.md).
2. **The marks** on the host, set by its owner with `muxway expose`. A pane
   with no mark, or marked `deny`, does not exist for muxway.
3. **The agent's own enforcement.** The agent re-reads the marks for every
   request and refuses anything unexposed or read-only, whatever the hub
   asks. A compromised hub reaches only what the owners exposed.

Hub and agent authenticate each other with Ed25519 keys pinned at pairing,
and agree a fresh session key per connection; every message after that is
encrypted and authenticated end to end. A TLS-terminating proxy in front of
the hub can see client traffic but not the hub-agent channel.

Ahead of all three, a hub may keep address lists that refuse a client
before any credential is read, and a principal with the admin grant can
read the hub's log and manage tokens, sessions and the lists; see
[features/admin.md](features/admin.md).

Details: [features/hub-and-agent.md](features/hub-and-agent.md) and
[features/exposing-panes.md](features/exposing-panes.md).

## Flows

### Pairing

```mermaid
sequenceDiagram
    participant O as Owner
    participant H as Hub
    participant A as Agent
    O->>H: muxway hub pair-code --host alice-laptop
    H-->>O: code: hub URL, hub public key, code id, secret (10 min, single use)
    O->>A: muxway agent pair CODE
    A->>A: create agent key
    A->>H: POST /v1/pair: alias, agent public key, HMAC(secret, alias + key)
    H->>H: check code, 3 attempts at most, then burn it
    H-->>A: hub signature over alias + agent key
    A->>A: verify with the key from the code, pin it, save agent.json
```

### Agent connection

```mermaid
sequenceDiagram
    participant A as Agent
    participant H as Hub
    A->>H: WebSocket upgrade, GET /v1/agent
    H->>A: hello: hub nonce, hub ephemeral X25519 key
    A->>H: alias, agent nonce, agent ephemeral key, Ed25519 signature over the transcript
    H->>H: verify with the registered agent key
    H->>A: Ed25519 signature over the transcript
    A->>A: verify with the pinned hub key
    Note over A,H: both derive two AES-256-GCM keys (HKDF over the X25519 secret)
    H->>A: request (encrypted)
    A->>H: response (encrypted)
```

```mermaid
stateDiagram-v2
    [*] --> Connecting
    Connecting --> Handshake: TLS + WebSocket up
    Handshake --> Ready: both signatures valid
    Handshake --> Backoff: invalid or timeout
    Ready --> Backoff: connection lost
    Backoff --> Connecting: 1 s doubling to 60 s, with jitter
```

### Reading and typing

```mermaid
sequenceDiagram
    participant C as Client
    participant H as Hub
    participant A as Agent
    participant T as tmux
    C->>H: GET /v1/panes/alice-laptop/work/1.0 (Bearer token)
    H->>H: token valid? host visible? rate limit
    H->>A: list (cached 1 s)
    A->>T: list-panes
    A-->>H: exposed panes only
    H->>H: resolve address, check read grant
    H->>A: read pane %3, 100 lines
    A->>A: still exposed, same process?
    A->>T: capture-pane
    A-->>H: content
    H-->>C: JSON, or text folded to charset and rewrapped to width
    C->>H: POST .../input {"text": "make test"}
    H->>H: text has no control characters, write grant, pane mode write
    H->>A: input pane %3
    A->>A: exposed for write? audit
    A->>T: send-keys -l
    H-->>C: 204
```

### Notifications

Any AI coding agent's hook or wrapper enters at `muxway notify`
(`muxway hooks <harness>` prints the configuration for Claude Code,
Codex, Gemini CLI, Antigravity CLI, Copilot CLI and OpenCode); the flow below shows Claude
Code's hook.

```mermaid
sequenceDiagram
    participant CC as Claude Code
    participant N as muxway notify
    participant A as Agent
    participant H as Hub
    participant C as Client
    C->>H: GET /v1/events?after=11&wait=30
    CC->>N: Notification hook, JSON on stdin, $TMUX_PANE=%3
    N->>A: {"pane":"%3","kind":"permission","text":"..."} over notify.sock
    A->>A: %3 exposed? same process? record attention
    A-->>N: ok
    A->>H: event (encrypted, unasked)
    H->>H: validate, rate limit, seq 12, wake waiters
    H-->>C: {"events":[{"seq":12,"address":"alice-laptop/work/1.0",...}],"next":12}
    C->>H: GET /v1/panes
    H-->>C: work/1.0 carries attention {kind: permission}
    C->>H: POST /v1/panes/.../input {"text":"y"}
    H->>A: input %3
    A->>A: typed, attention cleared
```

### The watcher

For a harness without hooks the agent reads the pane's visible screen
every two seconds and reports a change of state with a fixed phrase; a
pane whose hooks have spoken is left to them.

```mermaid
sequenceDiagram
    participant T as tmux
    participant A as Agent (watcher)
    participant H as Hub
    loop every 2 s, per exposed pane running a known harness
        A->>T: capture-pane (visible screen)
        A->>A: changed? a prompt at the bottom? still 8 s at the input prompt?
        A->>H: event working / permission / question / done, on a change only
    end
```

### A question with fixed answers

```mermaid
sequenceDiagram
    participant P as muxway ask (in a pane)
    participant A as Agent
    participant H as Hub
    participant C as Client
    P->>A: question "deploy?", choices [yes, no], over notify.sock, held open
    A->>H: event question with choices, the listing carries them
    H-->>C: GET /v1/events, GET /v1/inbox
    C->>H: POST /v1/panes/alice-laptop/work/1.0/answer {"choice": "yes"}
    H->>H: write grant? the choice clean? audit
    H->>A: answer %3 "yes"
    A->>A: a question pending? "yes" among its choices? clear attention, audit
    A-->>H: ok
    H-->>C: 204
    A-->>P: yes (stdout, exit 0)
```
