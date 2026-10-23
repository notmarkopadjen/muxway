# Exposing panes

Nothing on a host is reachable through muxway until its owner says so.

## Commands

```sh
muxway expose -t work               # every pane of session "work", read-only
muxway expose -t work:1 --write     # every pane of window 1, readable and writable
muxway expose -t work:1.0 --write --name build   # one pane, with an alias
muxway expose -t work:1.2 --deny    # hide one pane inside an exposed window
muxway unexpose -t work:1           # remove the window's mark
muxway exposed                      # everything reachable right now, with its mode
```

Run them on the host, inside tmux or with `--tmux-socket` / `--tmux-name`.

## How marks work

A mark is a tmux user option, `@muxway-mode`, set on a session, a window or
a pane. tmux resolves it from pane to window to session, so:

- A mark on a session or window covers every pane in it, **including panes
  created later**. A new split in a writable window is writable at once.
- The most specific mark wins: `--deny` on a pane hides it inside an
  exposed window; `--write` on a pane makes it writable inside a read-only
  session.
- Marks live and die with what they are set on, and all of them vanish
  when the tmux server stops. A restarted server exposes nothing.
- Moving a window to another session keeps a mark set on the window and
  loses one inherited from the old session. Clients' grants are checked
  against the new address.

The agent re-reads the marks for every request. As a second guard it
refuses a pane whose process changed under the same pane id.

## What is safe to expose

- **Read** shows everything the pane shows, including secrets printed on
  screen and in scrollback (up to 2000 lines).
- **Write** is a shell. Anything typed runs as the host's user. Prefer
  exposing single panes for writing over whole sessions.
- `Escape` is among the keys a client may send, because AI command-line
  tools use it to interrupt. In editors it opens command mode, so a pane
  running an editor is as powerful as a shell.
- Do not expose a pane that is logged in elsewhere as a more privileged
  user (`ssh root@...`, `sudo -s`) unless that is exactly what you want.
