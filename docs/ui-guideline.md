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
client in `muxway-android`; glasses and MIDP clients in their own
repositories. Each client's `AGENTS.md` points here.

## 1. Shared: what every client shows

### 1.1 Naming a pane

| Where | Content |
|---|---|
| name | what runs in the pane: the command, then what the program says about itself in the title when that adds something (`vim · notes.md`) |
| Claude Code | recognised by its command or by the spark it puts first in its title; named *Claude*, with its mark; the status it writes (the "codename") follows: `Claude · fixing the build` |
| tab | the codename alone for Claude Code, else the name |
| place | the tmux address `host/session/window.pane`, dimmed, second to the name |
| status style | the codename and any program status are set in *italics*, dimmer than the name |

Web: `web/src/term/describe.ts`, `components/PaneTitle.tsx`.
Android: `Lens.name`, `Pane.name`.

### 1.2 The lens

The lens knows one program and says what its pane is up to. Every client
paints with the same three states and the same marks.

| State | When | Glyph | Word | Paint |
|---|---|---|---|---|
| waiting | the listing carries a notification, except an `idle` one while the screen still moves (then: working) | `!` permission, `?` question, `z` idle, `✓` done | the kind | the theme's ink, inverted (ink ground, background letters), pulsing |
| working | Claude Code: last event `working`, or the open pane's screen changed in the last 10 s; a change the client caused (first read, its own resize or input) does not count; on start the client reads the hub's recent events | `⟳`: a turning ring, drawn, the same in every font | `working` | dim |
| quiet | otherwise | none | none | plain |

