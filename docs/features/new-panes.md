# New panes and sessions

A client can only type into panes that exist. This lets a client **split**
a pane it may type into, so a second program runs next to the first, and
**start a session** for a fresh piece of work, where the host's owner
allowed it. Closing panes and sessions stays with the host: `exit` does it.

## Using it

**A new pane.** In the pane list, under the panes of a window where you may
type, a dim `+ pane` row; a click splits the window's active pane (or the
first one you may type into) and opens the new pane. The split goes beside
on a wide window and below on a tall one, as the host shows it. The new
pane runs the host's shell in the source pane's directory; the command row
then offers `claude` and the rest. Keyboard: `+` on a selected row.

**A new session.** At the right of a host's line, `+ session`, for hosts
whose agent runs with `--allow-sessions`. It opens a one-line form for the
name (`Enter` creates, `Esc` cancels); the session's first pane then opens.
Keyboard: `S`. The selector (`p`) lists `+ session on <host>` as well.

On the host:

```sh
muxway agent run --allow-sessions      # let clients start sessions (default: off)
muxway exposed                         # sessions clients started are listed, mode write
```

A session a client starts is named `[a-z0-9_-]{1,32}`, must not exist yet,
and runs the host's default shell, detached.

## How it works

```mermaid
sequenceDiagram
    participant C as Client
    participant H as Hub
    participant A as Agent
    C->>H: POST /v1/windows/{host}/{session}/{window}/panes {"direction": "v"}
    H->>H: a pane in the window the principal may type into?
    H->>A: split {pane, direction}
    A->>A: split-window; copy a pane-level mark
    A-->>H: the new pane as listed
    H->>H: write grant covers its address? else kill-pane
    H-->>C: 201 {"pane": {...}}
    C->>C: open it
```

The agent splits the pane with `split-window -d -c <its directory>`, so
the host's focus stays where it was. A mark set on the source pane itself
is copied onto the new pane; a mark on the window or session already
covers it (see [exposing panes](exposing-panes.md)). The hub then checks
the principal's write grant against the new pane's address and, when it
does not match, has the agent close the pane again: a grant for one pane
never grows into a window.

A session is `new-session -d -s <name>`, allowed only when the agent runs
with `--allow-sessions`. The agent marks the new session
`@muxway-mode = write`, in the open, so `muxway exposed` lists it like any
other. The hub asks only when the principal has a write grant matching
`host/<name>/*`.

Protocol: [`POST /v1/windows/{host}/{session}/{window}/panes`,
`POST /v1/hosts/{host}/sessions`](../protocol/v1.md) and the `sessions`
field of `GET /v1/hosts`.

## Security considerations

- A client can now start shells, not only type into them. A new pane runs
  as the host's user in a window the token may already write to: the same
  power as typing `tmux split-window` into that pane. The grant check on
  the new address keeps a one-pane token a one-pane token.
- A new session is a shell where nothing was exposed, so it needs the
  owner's `--allow-sessions`, a write grant for the name, and it is
  marked by the agent where the owner can see it.
- Names are validated on the hub and again on the agent, and passed to
  tmux as arguments, never through a shell. Sessions are started detached;
  nothing attaches.
- Caps: 8 panes per window, 32 live sessions per host started this way,
  one creation per two seconds per principal, a refused one included.
- Every creation is audited on both sides: who, host, window or name,
  result and the new pane's id; never a pane's content.
- The undo, `kill-pane`, is the hub's alone and reaches only a pane the
  agent made within the last 30 seconds. A client has no way to close a
  pane.
- No new dependencies; no change to the web client's content security
  policy.
