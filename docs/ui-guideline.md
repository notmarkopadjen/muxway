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
| waiting | the listing carries a notification | `!` permission, `?` question, `z` idle, `✓` done | the kind | attention colour, pulsing |
| working | Claude Code: last event `working`, or the open pane's screen changed in the last 10 s; a change the client caused (first read, its own resize or input) does not count; on start the client reads the hub's recent events | `⟳` | `working` | dim |
| quiet | otherwise | none | none | plain |

Selection is never a colour: an open or focused element has a border
(thick when focused) and its name in bold, so the state shows on the
pane you are looking at. tmux's own activity flag is not used.

Wherever a pane is shown in a cell among others (tiles, the window view,
a board), its header is painted with the state, and a **waiting** pane's
cell glows in the attention colour: a shadow around it, pulsing with
effects on, drawn outside the layout so no neighbour moves or resizes.

Web: `web/src/term/lens.ts`, `components/Lens.tsx`. Android:
`protocol/Lens.kt`. Feature pages: core `web-client.md` (The lens),
Android `lenses.md`.

### 1.3 The pane list

```
── alice-laptop ──────────────────────────────────── online ──
  [ ] * ⟳ fixing the build     alice-laptop/work/0.0   working
  [ ]   bash                   alice-laptop/work/0.1
```

| Element | Shared behaviour |
|---|---|
| grouping | by host, host state (`online`, `offline`, `nothing exposed`) on the group's line; offline hosts dimmed |
| row | write mark `*`, the lens glyph, the name, the place, the lens word |
| open | a tap or click opens the pane alone |
| pick | several panes, up to four, open side by side: Android hold, web `[ ]` box or `space`; a bar under the list offers *clear* and *open N side by side*; with a pick on, a tap adds or removes |
| refresh | re-read every 15 s (Android) or 5 s (web), and at once on any event |

Web adds the tmux tree (session, window) and a button per window that
opens the window view; see §2.

### 1.4 The pane view: strip, tiles, input

```
[‹] [⟳ build][! review][logs]              ▦ ⤢ …
┌ header: glyph name · command · mode   word  size ┐
│ content                                          │
└──────────────────────────────────────────────────┘
[Esc] [Tab][S-Tab][^C][↑][↓]…           [Enter]
> ______________________________ [type] [send]
```

| Element | Shared behaviour |
|---|---|
| back | `‹` at the top left returns to the list |
| strip | every readable pane in listing order, named as §1.1 says, painted as §1.2 says; open tabs bordered, the focused one thick and bold; a closed tab tapped swaps into the focused tile; the strip scrolls and keeps the focused tab in view |
| tiles | one to four panes; arrangements by count: 2 → row, column; 3 → + main-left, main-top; 4 → + grid; `▦` cycles; wide screens start with row, tall with column; splits drag with a 15 % floor; a header dragged onto another tile swaps the two; the arrangement never reaches the host |
| header | painted like its tab: glyph, name, command, mode, the word, the size with fit on; the focused tile has the thick border and bold name |
| fit | per tile, the pane's own scope; every writable tile opens with fit on, one or several; `⤢` or `f` toggles; a second press sends the size again; leaving releases. The host never lets a fit take a neighbour under 20 columns or 5 rows: the window grows instead. **To do on both clients** (muxway#48, muxway-android#3): where several open tiles are panes of one window, only the focused tile's pane fits and the others say *held*, so tiles do not fight over one row |
| input | one line and one key row for the focused tile; `Esc` pinned left and `Enter` right on a phone; *type* sends text, *send* sends text then Enter; read-only panes show `read-only` and no way to type |
| mouse | a tap or click on a pane whose program asked for the mouse is a left click at that cell; otherwise it only focuses |
| reading | the focused pane every second, the others every two |

Web: `web/src/pages/Pane.tsx`, `term/tiles.ts`. Android:
`ui/ViewScreen.kt`, `Layout`. Feature pages: core `web-client.md`
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
| attention · alert | `#ffb000` · `#ff3b3b` | `#39ff14` · `#ff3b3b` | `#9a5b00` · `#a3161b` |
| Claude | `#d97757` | same | same |

Pixel font (Press Start 2P) for the brand and panel titles, monospace
for everything else. Effects, on by default and off by a setting: glow,
scanlines, vignette, power-on, pulsing marks, inverted selection. Sharp
corners, box drawing, no gradients.

### 1.6 Actions and their triggers

The same action on every client, triggered the way the device does it.

| Action | Web key | Android | Glasses / MIDP |
|---|---|---|---|
| back to the list | `Esc` | `‹`, system back | back |
| open the selected pane | `Enter` | tap | select |
| pick several | `space`, `[ ]` | hold | — |
| next / previous tile | `]` / `[` | tap the tile | — |
| show the neighbouring pane of the strip | `}` / `{` | swipe | D-pad left / right |
| next arrangement | `l`, `▦` | `▦` | — |
| close a tile | `x`, `×` | `×` | — |
| fit on / off, again | `f`, `r`, button | `⤢` tap, hold | — |
| fit every tile | `F` | — | — |
| the window view | `w`, `window ▸` | — | — |
| the board | `b` | — | — |
| go to a pane | `p`, `≡` | the strip | — |
| theme | `t` | setting | setting |
| effects | `m` | setting | — |
| help | `?` | — | — |

A new action gets a row here before it gets a key anywhere.

## 2. Web only

| Feature | Why only here |
|---|---|
| window view (`/w/…`, "mirror layout") | the host's own arrangement needs the room of a screen; the list's window buttons and `w` open it; `=` gives every split equal shares, on the host too with fit on |
| boards (`/b/…`) | long-lived arrangements across hosts, kept per browser |
| selector (`p`) | a keyboard is at hand |
| sign-in with an identity provider | a browser has the flow |
| browser notifications, tab title flash | the browser's own channels |
| font size for fit (`?` then *font*) | the cell the host is sized by; Android uses its *text* setting |
| keyboard shortcuts as the primary interface | keyboard first |

Feature page: `docs/features/web-client.md`.

## 3. Android only

| Feature | Why only here |
|---|---|
| connect screen, connect code (QR) | a phone has a camera and no keyboard worth typing a token on |
| settings screen (*every*, *lines*, *text*, *reflow*, *block screenshots*, *hardware keyboard*, *effects*) | the device's own constraints |
| swipe between panes, pinch zoom, drag to page a full-screen program | touch |
| reflow with fit off | small screens |
| hardware keys and D-pad | glasses touchpads and keyboards reaching the phone |
| watch and background notifications | the phone's own channels |
| `FLAG_SECURE` | the platform's screenshot block |

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
