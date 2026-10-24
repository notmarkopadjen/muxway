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
   panes. Each row leads with what runs in the pane and ends with the
   address; offline hosts are dimmed. A badge marks a pane that needs
   you: `?` question, `!` permission, `…` idle, `✓` done. Type `/` to
   filter.
3. **Pane**: the content with its colours, refreshed every second, and an
   input line. The screen opens at its bottom and follows new output;
   scroll up to read back, and it stays put until you scroll down again.
   Text is typed literally and Enter is sent after it; the key bar sends
   the named keys the protocol allows. Read-only panes say so.

![panes](images/web-panes.png)

![pane](images/web-pane.png)

Amber and paper, and the phone layout:

![amber](images/web-amber.png)
![paper](images/web-paper.png)
![phone](images/web-phone.png)

## What a pane is called

Everywhere a pane is named, in the list, the pane header, the tab title,
the window view, boards and the selector, it is named by what runs in
it, not by tmux: the command, and after it what the program says about
itself in the pane title when that adds something (`vim · notes.md`).
A pane running **Claude Code** is named *Claude*, with its mark, and the
status Claude writes into the title follows (`Claude · fixing the
build`); it is recognised by its command, or by the spark Claude Code
puts first in its title when it runs under another command. The tmux
address, session and window names come second, dimmed, so you can still
tell panes apart.

![a pane running Claude](images/web-titles.png)

When an AI CLI in a pane calls for you (see
[notifications](notifications.md)) the badge appears, a toast slides in,
the tab title flashes until you come back, and, if you turned them on, a
browser notification names the pane while the tab is hidden. Typing into
the pane clears it.

## Fit: the host follows the browser

A terminal tells tmux its size; the browser does the same when **fit** is
on (`f`, or the button in the header). In the pane view the *pane* on the
host becomes the columns and rows that fit the box: where it spans its
window, the window is sized; where it shares the window with neighbours,
they give or take the difference, and the window grows only when they
would have nothing left. In the window view, fit sizes the whole
*window* to the area and lays it out as the browser shows it: the panes
keep their proportions until you drag a divider, and then the host's
split follows the divider, so every pane is shown one to one and none
is left with empty rows. Fit is on by
default for a single pane you may write to, because a resize changes what
the person at the host sees, and off by default in the window view.
Leaving a fitted view gives the window back to tmux's automatic sizing
and the panes back to the layout they had. With fit off, the pane keeps
the host's size and is scaled to the box instead.

![fit](images/web-fit.png)
![fit in the window view, a divider dragged](images/web-window-fit.png)

## The window view

A window row in the list, the `▦` entries in the selector, or `window ▸`
in a pane header open the **window view**: every pane of the window you
may read, in tmux's own layout, each scaled to its box. One pane is
focused (click, or `]` and `[`); the input line and key bar go to it,
`Enter` opens it alone. Double-click a pane, or press `z`, to show it
alone in the view, and again to bring the others back; `]` and `[` move
the zoom with the focus. Then, in the browser only (with fit on, a
dragged divider reaches the host, see above):

- drag a divider to change the split,
- `+` and `-` to make the focused pane's text bigger or smaller,
- `x` to hide the focused pane (the bar above brings it back),
- `0` to return to the host's layout.

The arrangement is remembered per window in your browser, and dropped
whenever tmux's own layout changes, so the view never shows a stale
picture; with fit on, a change of sizes alone is the browser's own
doing and keeps the arrangement. A pane you may not read shows as a
gap.

![window](images/web-window.png)
![window, rearranged](images/web-window-local.png)

## The selector

`p`, or `≡` in the header, opens the selector over any view: type part
of an address, alias, command or title; panes that need you come first;
`Enter` jumps. Windows with more than one pane are listed too.

![selector](images/web-selector.png)

## Boards: your own arrangement of panes from anywhere

The window view is the host's arrangement. A **board** is yours: panes
from any window, session or host, side by side as you like, kept in this
browser only. `b` opens the main board (`/b/main`); from a pane, `b` puts
that pane on it first. The selector lists every board with `▤`, and
`board <name>` typed there makes a new one.

On a board, `a` adds a pane beside the focused one and `A` below it,
through the selector, which offers only panes not yet on the board. `x`
takes the focused pane off (the pane itself goes on), `s` swaps it with
the next, and dragging a cell's header onto another cell swaps the two.
Dividers drag, `+` and `-` scale the focused pane, `=` gives every split
equal shares, `z` or a double-click shows a pane alone and back, `Enter`
opens the focused one on its own, `w` opens its window view. `]` and `[` move focus; the input
line and the key bar go to the focused pane. A pane that is gone, or not
yours to see, shows a gap with a `remove` button.

Fit on a board is per pane: `f` sizes the focused host pane to its cell,
`F` turns fit on or off for every writable pane. It is off by default,
because several host windows changing at once is a decision for you.

![board](images/web-board.png)
![board, rearranged](images/web-board-arranged.png)

## Keyboard

| Key | Does |
|---|---|
| `j` / `k` | move the selection down / up |
| `Enter` | open the selected pane |
| `Esc` | back to the panes; or leave the input line |
| `/` | filter panes |
| `i` | focus the input line |
| `p` | selector: go to a pane or window |
| `f` | fit: the host pane (window view: the window) follows the box |
| `b` | the main board; from a pane: put it on the board first |
| `a` / `A` | board: add a pane beside / below the focused one |
| `x` / `s` / `z` / `=` / `F` / `w` | board: remove, swap, zoom, equal shares, fit all, the pane's window |
| `]` / `[` | window view: next / previous pane |
| `x`, `z`, `0`, `+`, `-` | window view: hide, zoom (or double-click), host layout, bigger, smaller |
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
- A resize is a write on the host: it needs the write grant and the write
  mark, is audited with its size, and is limited to one per second per
  window. A browser arrangement reaches the host only with fit on, as the
  proportions of a window resize; the hub parses the layout and the agent
  accepts one that names exactly the window's panes, nothing else.
- The cookie is `SameSite=Strict` and useless without the client header,
  so a page on another origin can neither read nor use the session. The
  suite proves it from a second origin.
- No request ever leaves the hub's origin: no fonts, scripts or analytics
  from elsewhere. Browser notifications carry kind and address only.
- Node dependencies are pinned exactly with a committed lockfile and
  installed with `npm ci`. They are a build-time concern: the hub binary
  carries only the built files.