Selection is never a colour: an open or focused element has a border
(thick when focused) and its name in bold, so the state shows on the
pane you are looking at. tmux's own activity flag is not used.

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
| grouping | by host, host state (`online`, `offline`, `nothing exposed`) on the group's line; offline hosts dimmed |
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
┌─ muxway ─┐ [⟳ build][! review][logs] [+]   [▦][⤢][⟳][⊡][≡]  [alice ▾]
┌ header: glyph name · command · mode   word  size ┐
│ content                                          │
└──────────────────────────────────────────────────┘
[Esc] [Tab][S-Tab][^C][↑][↓]…           [Enter]
$ [exit][htop][claude][codex]…  │ [make test]
> ______________________________ [type] [send]
```

| Element | Shared behaviour |
|---|---|
| back | the brand at the left of the header row returns to the list (web); `‹` (Android) |
| header row | web: one row, the brand, the strip, `+` right after the last tab (*split here*: a new pane beside the focused one on its host, where the token may type there; *new session*: where the agent starts sessions), the pane buttons at the right as 32 px squares with a label under the pointer (`▦` `⤢` `⟳` `⊡` `≡`), and the profile button with the principal's name (*hubs*, *help*, *admin* for an admin, *logout*); nothing in it repeats the pane's name. Android keeps its own top row |
| strip | every readable pane in listing order, named as §1.1 says, painted as §1.2 says, Claude's mark on every Claude pane with the state glyph beside it; open tabs bordered, the focused one thick and bold; a closed tab tapped swaps into the focused tile; tabs keep their width, the strip scrolls sideways and keeps the focused tab in view; on the web the wheel over it moves it and `‹ ›` at its ends appear while there is more than fits |
| tiles | one to four panes; arrangements by count: 2 → row, column; 3 → + main-left, main-top; 4 → + grid; `▦` cycles; wide screens start with row, tall with column; splits drag with a 15 % floor; a header dragged onto another tile's middle swaps the two, onto its upper, lower, left or right part splits that tile's place that way with the dragged pane on that side (web), its old place closing up and every share equal again; `▦` goes back to the presets; tiles may come from any hosts, sessions and windows; the arrangement is the client's own, except when the tiles are every pane of one window: then they open as the host has it, follow it, and what is changed here moves the panes on the host (web; needs every pane writable, otherwise they only follow) |
| header | painted like its tab: glyph, name, command, mode, the word, the size; the focused tile has the thick border and bold name. Controls live in the header row (web) or the top row (Android), not in tile headers: `▦` arrangement, `⤢` fit (web: for the focused tile), `⟳` fit again, `⊡` zoom |
| fit | per tile; every writable tile opens with fit on, one or several; `⤢` or `f` toggles, `⟳` or `r` sends the size again; leaving the view releases. The host never lets a fit take a neighbour under 20 columns or 5 rows: the window grows instead. **One fit per window:** open tiles that are every pane of one tmux window fit the window as one, with the arrangement as its layout, as the window view does, so each pane is its tile (web; muxway-android#26). Where only some of a window's panes are open as tiles, only one of them fits its pane (the focused tile's, or the first of them when the focus is elsewhere); the others keep fit off, say *held* in their header and are drawn scaled to their box, so tiles do not fight over one row; focus moving to another tile of the window moves the fit, releasing the previous pane first. **A pane alone** in the view fits its *window* with the pane zoomed over its siblings (tmux's own zoom), so no neighbour is squeezed; a pane left for another in the view stays at size and is not sent again when it comes back at that size |
| input | a text line and one key row for the focused tile; `Esc` pinned left and `Enter` right on a phone; *type* sends text, *send* sends text then Enter; read-only panes show `read-only` and no way to type. The line is a small editor: text wraps and the field grows upward, to six rows, then scrolls inside; Enter (web) or the keyboard's send key (Android) sends, Shift+Enter starts a new line; a text with several lines reaches the pane as one paste, bracketed when the program asked. While the first word is typed, and nothing follows it, a list above the line offers Claude Code's slash commands or a shell's starters and the lines sent before, eight at most and never anything a pane printed; the web picks with `↑` `↓`, takes with `Tab` or a click, closes with `Esc` and sends the highlighted one with Enter, Android offers a row and takes with a tap. **Microphone**: when the hub has a transcriber (`GET /v1/transcribe` is 204, asked once per sign-in) and the focused pane is writable, a `◉` button sits between the field and *send*; without a transcriber, or on a read-only pane, there is nothing. A press opens the mic and the field's place shows a level meter in block characters and the seconds; `■`, a press on the meter, or sixty seconds stops the clip, which goes to the hub as a WAV and comes back as words on the line, after a space when something is typed there, with the caret at the end and the line focused: nothing is sent until Enter. *cancel* or `Esc` drops the clip. The mic is closed the moment recording stops. Refusals are toasts: `microphone refused`, `no microphone`, `too short`, `one clip every five seconds`, `transcriber unavailable` **Files**: where the host's agent has an inbox (`GET /v1/panes/{address}/files` is 204) and the pane is writable, `⇪` sits beside the microphone; a file picked, pasted or dropped goes to the host and its path lands on the line with a space after it, focused, unsent; while it goes the line reads `⇪ name · size…` |
| key row | one row, scrolling sideways, never wrapping, no scrollbar; keys tinted by group, discreetly (border and ground, never the ink): editing, direction, control, function |
| command row | one row under the key row, scrolling sideways, never wrapping, no scrollbar, tinted by tone the same way (danger red, start green, info blue, the rest amber), for the program in the focused pane. Claude Code (the lens decides): `/clear` `/exit` `/compact` `/rename` `/model` `/resume` `/usage` `/context` `/help` and sixteen more of its slash commands (`web/src/term/commands.ts`), marked with Claude's spark. A shell (`bash`, `zsh`, `fish`, `sh`, …): `exit` `htop` `claude` `claude -c` `codex` `gemini` `git status` `ls` `clear` and the git, make, npm, docker and tmux starters beside them, marked `$`, then after a bar the last eight lines sent to a shell from this client, newest first. A button sends its command then Enter; `/rename` fills the input line and waits. Any other program: no row. A read-only pane cannot use it |
| mouse | a tap or click on a pane whose program asked for the mouse is a left click at that cell; otherwise it only focuses. The same program gets the wheel: a notch per row of travel (web: the wheel, three notches per event at most; Android: a vertical drag) as `wheelup` / `wheeldown` at the cell under the pointer. A pane without the mouse scrolls in the client, through the history the hub sent |
| links | a web address in a pane's text, `http` or `https` and nothing else, is a link: underlined dotted, in the colours the pane gave it; a click (web) or a tap (Android) opens it in the browser in a new tab and sends nothing to the host, mouse mode or not; the punctuation after it stays text, a bracket it opened stays in; an address wrapped onto a second row opens up to the row's end |
| reading | the focused pane every second, the others every two |

Web: `web/src/pages/Pane.tsx`, `term/tiles.ts`, `term/commands.ts`,
`term/complete.ts`, `components/InputPanel.tsx`, `components/CommandBar.tsx`. Android: `ui/ViewScreen.kt`, `Layout`,
`protocol/Commands.kt`. Feature pages: core `web-client.md`
(Tiles), Android `pane-view.md`.

### 1.5 Look

Tokens are shared; the values are in the core at
`web/src/styles/tokens.css` and mirrored in Android's `ui/Theme.kt`.

| Token | Green | Amber | Paper |
|---|---|---|---|
| background | `#050806` | `#0a0603` | `#f1ead8` |
| panel | `#0a120c` | `#140b05` | `#e8dfc8` |
| ink | `#39ff14` | `#ffb000` | `#1f2a1f` |
| dim · faint | `#1f8f14` · `#0f4a0c` | `#a06c00` · `#4a3200` | `#5a6a5a` · `#b9b39f` |
| attention · alert | the ink, inverted · `#ff3b3b` | the ink, inverted · `#ff3b3b` | the ink, inverted · `#a3161b` |
| Claude | `#d97757` | same | same |

