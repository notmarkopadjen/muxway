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
| alias | the owner's name for the pane (`muxway expose --name`, or set from a client, see §1.6 *name the pane*); when set it **is** the name, in bold, with the program's mark, and what the program says about itself follows as the status: `review · fixing the build`, `notes · vim · notes.md` |
| Claude Code | recognised by its command or by the spark it puts first in its title; named *Claude*, with its mark; the status it writes (the "codename") follows: `Claude · fixing the build` |
| the other AI CLIs | recognised by their command (Codex, Gemini, Antigravity `agy`, OpenCode, Copilot, aider, goose, Amp, Cursor) or their name in the title under an interpreter; named, and Codex and Antigravity have marks of their own (a hexagon, a lifted chevron) wherever Claude's spark shows; the title follows as the status |
| tab | the alias; else the codename alone for Claude Code, else the name |
| folder | the last segment of the directory the pane works in (`cwd`: under a preview root, for a writer, every program), in *italics*, dimmer than the name, after it and before the status; the whole path under the pointer (web) or in the name sheet (Android); nothing when the host gives none. the glasses and MIDP: after the name with a slash in front (`review /muxway · fixing the build`), MIDP on the 2.0 build only |
| place | the tmux address `host/session/window.pane`, dimmed, second to the name; on the web the tile's header keeps it under the pointer, not in the row; the glasses show it in the pane page's state while following |
| status style | the codename, any program status and the folder are set in *italics*, dimmer than the name |

Web: `web/src/term/describe.ts`, `components/PaneTitle.tsx`.
Android: `Lens.name`, `Pane.name`.

### 1.2 The lens

A lens knows one AI coding agent's screen and says what its pane is up
to. Every client names the same harnesses from the pane's command and
title (Claude, Codex, Gemini, Antigravity, OpenCode, Copilot, aider,
goose, Amp, Cursor; the Claude Code lens, which reshapes the screen, is the one
there is) and paints with the same three states and the same marks,
and one more state that is the owner's own: later.

