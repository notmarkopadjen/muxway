# Web client

Open the hub's address in a browser. The hub serves the client itself,
from files embedded in its binary, so there is nothing to install and
nothing but the hub to talk to.

![sign-in](images/web-signin.png)

## Using it

1. **Sign in**: with the identity provider the hub owner configured, or by
   pasting a token once. The token is sent to the hub and forgotten; a
   session cookie takes its place. See [signing in](sign-in.md).
2. **Panes**: every host you may reach, with its sessions, windows and
   panes. Offline hosts are dimmed. A badge marks a pane that needs you:
   `?` question, `!` permission, `…` idle, `✓` done. Type `/` to filter.
3. **Pane**: the content with its colours, refreshed every second, and an
   input line. Text is typed literally and Enter is sent after it; the key
   bar sends the named keys the protocol allows. Read-only panes say so.

![panes](images/web-panes.png)

![pane](images/web-pane.png)

Amber and paper, and the phone layout:

![amber](images/web-amber.png)
![paper](images/web-paper.png)
![phone](images/web-phone.png)

When an AI CLI in a pane calls for you (see
[notifications](notifications.md)) the badge appears, a toast slides in,
the tab title flashes until you come back, and, if you turned them on, a
browser notification names the pane while the tab is hidden. Typing into
the pane clears it.

## Keyboard

| Key | Does |
|---|---|
| `j` / `k` | move the selection down / up |
| `Enter` | open the selected pane |
| `Esc` | back to the panes; or leave the input line |
| `/` | filter panes |
| `i` | focus the input line |
| `g` then a letter | jump to the first host starting with it |
| `t` | next theme: green, amber, paper |
| `m` | effects on / off |
| `n` | browser notifications on / off (in the help overlay) |
| `?` | help |

Everything is reachable by touch too; on a phone the list and the pane
stack and the key bar wraps.

## Look and motion

Three themes, chosen with `t` and remembered by the browser: phosphor
green, amber, and paper for daylight. The page powers on like a tube,
scanlines and a faint vignette stay, glow sits on borders, headings and
anything focused, new lines in a pane burn in, badges for questions and
permissions pulse, and a theme switch re-syncs the picture. All of it is
CSS driven by tokens in `web/src/styles/tokens.css` and `motion.css`.
`m` turns the effects off, and the operating system's reduced-motion
preference does the same.

## Running without it

`muxway hub serve --no-web` leaves `/` to native clients: with a sign-in
provider configured it still sends a browser to sign in, otherwise it is a
404.

## Building it

The client lives in `web/` (React, TypeScript, Vite; see
`web/package.json`). `make web` rebuilds `web/dist`, which is committed
and embedded by `go build`, so `go install` needs no Node. CI rebuilds it
and fails if the committed output differs from the sources.

## Security considerations

- The client is a consumer of the API with the session cookie; it adds no
  endpoint. Its own risks are in the browser, and the hub's headers close
  them: a content security policy that allows only the client's own
  scripts, styles and fonts, no inline code and no other origin;
  `frame-ancestors 'none'`; `Referrer-Policy: no-referrer`;
  `X-Content-Type-Options: nosniff`.
- Pane content, titles, session and window names and event text are
  rendered as text. The colour renderer turns escape sequences into class
  names and drops everything else. Lint forbids injecting markup.
- The cookie is `SameSite=Strict` and useless without the client header,
  so a page on another origin can neither read nor use the session. The
  suite proves it from a second origin.
- No request ever leaves the hub's origin: no fonts, scripts or analytics
  from elsewhere. Browser notifications carry kind and address only.
- Node dependencies are pinned exactly with a committed lockfile and
  installed with `npm ci`. They are a build-time concern: the hub binary
  carries only the built files.