The browser tab's icon is drawn in the theme's colours.
No theme has a second hue for states: a waiting pane is the theme's own
ink drawn inverted, working is dim, quiet is plain (decided by the owner
on 2026-10-25). The alert colour is for errors only; the key and command
rows keep their group tints.

**The watch is the exception** (decided by the owner on 2026-10-25): its
face, its complications and its app draw a waiting pane in an attention
hue — `#ffb000` in green, `#ffd36b` in amber, `#9a5b00` on paper — and
not inverted. A watch face is always on, where a filled ink bar is
burn-in and battery, and a complication is drawn by whatever face it sits
in, which muxway does not own and which honours no inversion of ours. The
glyph carries the state there; the hue follows it. Working stays dim and
quiet plain, so the three states stay apart. The exception is the watch's
alone: every screen that is looked at on purpose inverts.

Pixel font (Press Start 2P) for the brand and panel titles, monospace
for everything else. Effects, on by default and off by a setting: glow,
scanlines, vignette, power-on, pulsing marks, inverted selection. Sharp
corners, box drawing, no gradients.

### 1.6 Actions and their triggers

The same action on every client, triggered the way the device does it.

| Action | Web key | Android | Glasses / MIDP |
|---|---|---|---|
| back to the list | `Esc`, the brand | `‹`, system back | back |
| open the selected pane | `Enter` | tap | select |
| pick several | `space`, `[ ]`; Shift+click a tab opens it beside | hold | — |
| next / previous pane: the tile, or with one tile open the strip's neighbour shown in it, coming round at either end | `]` / `[` | tap the tile, swipe | D-pad left / right |
| move the strip | wheel over it, `‹ ›` | drag | — |
| scroll a program that has the mouse | wheel over it | drag | — |
| next arrangement | `l`, `▦` | `▦` | — |
| close the pane on its host, asking on the header (`y` / `n`), where the agent allows it and the pane is writable; elsewhere close the tile | `x`, `×` | `×` | — |
| fit on / off, again | `f`, `r`, button | `⤢` tap, hold | — |
| fit every tile | `F` | — | — |
| zoom: one pane alone, then back to the tiles it came from, in their places and arrangement (or, opened alone, the window's panes side by side in the window's order) | `z`, `⊡`, double-click a tile, its header or its tab | — | — |
| the window view (mirror layout) | `w` | — | — |
| go to a pane | `p`, `≡` among the pane buttons | the strip | — |
| one more pane beside the focused one, or a new session | `+` after the tabs (and the `+` key) | `+ pane`, `+ session` in the list | — |
| swap two tiles, or split a tile's place | drag a header onto a tile's middle, or its edge | drag a header onto a tile: swap | — |
| hubs, help, admin, logout | the profile button | Settings | — |
| one more pane in a window | `+ pane` row, `+` on the selected row | `+ pane` row | — |
| a new session on a host | `+ session`, `S`; the selector lists it | `+ session` | — |
| a command of the row | click | tap | — |
| open a link printed in a pane | click | tap | — |
| a new line in the input | `Shift+Enter` | `Shift+Enter` on a hardware keyboard | — |
| take a completion | `Tab`, click | tap | — |
| focus the input line, leave it | `i`, `Esc` | tap, back | — |
| a console key from an empty input line | `↑` `↓` `←` `→` `PageUp` `PageDown` `Home` `End` `Tab` | the key row | D-pad |
| Escape to the pane while typing | `Shift+Esc` | `Esc` in the key row | — |
| a file for the pane's program: its path onto the input line | `⇪`, paste, drop anywhere on the view | `⇪` (system picker), share to muxway | — |
| speak: record a clip, stop it, drop it | `v` or `◉`: held, records until released; tapped, the next tap, `■` or the meter stops; `Esc` drops | `◉` the same: held records until the finger lifts, tapped the next tap or `■` stops; back drops | the glasses' own mic |
| answer from the watch: a key of its pane screen, or a spoken line confirmed there | — | a tap on the watch's pane screen; the phone validates and sends | — |
| another hub | `H`, `⇄`: a link to its own page and sign-in | the hubs list on the connect screen: *use* | — |
| the admin page (an admin principal only) | `admin` in the header | Settings → *admin* | — |
| deny the address of a log line | `deny` on the row | — | — |
| end a client's session | `end` on the row | `end` on the row | — |
| theme | `t` | setting | setting |
| effects | `m` | setting | — |
| help | `?` | — | — |

