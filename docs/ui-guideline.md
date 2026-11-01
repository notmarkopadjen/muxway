# UI guideline: one product on every client

muxway has several clients, and a person moves between them during one
day: the browser at the desk, the phone on the way, the glasses, the
feature phone. They must feel like one product. This page is the single
place that says what every client shows and how, which parts are shared
and which belong to one device, and what to change where when a feature
moves.

**The rule**: a change to anything in the *shared* section is made in
every client that has the feature, in the same change set, with each
repository's docs updated. A change that only one client can make
belongs in that client's section and says why. Before touching a tab
strip, a header, a key binding or a layout in one client, open this page
and the matching table.

Repositories: the web client lives in the core (`web/`); the Android
client in [muxway-android](https://github.com/notmarkopadjen/muxway-android);
the glasses and MIDP clients in
[muxway-glasses-even](https://github.com/notmarkopadjen/muxway-glasses-even)
and [muxway-midp](https://github.com/notmarkopadjen/muxway-midp). Each
client's `AGENTS.md` points here.

## 1. Shared: what every client shows

### 1.1 Naming a pane

| Where | Content |
|---|---|
| name | what runs in the pane: the command, then what the program says about itself in the title when that adds something (`vim · notes.md`) |
| Claude Code | recognised by its command or by the spark it puts first in its title; named *Claude*, with its mark; the status it writes (the "codename") follows: `Claude · fixing the build` |
| the other AI CLIs | recognised by their command (Codex, Gemini, Antigravity `agy`, OpenCode, Copilot, aider, goose, Amp, Cursor) or their name in the title under an interpreter; named, and Codex and Antigravity have marks of their own (a hexagon, a lifted chevron) wherever Claude's spark shows; the title follows as the status |
| tab | the codename alone for Claude Code, else the name |
| place | the tmux address `host/session/window.pane`, dimmed, second to the name |
| status style | the codename and any program status are set in *italics*, dimmer than the name |

Web: `web/src/term/describe.ts`, `components/PaneTitle.tsx`.
Android: `Lens.name`, `Pane.name`.

### 1.2 The lens

A lens knows one AI coding agent's screen and says what its pane is up
to. Every client names the same harnesses from the pane's command and
title (Claude, Codex, Gemini, Antigravity, OpenCode, Copilot, aider,
goose, Amp, Cursor; the Claude Code lens, which reshapes the screen, is the one
there is) and paints with the same three states and the same marks.

| State | When | Glyph | Word | Paint |
|---|---|---|---|---|
| waiting | the listing carries a notification, except an `idle` one while the screen still moves (then: working) | `!` permission, `?` question, `z` idle, `✓` done | the kind | the theme's ink, inverted (ink ground, background letters), pulsing |
| working | a named harness: last event `working`, or the open pane's screen changed in the last 10 s; a change the client caused (first read, its own resize or input) does not count; on start the client reads the hub's recent events | `⟳`: a turning ring, drawn, the same in every font | `working` | dim |
| quiet | otherwise | none | none | plain |

Selection is never a colour: an open or focused element has a border
(thick when focused) and its name in bold, so the state shows on the
pane you are looking at. tmux's own activity flag is not used.

**Talk** is beside the state, not one of them: panes whose listing
carries `talk` (they wrote or mailed to each other in the last ten
minutes, partners of partners included, see
[features/talk.md](features/talk.md)) form a group, drawn as one frame
in the talk hue (§1.5) around their tabs, their tiles and their rows,
like a browser's tab group, with the rows and tabs of a group kept
together. A pane whose process has unread [mail](features/mail.md)
carries `✉ n` after its name, in the hue. The state's paint wins on a
painted header: the count is drawn in the background colour there like
every mark.

Wherever a pane is shown in a cell among others (tiles, the window
view), its header is painted with the state, and a **waiting** pane's
cell glows in the theme's ink: a shadow around it, pulsing with
effects on, drawn outside the layout so no neighbour moves or resizes.

Web: `web/src/term/lens.ts`, `components/Lens.tsx`. Android:
`protocol/Lens.kt`. Feature pages: core `web-client.md` (The lens),
Android `lenses.md`.

### 1.3 The pane list

```
── alice-laptop ──────────────────────── + session · online ──
  [ ] * ⟳ fixing the build     alice-laptop/work/0.0   working
  [ ]   bash                   alice-laptop/work/0.1
  │  + pane
```

| Element | Shared behaviour |
|---|---|
| grouping | by hub, then by host, host state (`online`, `offline`, `nothing exposed`) on the group's line; offline hosts dimmed. With one hub the hub level is not drawn; with several every hub the client holds a credential for is listed, its name on its own line (`═══ work ═══`), a hub that cannot be reached or is not signed in with the reason beside its name and nothing under it (web: a *sign in* link to that hub's own page). Panes of two hubs never mix inside a host group: a host is listed under the hub it belongs to |
| row | write mark `*`, the lens glyph, the name, the place, the lens word |
| open | a tap or click opens the pane alone |
| pick | several panes, up to four, open side by side: Android hold, web `[ ]` box or `space`; a bar under the list offers *clear* and *open N side by side*; with a pick on, a tap adds or removes |
| `+ pane` | a dim row under a window's panes when one of them is writable; a tap splits the window (beside on a wide pane, below on a tall one) and opens the new pane |
| `+ session` | at the right of the host's line, for a host whose agent allows it (`sessions` in `GET /v1/hosts`; the web also wants a write pattern of `/v1/me` naming the host); asks for a name (web: a one-line form, Android: a dialog) and opens the session's first pane; the hub's answer decides |
| refresh | re-read every 15 s (Android) or 5 s (web), and at once on any event |

Web adds the tmux tree (session, window) and a button per window that
opens the window view; see §2.

### 1.4 The pane view: strip, tiles, input

```
┌─ muxway ─┐ [⟳ build][! review][logs] [+]   [▦][⤢][⊡][≡]  [alice ▾]
┌ header: glyph name · command · mode   word  size   _ × ┐
│ content                                                │
└────────────────────────────────────────────────────────┘
[? deploy][hub.log]                        ← the minimised row
[Esc] [Tab][S-Tab][^C][↑][↓]…           [Enter]
$ [exit][htop][claude][codex]…  │ [make test]
> ______________________________ [type] [send]
```

| Element | Shared behaviour |
|---|---|
| back | the brand at the left of the header row returns to the list (web); `‹` (Android) |
| header row | web: one row, the brand, the strip, `+` right after the last tab (see *add menu*), the pane buttons at the right as 32 px squares with a label under the pointer (`▦` `⤢` `⊡` `≡`), and the profile button with the principal's name (*hubs*, *help*, *admin* for an admin, *logout*); nothing in it repeats the pane's name. On a narrow screen (640 px and under) the pane buttons fold into one `⋯` button that opens a menu with the same entries, and the profile button shows only its caret. Android keeps its own top row: `‹`, the strip, `+` after the last tab, `▦` `⊡` `⤢` `abc` `⚙` |
| add menu | `+` after the last tab opens a menu, built from the listing the client holds, in this order: **+ pane** (one more pane beside the focused one on its host, where the token may type there), **+ session** (on the focused pane's host, where its agent starts sessions), a rule, the **minimised** panes (see *minimised row*), a rule, every other readable pane the client is not showing, grouped by hub (with several), host and session in listing order, each as its glyph and name with its place dimmed after it. The focused pane and the open tiles are not listed. An entry the token or the host does not allow is dimmed with the reason (*read only*, *no sessions here*). A pane picked becomes one more tile, focused; with four tiles the menu's heading says *four open: a pick replaces <focused>* and the pick swaps into the focused tile, as a tab does. `+ pane` and `+ session` ask the hub; a pick asks nothing. Web: `+` key opens it, `Esc` closes; Android: a tap, back closes |
| strip | every readable pane in listing order, or on the web in the order the owner dragged them into (kept in the browser; the dragged tabs first, the rest in listing order, a new pane last; the window view keeps the host's order), named as §1.1 says, painted as §1.2 says, Claude's mark on every Claude pane with the state glyph beside it, the tabs of a group of §1.2 side by side inside one frame in the talk hue, a joining tab pulled next to the group's earliest, the pull kept in the owner's order, a tab dragged out let go until the group's next message, air between two frames, `✉ n` after the name while the pane's process has unread mail (web; Android, glasses and MIDP follow up); open tabs bordered, the focused one thick and bold; a closed tab tapped swaps into the focused tile; tabs keep their width, the strip scrolls sideways and keeps the focused tab in view; on the web the wheel over it moves it and `‹ ›` at its ends appear while there is more than fits |
| tiles | one to four panes; a pane that exits leaves the view by itself (the others close up; alone, back to the list); arrangements by count: 2 → row, column; 3 → + main-left, main-top; 4 → + grid; `▦` cycles; wide screens start with row, tall with column; splits drag with a 15 % floor; a header dragged onto another tile's middle swaps the two, onto its upper, lower, left or right part splits that tile's place that way with the dragged pane on that side, its old place closing up and every share equal again; `▦` goes back to the presets; tiles may come from any hosts, sessions and windows; the arrangement is the client's own, except when the tiles are every pane of one window: then they open as the host has it, follow it, and what is changed here moves the panes on the host (needs every pane writable, otherwise they only follow); a header dropped on a divider lays the pane across that split; a click on the strip inside a tile's inner edge lays it across the whole view (web); every tile of a group of §1.2 is framed in the talk hue, the divider between two of them beside each other painted with the chain at its middle, and `L` or the header's chain lays the partner beside the focused tile; tiles never move by themselves (web, see §1.6) |
| header | painted like its tab: glyph, name, command, mode, the chain when the pane is in a group (web; a click lays the partner beside) and `✉ n` while its process has unread mail, the word, the size, then `_` (minimise, see *minimised row*; off on the last tile) and `×`; the focused tile has the thick border and bold name; on the web the header is a 36 px row (twice a line) and carries, at its right before `×`, the count of the repository's changes for a writable pane of a host with preview roots (`⎇ +3 ~5 −1`, `⎇ ✓` when clean, nothing outside a repository; asked every ten seconds), a click on which opens the changes window. Controls live in the header row (web) or the top row (Android), not in tile headers: `▦` arrangement, `⤢` fit (web: for the focused tile), `⊡` zoom; on a narrow web screen (640 px and under) they fold into one `⋯` button whose menu has the same entries |
| minimised row | `_` on a tile's header takes the tile out of the arrangement and puts its tab in a row right above the key row, painted like a tab (glyph, name, the state's colours) and still read every two seconds, so its glyph keeps moving; its tab leaves the strip while it is below. A tap or click on it brings the tile back, focused; the add menu lists it too. The last tile cannot be minimised. The row is not drawn while it is empty. Minimised panes belong to the view's arrangement and are forgotten with it (leaving the view, a reload); the fit of a minimised pane is released like a closed tile's |
| fit | per tile; every writable tile opens with fit on, one or several; `⤢` or `f` toggles, `r` sends the size again (web); leaving the view releases. The host never lets a fit take a neighbour under 20 columns or 5 rows: the window grows instead. **One fit per window:** open tiles that are every pane of one tmux window fit the window as one, with the arrangement as its layout, as the window view does, so each pane is its tile; the layout is exact, each pane as many cells as its tile's screen holds, so no pane is given rows its tile cannot show: the tiles of a stack lose a header each, and a tile across from them keeps that much spare. Where only some of a window's panes are open as tiles, each fits its own pane, and the host sorts the neighbours out (they give or take, the window grows before any goes under the floor); a tile whose size the host would not give, because another tile's fit shares the axis, says *held* in its header and is drawn scaled to its box until its box changes. A tile whose fit is in flight says *sync* until the pane is at size (web). The focus plays no part: moving it sends nothing. Every fitted pane is released when the view is left. **A pane alone** in the view fits its *window* with the pane zoomed over its siblings (tmux's own zoom), so no neighbour is squeezed; a pane left for another in the view stays at size and is not sent again when it comes back at that size |
| input | a text line and one key row for the focused tile; `Esc` pinned left and `Enter` right on a phone; *type* sends text, *send* sends text then Enter; read-only panes show `read-only` and no way to type. The line is a small editor: text wraps and the field grows upward, to six rows, then scrolls inside; Enter (web) or the keyboard's send key (Android) sends, Shift+Enter starts a new line; a text with several lines reaches the pane as one paste, bracketed when the program asked. While the first word is typed, and nothing follows it, a list above the line offers the agent's slash commands (Claude Code's, Codex's, Antigravity's) or a shell's starters, each AI starter with its mark, and the lines sent before; any word two letters in is also completed from the words on the pane's screen, newest first, after the commands and marked `⇥`; eight at most, never anything from another pane or the hub; the web picks with `↑` `↓`, takes with `Tab` or a click, closes with `Esc` and sends a highlighted command with Enter (a screen word is only taken, Enter sends the line as typed), Android offers a row and takes with a tap. **Microphone**: when the hub has a transcriber (`GET /v1/transcribe` is 204, asked once per sign-in) and the focused pane is writable, a `◉` button sits between the field and *send*; without a transcriber, or on a read-only pane, there is nothing. A press opens the mic and the field's place shows a level meter in block characters and the seconds; `■`, a press on the meter, or sixty seconds stops the clip, which goes to the hub as a WAV and comes back as words on the line, after a space when something is typed there, with the caret at the end and the line focused: nothing is sent until Enter. `✕` (cancel), in the place of `⏎`, or `Esc` drops the clip. The mic is closed the moment recording stops. Refusals are toasts: `microphone refused`, `no microphone`, `too short`, `one clip every five seconds`, `transcriber unavailable` **Files**: where the host's agent has an inbox (`GET /v1/panes/{address}/files` is 204) and the pane is writable, `⇪` sits beside the microphone; a file picked, pasted or dropped goes to the host and its path lands on the line with a space after it, focused, unsent; while it goes the line reads `⇪ name · size…` **Icons**: right of the line, in this order, `⌨` keyboard, `⇪` files (where there is an inbox), `◉` microphone (where there is a transcriber), `⏎` send; square buttons of one size, titled. **Keyboard**: `⌨` opens a window over the view for the focused pane (its title names the pane and follows the focus), with a big terminal board of the old kind and no brand: F1–F24 in two rows (F13–F24 go as Shift+F1–F12), the main block with every printable ASCII key and its shifted legend, both Shifts, Ctrls and Alts, Caps Lock, the navigation keys, the arrows in an inverted T, a keypad with Num Lock, and a column of command keys (*Attn* `C-c`, *Clr* `C-l`, *EOF* `C-d`, *Susp* `C-z`, *Kill* `C-u`, *Word* `C-w`, *Home* `C-a`, *End* `C-e`, *Rev* `C-r`, *Back* Shift+Tab). A click sends at once; Shift, Ctrl and Alt latch for the next key and a double click locks them; a cap lights when pressed and shakes when refused. Keys a terminal cannot carry (Super, Fn, Print Screen, media keys) are not drawn; Ctrl or Alt with `;` is dimmed; on a host whose agent lists no `keys: 2`, the keys only the grammar has are dimmed. The window drags by its bar and folds to it (web); on a phone it takes the bottom of the screen. Read-only panes: the icon is off |
| key row | one row, scrolling sideways, never wrapping, no scrollbar; keys tinted by group, discreetly (border and ground, never the ink): editing, direction, control, function |
| command row | one row under the key row, scrolling sideways, never wrapping, no scrollbar, tinted by tone the same way (danger red, start green, info blue, the rest amber), for the program in the focused pane. Claude Code (the lens decides): `/clear` `/exit` `/compact` `/rename` `/model` `/resume` `/usage` `/context` `/help` and sixteen more of its slash commands (`web/src/term/commands.ts`), marked with Claude's spark. A shell (`bash`, `zsh`, `fish`, `sh`, …): `exit` `htop` `claude` `claude -c` `codex` `gemini` `git status` `ls` `clear` and the git, make, npm, docker and tmux starters beside them, marked `$`, then after a bar the last eight lines sent to a shell from this client, newest first. A button sends its command then Enter; `/rename` fills the input line and waits. Any other program: no row. A read-only pane cannot use it |
| mouse | a tap or click on a pane whose program asked for the mouse is a left click at that cell; otherwise it only focuses. The same program gets the wheel: a notch per row of travel (web: the wheel; Android: a vertical drag), the notches of one movement gathered into one `wheelup` / `wheeldown` request with a `count` (50 at most) at the cell under the pointer, the next movement's waiting for it, so a long scroll is a few requests and the program keeps up with the hand. A pane without the mouse scrolls in the client, through the history the hub sent |
| links | a web address in a pane's text, `http` or `https` and nothing else, is a link: underlined dotted, in the colours the pane gave it; a program may name the address itself (OSC 8, as Claude Code does for a work item or a file): the label is the link, the address shows on hover, and the same schemes and nothing else; a click (web) or a tap (Android) opens it in the browser in a new tab and sends nothing to the host, mouse mode or not; the punctuation after it stays text, a bracket it opened stays in; an address wrapped onto a second row opens up to the row's end; a path of the host's inbox (`…/20261025-102235-56fwge.png`) is a link too, and on a host with preview roots any path with a slash or from `~` ending in a shown extension, in a writable pane: the file opens in a window over the page (web) or a sheet (Android) with its size and a download, text as text, an image as itself, a PDF framed; the host serves an inbox file by name only and a path only from under its roots |
| reading | the focused pane every second, the others every two |

Web: `web/src/pages/Pane.tsx`, `term/tiles.ts`, `term/commands.ts`,
`term/complete.ts`, `components/InputPanel.tsx`, `components/CommandBar.tsx`. Android: `ui/ViewScreen.kt`, `Layout`,
`protocol/Commands.kt`. Feature pages: core `web-client.md`
(Tiles), Android `pane-view.md`.

### 1.5 Look

Tokens are shared; the values are in the core at
`web/src/styles/tokens.css` and mirrored in Android's `ui/Theme.kt`.

| Token | Amber | Green | Paper |
|---|---|---|---|
| background | `#0a0603` | `#050806` | `#f1ead8` |
| panel | `#140b05` | `#0a120c` | `#e8dfc8` |
| ink | `#ffb000` | `#39ff14` | `#1f2a1f` |
| dim · faint | `#a06c00` · `#4a3200` | `#1f8f14` · `#0f4a0c` | `#5a6a5a` · `#b9b39f` |
| attention · alert | the ink, inverted · `#ff3b3b` | the ink, inverted · `#ff3b3b` | the ink, inverted · `#a3161b` |
| Claude | `#d97757` | same | same |
| talk | `#ff5c3a` | `#ff6b5e` | `#b4301e` |

Amber is the default on every client (the owner prefers it for the
eyes); the web cycles amber, green, paper with `t`. The browser tab's
icon is drawn in the theme's colours: `icon.svg` is the amber one,
`icon-green.svg` and `icon-paper.svg` the others.
No theme has a second hue for states: a waiting pane is the theme's own
ink drawn inverted, working is dim, quiet is plain (decided by the owner
on 2026-10-25). The alert colour is for errors only; the key and command
rows keep their group tints.

**The watch is the exception** (decided by the owner on 2026-10-25): its
face, its complications and its app draw a waiting pane in an attention
hue — `#ffd36b` in amber, `#ffb000` in green, `#9a5b00` on paper — and
not inverted. A watch face is always on, where a filled ink bar is
burn-in and battery, and a complication is drawn by whatever face it sits
in, which muxway does not own and which honours no inversion of ours. The
glyph carries the state there; the hue follows it. Working stays dim and
quiet plain, so the three states stay apart. The exception is the watch's
alone: every screen that is looked at on purpose inverts.

**Code is the other exception** (decided by the owner on 2026-10-30):
in a file shown over the pane and in a fenced block of rendered
Markdown, strings, numbers, keywords and names each carry a hue of
their own, per theme, and glow in it; comments and punctuation stay the
dim ink, keywords bold as well. The hues are the key rows' tints
(amber: strings pale green `#a8e6a0`, numbers cyan `#3ad6ff`, keywords
orange `#ff7a1a`, names violet `#c68cff`; green: strings yellow
`#ffd36b`, the rest the same; paper: `#0b5d1e`, `#0b4f8a`, `#9a5b00`,
`#5b2d8a`, no glow). The screen's filters lie over the window as over
everything. Nothing else on a page is coloured by the hue.

**Talk is the third exception** (decided by the owner on 2026-10-31,
"reddish but in theme", and on 2026-11-01, "grouped in one border, like
a group in Chrome tabs"): panes that talked lately are framed as one
group in the talk hue, a red that leans toward each theme's ink and
stays apart from the alert red, which keeps meaning an error. It is a
relation between panes, not a state of one, which a glyph alone cannot
draw across a divider: the frame around a group's tabs, tiles and rows,
the chain on the header and the divider, the mail counts, the messages
window's names and the count beside the brand carry it, and nothing
else does. No message is a notification: nothing pops up for one.

Pixel font (Press Start 2P) for the brand and panel titles, monospace
for everything else. Effects, on by default and off by a setting: glow,
scanlines, vignette, power-on, pulsing marks, inverted selection, and on
the web every move of the tiles drawn as a CRT change (a tile that
moves slides with a retrace, one that leaves switches off to a line, one
that comes powers on, the zoomed tile switches off, travels and opens
where it lands; the window view's cells the same). A tile waiting for the
host to give its size says *sync* in its header, its last picture a
little dim with a band rolling down it; off, the word alone. Sharp
corners, box drawing, no gradients.

### 1.6 Actions and their triggers

The same action on every client, triggered the way the device does it.

| Action | Web key | Android | Glasses / MIDP |
|---|---|---|---|
| back to the list | `Esc`, the brand | `‹`, system back | back |
| open the selected pane | `Enter` | tap | select |
| pick several | `space`, `[ ]`; Shift+click a tab opens it beside | hold; a tab held opens it beside | — |
| next / previous pane: the tile, or with one tile open the strip's neighbour shown in it, coming round at either end | `]` / `[` | tap the tile, swipe | D-pad left / right |
| move the strip | wheel over it, `‹ ›` | drag | — |
| reorder the strip: a tab to another place, kept across reloads | drag a tab along the strip (a mark shows where it lands); `}` / `{` move the focused pane's tab one place right / left | — | — |
| scroll a program that has the mouse | wheel over it | drag | — |
| copy a block of the screen (a bar's rows, a bullet and its rows, a result), without its markers | hover it, click `⧉` at its first row | long press | — |
| type into the pane: with a fine pointer a click on the screen turns direct typing on; a tap on the row its program waits on (the cursor's row) focuses the line | click (direct typing), tap (the line) | tap | — |
| direct typing: every key to the focused pane as pressed, `Esc` included, but `Ctrl+V` and `Shift+Insert`, which paste as in a terminal (text to the pane, a file to the inbox); the prompt shows `▮`, the status bar says so, the cursor is drawn as a block; a read-only tile focused ends it | `i`, a click on the tile, `▮`; `Shift+Esc`, a click on the line or `▮` leaves | a hardware keyboard with the *hardware keyboard* setting on, while the line is not focused (the status line says `direct`); a tap on the line leaves, back from the line returns | — |
| next arrangement | `l`, `▦` | `▦` | — |
| equal shares in every split (the host follows for one window's tiles with fit on) | `=`, `⊞` | `▦` held | — |
| close the pane on its host, asking on the header (`y` / `n`; `close the pane on <host>?`, or `end session <session> on <host>?` for the last pane of its session), where the agent allows it and the pane is writable; elsewhere close the tile | `x`, `×` | `×` | — |
| fit on / off, again | `f`, `r`, button | `⤢` tap, hold | — |
| fit every tile | `F` | — | — |
| zoom: one pane alone, then back to the tiles it came from, in their places and arrangement (or, opened alone, the window's panes side by side in the window's order); on the web the tile switches off to a line that travels to its new place and opens there, unless effects are off | `z`, `⊡`, double-click a tile, its header or its tab | `⊡`, double-tap a header | — |
| the window view (mirror layout) | `w` | — | — |
| go to a pane | `p`, `≡` among the pane buttons | the strip | — |
| the inbox: every pane that waits, oldest first, with its kind, text and a question's choices; `Enter` opens the pane | `I`, the `⚑ n` count beside the brand | — (follow-up) | `GET /v1/inbox` in text mode |
| open the oldest waiting pane | `o` | — (follow-up) | — |
| messages: what panes said to panes, mail and typed, across hosts, oldest at the top, each with who, to whom, the text and the token, a reply indented under what it answers; `Enter` lays the two panes side by side; opening it clears the `✉ n` count of messages not looked at | `T`, the `✉ n` count beside `⚑ n` | — (follow-up) | — (follow-up); `GET /v1/talk` in text mode |
| mail the open pane: a message for its process, never typed, from the line at the bottom of the messages window | `M` (the window with the line focused), `Enter` on the line | — (follow-up) | — (follow-up); `POST /v1/panes/{address}/mail` |
| lay the pane the focused tile talks with beside it: swapped next to it when open, opened there when not, in the place of the tile focused longest ago when four are open | `L`, a click on the header's chain | — (follow-up) | — |
| answer a question asked with fixed choices (`muxway ask`): the choice goes to the asking process, nothing is typed into the pane; disabled where you may not write | a button on the pane's header, in the toast, in the inbox row | — (follow-up) | — (follow-up) |
| one more pane beside the focused one, a new session, or an existing pane as one more tile: the add menu | `+` after the tabs (and the `+` key) | `+` after the tabs; `+ pane`, `+ session` in the list too | — |
| minimise a tile to the row above the keys; bring it back | `_` on the header, `-` key; a click on the row's tab | `_` on the header; a tap on the row's tab | — |
| swap two tiles, or split a tile's place | drag a header onto a tile's middle, or its edge | long-press a header and drop it onto a tile's middle, or its edge | — |
| lay a tile across: the whole width of a split side by side, or the whole height of a stacked one, on the pointer's side | drag a header onto the divider | drop a header onto the bar, on the half it should take | — |
| lay the focused tile across the whole view: its width, its height, on the side its middle is | `e`, `E`, a click on the strip inside a tile's inner edge (`»` with a one-way arrow pointer) | — | — |
| hubs, help, admin, logout | the profile button | Settings | — |
| one more pane in a window | `+ pane` row, `+` on the selected row | `+ pane` row | — |
| a new session on a host | `+ session`, `S`; the selector lists it | `+ session` | — |
| a command of the row | click | tap | — |
| open a link printed in a pane | click | tap | — |
| see a file printed in a pane (inbox, or under the host's preview roots; the types are the protocol's list, sources, markup, config and templates, `Makefile` and such without an extension, images, PDF, anything else under a root as a download, never a secret) | click: a window over the page with `⤓` download, `Esc` closes; Markdown rendered with a `rendered` / `plain` switch, code with its colours, a `.diff` as a diff | tap: a sheet; Markdown rendered as the terminal would draw it, with a *plain* switch; code with its colours; the host's paths in it are links | — |
| the changes window: git's view of the pane's repository over the tile, docked to its right edge, the tile's size kept; a folder tree with `+` added or untracked (ok colour), `~` modified, `−` deleted (dim, struck), `→` renamed, `!` conflict (warn, bold), `●` staged; the branch and counts in its bar; a click on a file opens the file window with a `diff` / `file` switch | `g`, `⎇` or the count in the tile's header opens and closes, `Esc` or `×` closes, `_` folds it to its bar | the count in the tile's header opens it as a sheet; back or `×` closes; a file opens the file sheet with its `diff` / `file` switch | — |
| a new line in the input | `Shift+Enter` | `Shift+Enter` on a hardware keyboard | — |
| take a completion | `Tab`, click | tap | — |
| focus the input line, leave it | `:`, `Esc` | tap, back | — |
| a console key from an empty input line | `↑` `↓` `←` `→` `PageUp` `PageDown` `Home` `End` `Tab` | the key row | D-pad |
| Escape to the pane while typing | `Shift+Esc` | `Esc` in the key row | — |
| a file for the pane's program: its path onto the input line | `⇪`, paste, drop anywhere on the view | paste into the line, `⇪` (system picker), share to muxway | — |
| the keyboard: open and close the window, a key | `K` or `⌨`, `Esc` or `×` on the window; a click on a cap | `⌨`, back; a tap on a cap | — |
| speak: record a clip, stop it, drop it | `v` or `◉`: held, records until released; tapped, the next tap, `■` or the meter stops; `Esc` drops | `◉` the same: held records until the finger lifts, tapped the next tap or `■` stops; back drops | the glasses' own mic |
| answer from the watch: a key of its pane screen, or a spoken line confirmed there | — | a tap on the watch's pane screen; the phone validates and sends | — |
| another hub | `H`, `⇄`: a link to its own page and sign-in | every hub with a token is in use at once; the connect screen's hubs list adds one | — |
| the admin page (an admin principal only) | `admin` in the header | Settings → *admin* | — |
| deny the address of a log line | `deny` on the row | — | — |
| end a client's session | `end` on the row | `end` on the row | — |
| theme: amber, green, paper, in that order | `t` | setting | setting |
| effects | `m` | setting | — |
| help | `?` | — | — |

A new action gets a row here before it gets a key anywhere.

## 2. Web only

| Feature | Why only here |
|---|---|
| window view (`/w/…`, "mirror layout") | the host's own arrangement needs the room of a screen; the list's window buttons and `w` open it; zoom out from a single tile goes to the window's tiles instead, so the one pane view keeps its controls. Its row is the pane view's (§1.4): the brand, a tab per pane of the window, and icons at the right: `⤢` fit, `⊡` the pane alone in the pane view (zoom in; `z`, `Enter`, a double-click on the cell or its header), `▦` the next arrangement of the window's panes on the host (`l`; the pane view's presets by count, the hidden panes kept in a thin stack at the right; off while any pane is read-only or above four panes), `⊞` equal shares (on the host too with fit on), `↺` the host's layout; a hidden pane's tab stays, dimmed, and brings it back |
| selector (`p`) | a keyboard is at hand |
| sign-in with an identity provider | a browser has the flow |
| browser notifications, tab title flash | the browser's own channels |
| font size for fit (`?` then *font*) | the cell the host is sized by; Android uses its *text* setting |
| hubs as peers (`H`, `⇄`) | a browser keeps a session per origin, so every hub in the hubs box signs the person in on its own page, once; the page then lists and opens the panes of every hub it is signed in on, through the hubs' peer rule (`--peer`, see `docs/features/web-client.md`, *Several hubs*); the list is kept per hub page and carried along only as names and addresses |
| the full admin page (`/admin`): access log, tokens and users with *create* (the new secret shown once, with its connect code for the phone to scan) and *revoke*, clients, address lists with *save* and *unlock* | minting a token means typing grant patterns, and a wrong address list shuts the owner out: both want a keyboard and a large screen; the phone has the read side (§3) |
| keyboard shortcuts as the primary interface | keyboard first |
| direct typing (`i`, a click on the tile): keys to the pane as pressed | a soft keyboard composes words, so Android keeps the line and its key row; with its *hardware keyboard* setting on, a hardware keyboard's keys go direct while the line is not focused (§1.6) |

Feature page: `docs/features/web-client.md`.

## 3. Android only

| Feature | Why only here |
|---|---|
| connect screen, connect code (QR; drawn by the web admin page when a token is created, or by `scripts/connect-qr.py`) | a phone has a camera and no keyboard worth typing a token on |
| hubs list with a token per hub, all in use | the app holds the tokens itself, in the keystore, and lists every hub's panes together (§1.3); a connect code adds a hub |
| settings screen (*every*, *lines*, *text*, *reflow*, *block screenshots*, *hardware keyboard*, *effects*) | the device's own constraints |
| swipe between panes, pinch zoom, drag to page a full-screen program | touch |
| reflow with fit off | small screens |
| hardware keys and D-pad | glasses touchpads and keyboards reaching the phone |
| watch and background notifications | the phone's own channels |
| the watch's pane screen: the pane's tail, with *reply* and the microphone above it and nothing below, every request through the phone. The reply menu holds every answer (Claude's own choices, `Enter`, `y`, `n`, `Esc`, `Ctrl-C`, `Tab`, `Shift-Tab`, `Up`, `Down`, the watch's keyboard, and the way to the phone). On a round watch every band is inset to the chord of the glass; the menu and the pane list centre the row they are on, take the bezel and the crown, and show a position indicator, so every answer can be reached | the wrist has no keyboard and holds no token; the phone checks each request against its listing and the key whitelist, and a phone-side setting, off by default, allows writes at all |
| `FLAG_SECURE` | the platform's screenshot block |
| the admin section is read and end only: the log tail (last 200, pull to refresh) and the clients with *end* | tokens and address lists are made on the web or with the CLI (§2) |

Feature pages: [muxway-android/docs/features/](https://github.com/notmarkopadjen/muxway-android/tree/main/docs/features).

## 4. Changing a shared feature

1. Change this page first: the row in the table, the sketch if the shape
   changes.
2. Change every client that has the feature, in the same change set when
   one person does both, or with a tracking issue in the other repository
   when not. Name the other repository's issue in the commit message.
3. Update each repository's feature page and its tests: web specs in
   `web/e2e/`, Android tests in `app/src/androidTest` and the protocol
   module's unit tests.
4. Screenshots come from the test runs, never from a real machine.

A pull request that changes a shared feature in one client alone is not
done until the others have theirs or an issue says when.