| State | When | Glyph | Word | Paint |
|---|---|---|---|---|
| waiting | the listing carries a notification, except an `idle` one while the screen still moves (then: working) | `!` permission, `?` question, `z` idle, `✓` done | the kind | the theme's ink, inverted (ink ground, background letters), pulsing |
| working | a named harness: last event `working`, or the open pane's screen changed in the last 10 s; a change the client caused (first read, its own resize or input) does not count; on start the client reads the hub's recent events | `⟳`: a turning ring, drawn, the same in every font | `working` | plain: the ring and the word carry it (decided by the owner on 2026-11-02; dim before) |
| quiet | otherwise | none | none | plain |
| later | the listing carries `later`: the owner parked the pane (see [features/notifications.md](features/notifications.md#later)); whatever waits underneath is shown after the word, dimmed (`☾ later · ! permission`), and never calls: no toast, no pulse, no glow, no flash, no buzz, no banner | `☾`; `zz` where the font has no moon (MIDP, the glasses' own set) | `later` | plain, like quiet, the pane's name in the tile's header in italics: the mark and the slant are the only signs |

Selection is never a colour: an open or focused element has a border
(thick when focused) and its name in bold, so the state shows on the
pane you are looking at. The web adds, for the focused pane, a bar in
the theme's accent under its tab and along the top of its tile's
header, and steps the other tabs back a little, to seven tenths (a
waiting tab never dims, and its edge flashes twice every seven seconds,
not at all with effects off), so the open tab is found on a zoomed-in
screen and the others still show their state. tmux's own activity flag is not used.

**Talk** is beside the state, not one of them: panes whose listing
carries `talk` (they wrote or mailed to each other in the last ten
minutes, partners of partners included, see
[features/talk.md](features/talk.md)) form a group, drawn as one frame
in the talk hue (§1.5) around their tabs, their tiles and their rows,
like a browser's tab group, with the rows and tabs of a group kept
together. A pane whose process has unread [mail](features/mail.md)
carries `✉ n` after its name, in the hue. The state's paint wins on a
painted header: the count is drawn in the background colour there like
every mark. Where there is no colour or no glyph the mark is still
there: the glasses draw a bar (`│`) before a group's rows and the word
`mail n` after the name; the keypad phone an edge column (`[`, `|`,
`]`) at the row's left and `✉ n`, or `M n` in a charset without the
envelope.

Wherever a pane is shown in a cell among others (tiles, the window
view), its header is painted with the state, and a **waiting** pane's
cell glows in the theme's ink: a shadow around it, pulsing with
effects on, drawn outside the layout so no neighbour moves or resizes.

Web: `web/src/term/lens.ts`, `components/Lens.tsx`. Android:
`protocol/Lens.kt`. Feature pages: core `web-client.md` (The lens),
Android `lenses.md`.

The glasses draw the same states with the glyphs their font has (it
draws no check, no ring and no flag, found on the device on
2026-11-03): `★` for a question and a permission, `√` done, `○` idle,
`◐` and `◑` turned once a second for working, `◌` for a pane with
nothing reported, and `◆` for the inbox where the other clients fly
`⚑`. Glasses `screens.md`.

### 1.3 The pane list

```
── alice-laptop ──────────────────────── + session · online ──
  [ ] * ⟳ fixing the build     alice-laptop/work/0.0   working
  [ ]   bash                   alice-laptop/work/0.1
  │  + pane
```

| Element | Shared behaviour |
|---|---|
| grouping | by hub, then by host, host state (`online`, `offline`, `nothing exposed`) on the group's line; offline hosts dimmed. With one hub the hub level is not drawn; with several every hub the client holds a credential for is listed, its name on its own line (`═══ work ═══`), a hub that cannot be reached or is not signed in with the reason beside its name and nothing under it (web: a *sign in* link to that hub's own page). Panes of two hubs never mix inside a host group: a host is listed under the hub it belongs to. The glasses draw a line per online host (`── name · state ──`, `+ session` on it) and keep offline hosts in the hint; MIDP a line per host (`= name state`) on the 2.0 build |
| row | write mark `*`, the lens glyph, the name, `✉ n` while mail waits, the place, the lens word; the rows of a group of §1.2 kept together, framed (web, Android), behind a bar (glasses) or an edge column (MIDP) |
| open | a tap or click opens the pane alone |
| pick | several panes, up to four, open side by side: Android hold, web `[ ]` box or `space`, the glasses hold then a tap per pane (three at most, their columns); a bar under the list offers *clear* and *open N side by side* (the glasses: two rows); with a pick on, a tap adds or removes |
| `+ pane` | a dim row under a window's panes when one of them is writable; a tap splits the window (beside on a wide pane, below on a tall one) and opens the new pane |
| `+ session` | at the right of the host's line, for a host whose agent allows it (`sessions` in `GET /v1/hosts`; the web also wants a write pattern of `/v1/me` naming the host); asks for a name (web: a one-line form, Android: a dialog) and opens the session's first pane; the hub's answer decides |
| refresh | re-read every 5 s (web), 15 s (Android), 10 s (the glasses), and at once on any event; MIDP by its *Auto refresh* setting, 10 s by default, since it has no events |
| desk | the view the owner's clients share, kept by the hub (`GET /v1/desk`): a `desk` row at the top of the list opens it (the open panes in their arrangement with the minimised row and the focus, or the window view); a client that was closed in a view and is started on its list opens the desk at once when it holds panes, a link to a view goes where it points, a client closed on the list starts there; the pane view and the window view write the desk half a second after a change of the tiles, the arrangement, the minimised row, the focus or the tab order, and follow another client's `desk` event within a second, the focus excepted (restored on opening only) | the `desk` row and `D` on the list; writes and follows as a writer | reads and writes the desk as the web does (parity to follow) | the glasses and MIDP open the desk's focused pane from their lists (parity to follow) |

Web adds the tmux tree (session, window) and a button per window that
opens the window view; see §2.

### 1.4 The pane view: strip, tiles, input

```
┌─ muxway ─┐ [⟳ build][! review][logs] [+]   [▦][⊞][↺][⤢][▮][⎇][☾][⇗][⊡][≡]  [alice ▾]
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
| header row | web: one row, the brand, the strip, `+` right after the last tab (see *add menu*), the pane buttons at the right as 32 px squares with a label under the pointer (`▦` `⊞` `↺` `⤢` `▮` `⎇` `☾` `⇗` `⊡` `≡`: the same ten in the pane view and the window view, in that order, a button disabled where its action does not apply rather than left out, so nothing moves under the pointer), and the profile button with the principal's name (*hubs*, *help*, *admin* for an admin, *logout*); nothing in it repeats the pane's name. In a window 960 px wide or narrower the strip and its `+` take a second row of their own, the whole width, under the brand, the counts, the pane buttons and the profile button. On a narrow screen (640 px and under) the pane buttons fold into one `⋯` button that opens a menu with the same entries, and the profile button shows only its caret. Android keeps its own top row: `‹`, the strip, `+` after the last tab, `▦` `⊡` `⤢` `abc` `⚙` |
| add menu | `+` after the last tab opens a menu, built from the listing the client holds, in this order: **+ pane** (one more pane beside the focused one on its host, where the token may type there), **+ session** (on the focused pane's host, where its agent starts sessions), a rule, the **minimised** panes (see *minimised row*), a rule, every other readable pane the client is not showing, grouped by hub (with several), host and session in listing order, each as its glyph and name with its place dimmed after it, the place cut with an ellipsis before the name is, the menu never scrolling sideways. The focused pane and the open tiles are not listed. An entry the token or the host does not allow is dimmed with the reason (*read only*, *no sessions here*). A pane picked becomes one more tile, focused; with four tiles the menu's heading says *four open: a pick replaces <focused>* and the pick swaps into the focused tile, as a tab does. `+ pane` and `+ session` ask the hub; a pick asks nothing. Web: `+` key opens it, `Esc` closes; Android: a tap, back closes |
| strip | every readable pane in listing order, or on the web in the order the owner dragged them into (kept in the browser; the dragged tabs first, the rest in listing order, a new pane last; the window view keeps the host's order), the parked panes (§1.2, later) after every other in the order they would otherwise have, a woken pane back in its place, named as §1.1 says, painted as §1.2 says, Claude's mark on every Claude pane with the state glyph beside it, the tabs of a group of §1.2 side by side inside one frame in the talk hue, a joining tab pulled next to the group's earliest, the pull kept in the owner's order, a tab dragged out let go until the group's next message, air between two frames, `✉ n` after the name while the pane's process has unread mail (web, Android); open tabs bordered, the focused one thick and bold (web: a 4 px bar in the accent under it, the other tabs at seven tenths, a waiting tab never dimmed and its edge flashing twice every seven seconds); a closed tab tapped swaps into the focused tile; tabs keep their width, the strip scrolls sideways and keeps the focused tab in view; on the web the wheel over it moves it and `‹ ›` at its ends appear while there is more than fits; on the web a tab dragged down onto the view lays its pane out as a dragged header does (see *tiles*), so one tile becomes two columns or two rows by a drop on its right or lower part |
| tiles | one to four panes; a pane that exits leaves the view by itself (the others close up; alone, back to the list); arrangements by count: 2 → row, column; 3 → + main-left, main-top; 4 → + grid; `▦` cycles; wide screens start with row, tall with column; splits drag with a 15 % floor; a header dragged onto another tile's middle swaps the two, onto its upper, lower, left or right part splits that tile's place that way with the dragged pane on that side, its old place closing up and every share equal again; on the web a tab from the strip drops the same way, and a tab of a pane not open takes the tile's place from its middle or comes in as one more tile from its edge (with four open the whole tile is its middle and the pane takes its place); `▦` goes back to the presets; tiles may come from any hosts, sessions and windows; the arrangement is the client's own, except when the tiles are every pane of one window: then they open as the host has it, follow it, and what is changed here moves the panes on the host (needs every pane writable, otherwise they only follow); a header (web: or a tab) dropped on a divider lays the pane across that split; a click on the strip inside a tile's inner edge lays it across the whole view (web); every tile of a group of §1.2 is edged in the talk hue, one thin dimmed line (the strip carries the full frame, the pane keeps the eye), the divider between two of them beside each other painted with the chain at its middle (web, Android), and `L` or the header's chain lays the partner beside the focused tile; tiles never move by themselves (web, see §1.6); a tile shows its own pane or nothing: it knows its pane by id from the listing, draws no frame of another pane (an address is a position, and the host renumbers panes when one closes), follows its pane to its new address when the host renumbers it, and closes when the pane is gone; while it has nothing of its own to draw, the web shows a short CRT warm-up in the theme's ink in the box (blank with effects off), never a borrowed screen or a spinner (web; Android, glasses, MIDP: parity to follow) |
| header | painted like its tab: the mark, the name (the alias, else as §1.1), the folder in italics, the status in italics, `read-only` when the token cannot write (nothing for write), the chain when the pane is in a group (web; a click lays the partner beside) and `✉ n` while its process has unread mail, the glyph and the word, the notice's text only for a question or a permission (the glasses: as the first line under the title, `read-only` in the state), then `_` (minimise, see *minimised row*; off on the last tile) and `×`; the address, the size, the mode and, for a named pane, the program's own name live in the tooltip on the name (web) or in the name sheet a tap on the name opens (Android), the size also beside *held* and *sync*; the focused tile has the thick border and bold name (web: and the accent bar along its header's top, matching its tab's); on the web the header is a 36 px row (twice a line) and carries, at its right before `×`, the count of the repository's changes for a writable pane of a host with preview roots (`⎇ +3 ~5 −1`, `⎇ ✓` when clean, nothing outside a repository; asked every ten seconds), a click on which opens the changes window. Controls live in the header row (web) or the top row (Android), not in tile headers: `▦` arrangement, `⊞` equal shares, `↺` the host's layout (web: the window view's, disabled here), `⤢` fit (web: for the focused tile), `▮` direct typing, `⎇` changes, `☾` later (§1.6; `d`), `⇗` share (web; §1.6), `⊡` zoom, `≡` go to; on the web a button is disabled where its action does not apply (one tile: `▦` `⊞`; the pane view: `↺`; a read-only pane: `⤢` `▮` `⎇` `☾` `⇗`; a host without preview roots: `⎇`; a host that does not park: `☾`), never left out; a tile whose pane the principal shared carries `⇗ n`, dim, before the changes count (web), a click on which opens the share window; on a narrow web screen (640 px and under) they fold into one `⋯` button whose menu has the same entries |
| minimised row | `_` on a tile's header takes the tile out of the arrangement and puts its tab in a row right above the key row, painted like a tab (glyph, name, the state's colours) and still read every two seconds, so its glyph keeps moving; its tab leaves the strip while it is below. A tap or click on it brings the tile back, focused; the add menu lists it too. The last tile cannot be minimised. The row is not drawn while it is empty. Minimised panes belong to the view's arrangement and are forgotten with it (leaving the view, a reload); the fit of a minimised pane is released like a closed tile's |
| fit | per tile; every writable tile opens with fit on, one or several; `⤢` or `f` toggles, `r` sends the size again (web); leaving the view releases. The host never lets a fit take a neighbour under 20 columns or 5 rows: the window grows instead; and a fitted pane is never left wider or taller than its tile asked on an axis it shares (after a zoom, or a neighbour's fit): the window shrinks by the excess, so a fitted tile is never drawn scaled for room nobody asked for. The floor holds on a window fit and a zoom too: a pane the proportions would squeeze takes the difference from the panes with room, the zoomed pane's hidden cell first. A window takes the four fits a grid sends at once, then one a second. **One fit per window:** open tiles that are every pane of one tmux window fit the window as one, with the arrangement as its layout, as the window view does, so each pane is its tile; the layout is exact, each pane as many cells as its tile's screen holds, so no pane is given rows its tile cannot show: the tiles of a stack lose a header each, and a tile across from them keeps that much spare. Where only some of a window's panes are open as tiles, each fits its own pane, and the host sorts the neighbours out (they give or take, the window grows before any goes under the floor); a tile whose size the host would not give, because another tile's fit shares the axis, says *held* in its header and is drawn scaled to its box until its box changes. A tile whose fit is in flight says *sync* until the pane is at size (web). The focus plays no part: moving it sends nothing. Every fitted pane is released when the view is left. **A pane alone** in the view fits its *window* with the pane zoomed over its siblings (tmux's own zoom), so no neighbour is squeezed; a pane left for another in the view stays at size and is not sent again when it comes back at that size |
| input | a text line and one key row for the focused tile; `Esc` pinned left and `Enter` right on a phone; *type* sends text, *send* sends text then Enter; read-only panes show `read-only` and no way to type. The line is a small editor: text wraps and the field grows upward, to six rows, then scrolls inside; Enter (web) or the keyboard's send key (Android) sends, Shift+Enter starts a new line; a text with several lines reaches the pane as one paste, bracketed when the program asked; a text longer than the 4096 bytes one request takes goes in pieces, one request after another, each cut after the last newline that fits, and so does a paste while typing direct. While the first word is typed, and nothing follows it, a list above the line offers the agent's slash commands (Claude Code's, Codex's, Antigravity's) or a shell's starters, each AI starter with its mark, and the lines sent before; any word two letters in is also completed from the words on the pane's screen, newest first, after the commands and marked `⇥`; eight at most, never anything from another pane or the hub; the web picks with `↑` `↓`, takes with `Tab` or a click, closes with `Esc` and sends a highlighted command with Enter (a screen word is only taken, Enter sends the line as typed), Android offers a row and takes with a tap. **Microphone**: when the hub has a transcriber (`GET /v1/transcribe` is 204, asked once per sign-in) and the focused pane is writable, a `◉` button sits between the field and *send*; without a transcriber, or on a read-only pane, there is nothing. A press opens the mic and the field's place shows a level meter in block characters and the seconds; `■`, a press on the meter, or sixty seconds stops the clip, which goes to the hub as a WAV and comes back as words on the line, after a space when something is typed there, with the caret at the end and the line focused: nothing is sent until Enter. `✕` (cancel), in the place of `⏎`, or `Esc` drops the clip. The mic is closed the moment recording stops. Refusals are toasts: `microphone refused`, `no microphone`, `too short`, `one clip every five seconds`, `transcriber unavailable` **Files**: where the host's agent has an inbox (`GET /v1/panes/{address}/files` is 204) and the pane is writable, `⇪` sits beside the microphone; a file picked, pasted or dropped goes to the host and its path lands on the line with a space after it, focused, unsent; while it goes the line reads `⇪ name · size…` **Icons**: right of the line, in this order, `⌨` keyboard, `⇪` files (where there is an inbox), `◉` microphone (where there is a transcriber), `⏎` send; square buttons of one size, titled. **Keyboard**: `⌨` opens a window over the view for the focused pane (its title names the pane and follows the focus), with a big terminal board of the old kind and no brand: F1–F24 in two rows (F13–F24 go as Shift+F1–F12), the main block with every printable ASCII key and its shifted legend, both Shifts, Ctrls and Alts, Caps Lock, the navigation keys, the arrows in an inverted T, a keypad with Num Lock, and a column of command keys (*Attn* `C-c`, *Clr* `C-l`, *EOF* `C-d`, *Susp* `C-z`, *Kill* `C-u`, *Word* `C-w`, *Home* `C-a`, *End* `C-e`, *Rev* `C-r`, *Back* Shift+Tab). A click sends at once; Shift, Ctrl and Alt latch for the next key and a double click locks them; a cap lights when pressed and shakes when refused. Keys a terminal cannot carry (Super, Fn, Print Screen, media keys) are not drawn; Ctrl or Alt with `;` is dimmed; on a host whose agent lists no `keys: 2`, the keys only the grammar has are dimmed. The window drags by its bar and folds to it (web); on a phone it takes the bottom of the screen. Read-only panes: the icon is off |
| key row | one row, scrolling sideways, never wrapping, no scrollbar; keys tinted by group, discreetly (border and ground, never the ink): editing, direction, control, function |
| command row | one row under the key row, scrolling sideways, never wrapping, no scrollbar, tinted by tone the same way (danger red, start green, info blue, the rest amber), for the program in the focused pane. Claude Code (the lens decides): `/clear` `/exit` `/compact` `/rename` `/model` `/resume` `/usage` `/context` `/help` and fifteen more of its slash commands (`web/src/term/commands.ts`), marked with Claude's spark. A shell (`bash`, `zsh`, `fish`, `sh`, …): `exit` `htop` `claude` `claude -c` `codex` `gemini` `git status` `ls` `clear` and the git, make, npm, docker and tmux starters beside them, marked `$`, then after a bar the last eight lines sent to a shell from this client, newest first. A button sends its command then Enter; `/rename` fills the input line and waits. Any other program: no row. A read-only pane cannot use it |
| status bar | the bottom line (web): `● hub`, or `○ hub unreachable, retrying` while the hub does not answer (also with no network, when the installed app's worker opened the shell from the device); the hints `? help · t theme · / filter`, or the direct-typing line; `new version · reload` while a new build of the client waits, a click reloads with it. Android: the status line of the view |
| mouse | a tap or click on a pane whose program asked for the mouse is a left click at that cell; otherwise it only focuses. The same program gets the wheel: a notch per row of travel (web: the wheel; Android: a vertical drag), the notches of one movement gathered into one `wheelup` / `wheeldown` request with a `count` (50 at most) at the cell under the pointer, the next movement's waiting for it, so a long scroll is a few requests and the program keeps up with the hand. A pane without the mouse scrolls in the client, through the history the hub sent |
| links | a web address in a pane's text, `http` or `https` and nothing else, is a link: underlined dotted, in the colours the pane gave it; a program may name the address itself (OSC 8, as Claude Code does for a work item or a file): the label is the link, the address shows on hover, and the same schemes and nothing else; a click (web) or a tap (Android) opens it in the browser in a new tab and sends nothing to the host, mouse mode or not; the punctuation after it stays text, a bracket it opened stays in; an address wrapped onto a second row opens up to the row's end; a path of the host's inbox (`…/20261025-102235-56fwge.png`) is a link too, and on a host with preview roots any path with a slash or from `~` ending in a shown extension, in a writable pane: the file opens in a window over the page (web) or a sheet (Android) with its size and a download, text as text, an image as itself, a PDF framed; the host serves an inbox file by name only and a path only from under its roots |
| names | in a writable shell pane (by its program: `bash`, `zsh`, `fish`, `sh` and their kind) on a host with preview roots, every name of an entry of the pane's current directory that appears on the screen, after `ls`, `tree`, `git status` or in prose, set off by the row's edge, blank space, a bar, a quote or a bracket, is a link, shown under the pointer only; only a name the host listed, never a word a program made up, and never an entry that is neither a directory nor a file; the link's title says what a click types; a web address, a program's link, an inbox file and a path with a slash come first where they overlap. Off by the setting *names* |
| suggestion | while a writable shell pane is typed into, direct or on the input line, the rest of a known line is drawn dim after the cursor: a line this browser sent before (kept per browser, never a line that looks like a secret, emptied by *forget* and by signing out), a command the screen shows was typed at a prompt, a starter of the command row, or after a command that takes a file a name of the pane's directory (a directory with its slash); only where the screen's cursor row confirms the typed part, never with text right of the cursor, never for a program that is no shell, never from the hub or another pane; accepted whole by Right, a word by Ctrl+Right, ignored by every other key, never sent by Enter. Off by the setting *suggest* |
| reading | the focused pane every second, the others every two (web); Android every 2 s and 4 s by its *every* setting; the glasses the open pane every 3 s by their *follow* setting; MIDP by *Auto refresh*, 10 s by default, over GPRS. The minimised row is read like the others |

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
ink drawn inverted, working and quiet are plain (decided by the owner
on 2026-10-25, the working dim dropped on 2026-11-02: the ring says it). The alert colour is for errors only; the key and command
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
a group in Chrome tabs"): panes that talked lately (typed talk within
ten minutes, mail within a day, the mail's own lifetime) are framed as one
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
| pick several | `space`, `[ ]`; Shift+click a tab opens it beside | hold; a tab held and let go in place (the drag's long press without a move) opens its menu, *open beside* first | glasses: hold, then a tap per pane, three at most, *open N side by side* and *clear* as rows under the list; MIDP: — |
| name the pane: the focused pane's alias, `a-z 0-9 -` up to 32, shown first everywhere and an address for agents (`host/@name`); `Enter` saves, `Esc` leaves it, empty takes the name away; needs a write grant and a host that names (`hosts[].rename`); `POST /v1/panes/{address}/alias` | `N`; a second click on its tab or its header name between half a second and three after the click that focused it (a double-click still zooms) | a tap on the focused pane's tab, or on the name in its header, opens the name sheet (the program and its status, the address, the size, the mode, the folder's path, the field); *name* or Enter saves, *clear* takes the name away, *cancel* or back leaves it | — (both show the alias as the name; MIDP reads it from the text listing's `alias` column) |
| next / previous pane: the tile, or with one tile open the strip's neighbour shown in it, coming round at either end | `]` / `[`; `Ctrl+]` / `Ctrl+[` from anywhere, the line, direct typing and the window view included, direct typing staying on so the next pane is typed into at once; the chords never reach the pane, the keys themselves come from the virtual keyboard; with one tile open the strip's parked panes (§1.2, later) are passed over, as on Android | tap the tile, swipe; the swipe skips parked panes (§1.2, later), which it would only wake | glasses: the scroll moves between the columns; on a single pane the menu's *next pane* / *previous pane*, parked panes skipped; MIDP: D-pad left / right (the 2.0 build; the 1.0 build where the bytes allow) |
| move the strip | wheel over it, `‹ ›` | drag | — |
| reorder the strip: a tab to another place, kept across reloads | drag a tab along the strip (a mark shows where it lands); `}` / `{` move the focused pane's tab one place right / left | — | — |
| scroll a program that has the mouse | wheel over it | drag | — |
| copy a block of the screen (a bar's rows, a bullet and its rows, a result), without its markers | hover it, click `⧉` at its first row | long press | — |
| type into the pane: with a fine pointer a click on the screen turns direct typing on; a tap on the row its program waits on (the cursor's row) focuses the line | click (direct typing), tap (the line) | tap | — |
| direct typing: every key to the focused pane as pressed, `Esc` included, but `Ctrl+V` and `Shift+Insert`, which paste as in a terminal (text to the pane, a file to the inbox), and `Ctrl+]` / `Ctrl+[`, which go to the next / previous pane; the prompt shows `▮`, the status bar says so, the cursor is drawn as a block; a read-only tile focused ends it | `i`, a click on the tile (the window view: on the cell), `▮`; `Shift+Esc`, a click on the line or `▮` leaves | a hardware keyboard with the *hardware keyboard* setting on, while the line is not focused (the status line says `direct`); a tap on the line leaves, back from the line returns | — |
| next arrangement | `l`, `▦` | `▦` | — |
| equal shares in every split (the host follows for one window's tiles with fit on) | `=`, `⊞` | `▦` held | — |
| close the pane on its host, asking on the header (`y` / `n`; `close the pane on <host>?`, or `end session <session> on <host>?` for the last pane of its session), where the agent allows it and the pane is writable; elsewhere close the tile | `x`, `×` | `×`, the same two questions | glasses: *close pane* in the pane page's menu, through the confirm page; MIDP: *Close* on a writable pane's menu, confirmed, where the host's text flags say `close` |
| fit on / off, again | `f`, `r`, button | `⤢` tap, hold | — |
| fit every tile | `F` | — | — |
| zoom: one pane alone, then back to the tiles it came from, in their places and arrangement (or, opened alone, the window's panes side by side in the window's order); on the web the tile switches off to a line that travels to its new place and opens there, unless effects are off | `z`, `⊡`, double-click a tile, its header or its tab | `⊡`, double-tap a header | — |
| the window view (mirror layout) | `w` | — | — |
| go to a pane | `p`, `≡` among the pane buttons | the strip | — |
| the inbox: every pane that waits, oldest first, with its kind, text and a question's choices, then the parked panes (§1.2, later), oldest parking first, counted with the rest; `Enter` opens the pane, and wakes a parked one | `I`, the `⚑ n` count beside the brand | `⚑ n` in the header of the list and the view opens the inbox sheet; a tap on a row opens the pane | glasses: the `⚑ n` row at the top of the pane list opens the inbox page, its rows with the notice's text and a question's choices, a tap opens the pane; MIDP: `Inbox` on the list's menu, `9` on the pane, `GET /v1/inbox` in text mode |
| open the oldest waiting pane, parked panes skipped | `o` | `oldest`, the inbox sheet's first row | glasses: the menu's *Go to*, the inbox's oldest; MIDP: the inbox's first row |
| park the pane for later, wake it: the mark of §1.2 on the host, seen by every client; a tap or click on a parked tab, opening its pane from the list or the inbox, typing into it, an answer or a mail wakes it; a notification does not; write grant only, a reader sees the mark | `d` on the focused tile or the selected row, the `☾` pane button (selected while parked), *later* / *wake* on the inbox row | *later* / *wake* in the menu a tab or a tile's header held and let go in place opens, and in the watch's reply menu; a tap on a parked tab wakes it, as does opening it from the list, the inbox or the add menu | glasses: *later* / *wake* in the pane page's menu, and in the inbox page's menu for the entry under the cursor; MIDP: *Later* / *Wake* on a writable pane's menu, a parked pane woken as it opens from the list or the inbox; both read what waits underneath from the listing's `pending` column (`zz · !`; the MIDP 1.0 build shows `zz` alone); `POST /v1/panes/{address}/later` |
| messages: what panes said to panes, mail and typed, across hosts, oldest at the top, each with who, to whom, the time and the token on one line and the text's first 200 characters wrapping under it (web: a 960 px box), a reply indented under what it answers; `Enter` lays the two panes side by side, a click on a mail row opens the mail window on that mail; opening it clears the `✉ n` count of messages not looked at | `T`, the `✉ n` count beside `⚑ n`; `⇆` on a row lays the two side by side | `✉` beside `⚑ n` in the header of the list and the view, with the count, opens the messages sheet; a tap on a mail row opens the mail sheet on that mail, on a typed row lays the two side by side; `⇆` on every row lays them side by side; a reply indented under what it answers, the text wrapping to its 200 characters | glasses: the `» messages · mail n` row under the inbox row opens the messages page, oldest at the top, who → whom and the time on a row and the text wrapped under it, a tap on a typed entry lays the two side by side, on a mail entry opens the mail page, opening it clears the count; MIDP: *Messages* on the list's menu, `7` on the pane, a `List` like the inbox; `GET /v1/talk` in text mode |
| the mail window: one pane's mail in full, what came in (`←`, the sender, `unread` until the process read it, `replied`) and what it sent (`→`, whole where the token reads the recipient, else the first 200 characters marked *cut*), merged by time, oldest at the top; reading it takes nothing from the process; mail is text, never markup | the `✉ n` on a tab, a header or a list row; a mail row in the messages window (that mail framed); `M` for the open pane with the line focused; `Esc` closes, `L` lays the pane beside the line's target or its latest partner | a sheet: the `✉ n` on a tab, a tile header or a list row; a mail row in the messages sheet (that mail framed); *✉ mail* in the pane menu (a tab or a header held still) with the line focused; `×` or back closes | glasses: *mail* in the pane page's menu, and a mail entry in the messages page, open the mail page (`←` `→`, `unread`, `replied`, as rows; what went out from the feed, 200 characters, *cut*); MIDP: *Mail* on the pane's menu opens the mail list; `GET /v1/panes/{address}/mail` in text mode |
| mail the open pane, or mail back whoever wrote to it: a message for its process, never typed, from the line at the bottom of the mail window; the picker names the target (the pane and its partners, a pane you may not write disabled), `mail back` on a received mail aims it at the sender; the messages window keeps a line for the open pane | `M` (the mail window with the line focused), `Enter` on the line | the line at the bottom of the mail sheet: the picker, *mail back*, Enter or *send* | glasses: *mail <name>* in the mail page's menu, or a tap on a received mail (mail back); the text by *say it* or the phone pane's *mail* button, through the confirm page like every answer; MIDP: a text box like Reply, *mail back* aimed at the sender, where the host's text flags say `mail`; `POST /v1/panes/{address}/mail` |
| lay the pane the focused tile talks with beside it: swapped next to it when open, opened there when not, in the place of the tile focused longest ago when four are open | `L`, a click on the header's chain | *⇆ beside <partner>* in the pane menu (a tab or a header held still) | glasses: *beside: <name>* in the pane page's menu opens the columns with the two; MIDP: — |
| answer a question asked with fixed choices (`muxway ask`): the choice goes to the asking process, nothing is typed into the pane; disabled where you may not write | a button on the pane's header, in the toast, in the inbox row | a button on the tile's header, in the inbox row, on the system notification, in the watch's reply menu | glasses: the choices lead the answers page, confirmed as every answer; MIDP: the inbox row's choices |
| one more pane beside the focused one, a new session, or an existing pane as one more tile: the add menu | `+` after the tabs (and the `+` key) | `+` after the tabs; `+ pane`, `+ session` in the list too | glasses: *+ pane* in the pane page's menu (the list's eight containers leave no row for it) and a tap on a host's line in the list for `+ session` where its flags allow it (the name `glasses-n`, spoken, or typed on the phone), both through the confirm page; MIDP: `+ pane` and `+ session` on the list's menu where the host's text flags say so, confirmed |
| minimise a tile to the row above the keys; bring it back | `_` on the header, `-` key; a click on the row's tab | `_` on the header; a tap on the row's tab | — |
| swap two tiles, or split a tile's place; a pane not open takes the place, or comes in beside | drag a header, or a tab from the strip, onto a tile's middle, or its edge | long-press a header and drop it onto a tile's middle, or its edge | — |
| lay a tile across: the whole width of a split side by side, or the whole height of a stacked one, on the pointer's side | drag a header, or a tab from the strip, onto the divider | drop a header onto the bar, on the half it should take | — |
| lay the focused tile across the whole view: its width, its height, on the side its middle is | `e`, `E`, a click on the strip inside a tile's inner edge (`»` with a one-way arrow pointer) | *⬌ across the width* / *⬍ across the height* in a tile header's menu | — |
| hubs, help, admin, logout | the profile button | Settings | — |
| one more pane in a window | `+ pane` row, `+` on the selected row | `+ pane` row | glasses: *+ pane* in the pane page's menu; MIDP: `+ pane` on the list's menu |
| a new session on a host | `+ session`, `S`; the selector lists it | `+ session` | glasses: a tap on the host's line (`+ session` on it); MIDP: `+ session` on the list's menu |
| a command of the row | click | tap | glasses: the answers page's *→ commands* list (Claude Code's by the lens, a shell's starters; those that only fill the line left out), each through the confirm page; MIDP: a *Commands* list on the pane's menu (the 2.0 build) |
| open a link printed in a pane | click | tap | — |
| see a file printed in a pane (inbox, or under the host's preview roots; the types are the protocol's list, sources, markup, config and templates, `Makefile` and such without an extension, images, PDF, anything else under a root as a download, never a secret) | click: a window over the page with `⤓` download, `Esc` closes; Markdown rendered with a `rendered` / `plain` switch, code with its colours, a `.diff` as a diff; when the host found a relative path elsewhere in the pane's repository (above the pane's directory, or in another worktree), the bar names the file after the printed path, dim: `found /home/alice/src/feature/docs/a.md` | tap: a sheet; Markdown rendered as the terminal would draw it, with a *plain* switch; code with its colours; the host's paths in it are links; when the host found the file elsewhere, a dim row under the bar: `found /home/alice/src/feature/docs/a.md` | — |
| enter a directory printed in a shell pane: `cd -- 'name'` and Enter typed into the pane, the name single-quoted whole | click on the name | tap on the name | — |
| open a file printed in a shell pane the way the person set: the preview window (nothing typed), `cat -- 'name'` and Enter, or their own command with `{}` for the quoted name (setting *a file opens with*) | click on the name | tap on the name | — |
| put a name printed in a shell pane on the pane's line, quoted, with a space after, nothing sent | Shift+click on the name | long press on the name | — |
| accept the suggestion after the cursor: whole, or its first word | `Right`, `Ctrl+Right` (direct typing: sent as text; the line: into the field) | tap on the suggestion, or swipe right on the line (whole); `Right`, `Ctrl+Right` with a hardware keyboard | — |
| the changes window: git's view of the pane's repository over the tile, docked to its right edge, the tile's size kept; a folder tree with `+` added or untracked (ok colour), `~` modified, `−` deleted (dim, struck), `→` renamed, `!` conflict (warn, bold), `●` staged; the branch and counts in its bar; a click on a file opens the file window with a `diff` / `file` switch | `g`, `⎇` or the count in the tile's header opens and closes (the window view: the same, over the focused cell, the count in every writable cell's header), `Esc` or `×` closes, `_` folds it to its bar | the count in the tile's header opens it as a sheet; back or `×` closes; a file opens the file sheet with its `diff` / `file` switch | — |
| a new line in the input | `Shift+Enter` | `Shift+Enter` on a hardware keyboard | — |
| take a completion | `Tab`, click | tap | — |
| focus the input line, leave it | `:`, `Esc` | tap, back | — |
| a console key from an empty input line | `↑` `↓` `←` `→` `PageUp` `PageDown` `Home` `End` `Tab` | the key row | glasses: the answers page's *→ keys* list (Up, Down, Left, Right, PageUp, PageDown, Home, End, Tab, Shift-Tab, Enter, Esc); MIDP: the Keys list (`0`), the D-pad scrolls |
| Escape to the pane while typing | `Shift+Esc` | `Esc` in the key row | — |
| a file for the pane's program: its path onto the input line | `⇪`, paste, drop anywhere on the view | paste into the line, `⇪` (system picker), share to muxway | — |
| the keyboard: open and close the window, a key; the click sound | `K` or `⌨`, `Esc` or `×` on the window; a click on a cap; the sound toggles in the window's bar | `⌨`, back; a tap on a cap | — |
| speak: record a clip, stop it, drop it | `v` or `◉`: held, records until released; tapped, the next tap, `■` or the meter stops; `Esc` drops | `◉` the same: held records until the finger lifts, tapped the next tap or `■` stops; back drops | the glasses' own mic |
| answer from the watch: a key of its pane screen, or a spoken line confirmed there | — | a tap on the watch's pane screen; the phone validates and sends | — |
| another hub | `H`; `⇄` while nobody is signed in, else the profile menu's *hubs*: a link to its own page and sign-in | every hub with a token is in use at once; the connect screen's hubs list adds one | — |
| share the pane read-only: a link and a password for one person, the link as a code to send; the window lists the pane's live shares with *revoke*; it asks a password of eight characters or more and a lifetime, shows how many watch each share, and copies or saves the code as an image | `s`, `⇗` among the pane buttons, the `⇗ n` count on the tile's header | *⇗ share* in the pane menu (a tab or a header held still) opens the share sheet, the same form and the once-shown link, password and code, which the system share sheet carries on; the `⇗ n` count on the tile's header opens it too; observing stays in a browser | — |
| the admin page (an admin principal only) | *admin* in the profile menu | Settings → *admin* | — |
| deny the address of a log line | `deny` on the row | — | — |
| end a client's session | `end` on the row | `end` on the row | — |
| theme: amber, green, paper, in that order | `t` | setting | glasses: the phone pane's setting, amber by default (the glass itself has four greys); MIDP: a setting on the 2.0 build (the 1.0 build is monochrome) |
| effects | `m` | setting | — |
| help | `?` | *help* in Settings, a sheet listing the gestures | glasses: the hint on every page; MIDP: the Keys line in Settings |
| focus a tile by its place; open the focused tile alone | `1`–`4`; `Enter` with several tiles | — | — |
| move the selection in the list; jump to a host; filter the list | `j` / `k` (and the arrows); `g` then the host's first letter; `/` | — | — |
| settings in the help overlay: *font*, *notifications*, *names*, *suggest*, *forget N sent lines*, *a file opens with* | `?`, then the setting | Settings: *names*, *suggest*, *forget*, *a file opens with* | — |

A new action gets a row here before it gets a key anywhere.

## 2. Web only

| Feature | Why only here |
|---|---|
| window view (`/w/…`, "mirror layout") | the host's own arrangement needs the room of a screen; the list's window buttons and `w` open it; zoom out from a single tile goes to the window's tiles instead, so the one pane view keeps its controls. Its row is the pane view's (§1.4): the brand, a tab per pane of the window, and the same ten buttons in the same order, each disabled where it does not apply here: `▦` the next arrangement of the window's panes on the host (`l`; the pane view's presets by count, the hidden panes kept in a thin stack at the right; off while any pane is read-only, above four panes or with one shown), `⊞` equal shares (on the host too with fit on), `↺` the host's layout, `⤢` fit, `▮` direct typing into the focused pane (§1.6; `i`, or a click on its cell), `⎇` the changes window over the focused cell (§1.6), `☾` later (§1.6; `d`), `⇗` share (§1.6), `⊡` the pane alone in the pane view (zoom in; `z`, `Enter`, a double-click on the cell or its header), `≡` go to; a hidden pane's tab stays, dimmed, and brings it back; `0` asks the host's layout again, `x` hides the focused pane, `+` / `-` give its cell more or less |
| selector (`p`) | a keyboard is at hand |
| sign-in with an identity provider | a browser has the flow |
| browser notifications, tab title flash | the browser's own channels |
| font size for fit (`?` then *font*) | the cell the host is sized by; Android uses its *text* setting |
| hubs as peers (`H`, `⇄`) | a browser keeps a session per origin, so every hub in the hubs box signs the person in on its own page, once; the page then lists and opens the panes of every hub it is signed in on, through the hubs' peer rule (`--peer`, see `docs/features/web-client.md`, *Several hubs*); the list is kept per hub page and carried along only as names and addresses |
| the observer's view of a shared pane (`/s/<id>`): the password once, then the pane's screen at the host's size scaled to the window, the web links in it, the changes window the owner opens docked to its edge (no fold, close or click) and the file or diff the owner opens over it; no input, strip, buttons or profile, `t`, `m` and `?` the only keys, the status bar names those and the help lists them alone with the theme and effects toggles (see `docs/features/share.md`) | a share is a link, and a link opens in a browser; Android makes shares from its share sheet (§1.6), the glasses and MIDP make none; every client observes in a browser |
| the full admin page (`/admin`): access log, tokens and users with *create* (the new secret shown once, with its connect code for the phone to scan) and *revoke*, clients, shares with *revoke*, address lists with *save* and *unlock* | minting a token means typing grant patterns, and a wrong address list shuts the owner out: both want a keyboard and a large screen; the phone has the read side (§3) |
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