A new action gets a row here before it gets a key anywhere.

## 2. Web only

| Feature | Why only here |
|---|---|
| window view (`/w/…`, "mirror layout") | the host's own arrangement needs the room of a screen; the list's window buttons and `w` open it; zoom out from a single tile goes to the window's tiles instead, so the one pane view keeps its controls. Its row is the pane view's (§1.4): the brand, a tab per pane of the window, and icons at the right: `⤢` fit, `⟳` fit again, `⊡` the pane alone in the pane view (zoom in; `z`, `Enter`, a double-click on the cell or its header), `⊞` equal shares (on the host too with fit on), `↺` the host's layout; a hidden pane's tab stays, dimmed, and brings it back |
| selector (`p`) | a keyboard is at hand |
| sign-in with an identity provider | a browser has the flow |
| browser notifications, tab title flash | the browser's own channels |
| font size for fit (`?` then *font*) | the cell the host is sized by; Android uses its *text* setting |
| hubs as links (`H`, `⇄`) | a browser keeps a session per origin, so another hub is a link to its own page and sign-in; the list is kept per hub page and carried along only as names and addresses (see `docs/features/web-client.md`, *Several hubs*) |
| the full admin page (`/admin`): access log, tokens and users with *create* and *revoke*, clients, address lists with *save* and *unlock* | minting a token means typing grant patterns, and a wrong address list shuts the owner out: both want a keyboard and a large screen; the phone has the read side (§3) |
| keyboard shortcuts as the primary interface | keyboard first |

Feature page: `docs/features/web-client.md`.

## 3. Android only

| Feature | Why only here |
|---|---|
| connect screen, connect code (QR) | a phone has a camera and no keyboard worth typing a token on |
| hubs list with a token per hub, one in use | the app holds the tokens itself, in the keystore, so switching needs no second sign-in; a connect code adds a hub |
| settings screen (*every*, *lines*, *text*, *reflow*, *block screenshots*, *hardware keyboard*, *effects*) | the device's own constraints |
| swipe between panes, pinch zoom, drag to page a full-screen program | touch |
| reflow with fit off | small screens |
| hardware keys and D-pad | glasses touchpads and keyboards reaching the phone |
| watch and background notifications | the phone's own channels |
| the watch's pane screen: the pane's tail, with *reply* and the microphone above it and nothing below, every request through the phone. The reply menu holds every answer (Claude's own choices, `Enter`, `y`, `n`, `Esc`, `Ctrl-C`, `Tab`, `Shift-Tab`, `Up`, `Down`, the watch's keyboard, and the way to the phone). On a round watch every band is inset to the chord of the glass; the menu and the pane list centre the row they are on, take the bezel and the crown, and show a position indicator, so every answer can be reached | the wrist has no keyboard and holds no token; the phone checks each request against its listing and the key whitelist, and a phone-side setting, off by default, allows writes at all |
| `FLAG_SECURE` | the platform's screenshot block |
| the admin section is read and end only: the log tail (last 200, pull to refresh) and the clients with *end* | tokens and address lists are made on the web or with the CLI (§2) |

Feature pages: `muxway-android/docs/features/`.

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
