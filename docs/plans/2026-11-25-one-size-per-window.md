# Feature: one size per window

## 1. Goal

A pane's size is decided in three places today, and they disagree:

1. **The tile** measures its box and asks for `cols × rows`, per pane
   (`web/src/term/useFit.ts`).
2. **The agent** re-negotiates the ask: floors, growth, up to four rounds
   of `ResizePane`, a per-window map of every other pane's fit
   (`internal/tmux/tmux.go`, `internal/agent/agent.go`).
3. **tmux** moves the window on its own: an attach, a split, a layout
   change, a release back to automatic sizing.

On top of that the screen **always scales the font** so whatever size came
back fills the box (`Screen.tsx` → `fontFor`). So every disagreement is
visible as a jump in type size, and disagreement is the normal state: with
two clients open, the `held by` / refit-on-touch rule (at most one refit
every two seconds) means the window belongs to whoever moved last and the
other client letterboxes until someone touches it.

This plan replaces all of it with one rule:

> **A tmux window has one size. The view being used sets it, the host
> obeys it verbatim and keeps it, and the cell never changes size.**

The size is muxway's record, not tmux's idea — a window stays at the size
the last view gave it whether or not anyone is attached at the host. The
owner accepted that trade in the decision below.

In scope: the resize path end to end (web client, hub, agent, tmux), the
font rule, the `held` wording, and the new-pane-opens-focused bug reported
with it.

Out of scope: the window view's own `+`/`-` cell scaling (it stays a
per-cell zoom of the drawing, not a resize), the share observer's view
(an observer never sizes anything), transcription, mail, inbox.

## 2. Design

### 2.1 The viewport

A client that shows panes of a window declares one **viewport** for that
window, never a size per pane:

```
viewport = { cols, rows, layout?, zoom? }
```

- Showing **every** pane of the window as tiles: `layout` is the exact
  tmux layout the tiles make (`exactLayout`, already written), `cols × rows`
  its root. Each pane gets exactly the cells its tile can draw.
- Showing **one** pane of a window that has others: `zoom: true`. The
  window becomes `cols × rows` and tmux's own zoom gives the shown pane all
  of it. No floors, no growth, no squeezed neighbours.
- Showing **some but not all** of a window's panes (two of three): the
  tiles' tree beside a stack of the panes not open, exact to the cell
  (`someExact`). This landed with
  [some-window](2026-11-11-some-window.md) while this plan was being
  written and is the right answer; what it left out is the case below.
- A window group of **one** tile inside a view that has several. Today
  such a tile falls back to a per-pane fit and is *held*, because the
  window fit is only sent for the group with two or more tiles. This is
  exactly the state in the screenshots this plan comes from: two tiles of
  two windows, both `held`. It becomes window scope with `zoom`, as the
  one-tile-in-the-view case already is: no layout, no renumbering, and it
  works where a sibling is read-only, which the stacked layout cannot.

`scope: "pane"` leaves the web client's vocabulary. It stays in the
protocol for the clients that already speak it (see §3).

### 2.2 The window's owner: the last command wins

The agent keeps, per window:

```go
type viewport struct{ Cols, Rows int; Layout string; Zoom bool }
type lease struct {
    by      map[string]viewport // client key -> its last viewport, capped at 8, LRU
    owner   string              // client key of the last command
    sizedBy tmux.SizedBy        // what the listing reports
}
```

A **command** is anything a client does to a pane: input, a key, a mouse
event, a resize, opening the pane, or a client re-sending its viewport
because the application got the focus. On a command from client `C` on a
pane of window `W`:

- if `owner == C`, nothing happens;
- else if `by[W][C]` exists, the agent applies it and `owner = C`;
- else `owner = C` with no resize (a client that never declares a
  viewport — the feature phone, the glasses, a text-mode reader — never
  moves a window, however much it is used).

There is no two-second gate, no refusal, no `held` negotiation. The view
in the person's hands always wins, at once.

```mermaid
sequenceDiagram
    participant W as Web (in hand)
    participant P as Phone (left open)
    participant H as Hub
    participant A as Agent
    W->>H: resize {cols 126, rows 34, zoom}
    H->>A: resize
    A->>A: by[win][web] = 126x34; owner = web; resize-window
    A-->>H: pane at 126x34
    P->>H: (poll) list
    H-->>P: pane 126x34, sized_by web
    Note over P: draws it scaled to its box, says "sized by web"
    P->>H: input "y" (the person picks up the phone)
    H->>A: input
    A->>A: owner != phone, by[win][phone] = 80x24 → apply it
    A-->>H: ok
    Note over W: next listing says sized_by phone; web scales until touched
```

### 2.3 The agent enforces the size

`window-size` is already marked manual by `resize-window`. Two things are
added:

- The viewport is **not released when a view is left.** A window keeps the
  size the last view gave it. `fit: auto` stays, for a client that wants to
  hand a window back to tmux and for the CLI; the web client stops sending
  it on unmount, on `pagehide`, and through the service worker. That
  removes `releaseKept`, the keepalive release, the worker relay and the
  release-after-429 retry.
- The agent **re-applies** the lease when tmux has moved the window behind
  its back: after a split, a kill-pane or a layout change on that window,
  and in the watcher's tick when the window's size differs from the lease.
  This is the "fake window" the owner asked for.

`ResizePane`'s four rounds, the `fits`/`fitters` maps and
`GrowLayout`-for-fits go away. `ResizeWindow(cols, rows, layout, zoom)`
stays and becomes the only path: `resize-window -x -y`, `select-layout`,
zoom. The floor is the client's business — it knows the tiles — and the
agent clamps only to what tmux cannot go under, reporting what was applied.

### 2.4 The cell never changes size

```
cols × rows = floor(inner(box) / cell at the person's font size)
```

and the screen draws at **that** font. Not at a font computed from the
frame that happens to have arrived.

| the tile | the cell |
|---|---|
| owns the window, host caught up | the person's font size, exactly |
| owns the window, host catching up | the person's font size; the older frame is drawn in it, clipped or padded, until the new one lands |
| another client owns the window | scaled so the host's `cols × rows` fills the box (`fontFor`), header: `sized by <token> · <client>` |
| fit off | scaled, as today |

The third row is the owner's answer to the question asked on
2026-11-25: a passive view letterboxes and shows what the active client
sees; touching it takes the window over at once.

Pinning the font to the asked size is the single change that removes most
of the flicker: today a frame at the old size is drawn at one font, the
frame at the new size at another, so every resize is two type sizes and a
reflow. `HOLD_FRAME_MS` drops from 3000 ms to 600 ms with the font pinned,
because the held frame no longer reads as a different screen.

### 2.5 The rest of the flicker

| source | fix |
|---|---|
| a `429` from the agent's burst limit, retried at 1.1 s, measured again, sent again | the agent **coalesces** instead of refusing: the latest viewport per window is kept and applied at most ten times a second. `429` stays as a security limit, far above the interactive rate (§4) |
| four tiles of one window each sending a fit | one viewport per window, as §2.1 |
| `adopt` taking the host's layout back while the tiles' own is in flight | unchanged in shape, but with one writer per window the 3 s `touched` window can drop to 1 s |
| release on leaving → tmux resizes → next open resizes again | no release (§2.3) |
| the font feeding back into the measurement | the measurement uses the fixed cell from `measureCell()`, never the current rendered font; the scrollbar gutter is always reserved |

### 2.6 The new pane opens focused

Reported with this: `+ pane` from the pane view adds a tab but leaves the
view on the old tiles, with the tab mid-strip.

Two causes, to be confirmed by the specs in §6 before the fix:

1. **The desk pulls the view back.** `Pane.tsx` navigates to the three
   addresses and sets `focusNext`; `writeDesk` sends the new desk half a
   second later (`DESK_DEBOUNCE_MS`). A desk read landing in that window —
   another client of the same person, the 15 s poll, a desk event — is
   newer than `knownDesk()` (which still holds the two-tile desk) and
   newer than its `rev`, so it is applied and `go(panes)` navigates back to
   two tiles. The tab stays, because the tab comes from the listing.
   **Fix:** a view with an unsent local change holds the newer desk. Note
   the local desk at the moment of the change, not at the moment of the
   write, and ignore an incoming desk whose `rev` is not greater than the
   one the local view was derived from.
2. **The tab lands mid-strip.** The guideline says a new pane's tab goes
   last; it goes where the listing puts it, and tmux numbers panes by
   place, so a pane split from the first tile lands between the tabs.
   **Fix:** a pane this client created is pinned to the end of the tab
   order when it is made.

## 3. Protocol and API changes

`POST /v1/panes/{address}/resize` — **compatible**, v1 keeps its number.

- `scope: "window"` with `cols`, `rows`, an optional exact `layout` and an
  optional `zoom` is unchanged on the wire and becomes the only thing the
  web client sends.
- `scope: "pane"` (and no scope, its default) is **deprecated**. It stays
  accepted for the clients that ship it today. Its meaning is simplified
  and documented: the window is sized in one pass so the pane gets
  `cols × rows` under the window's current layout; the neighbours keep
  their shares; no multi-round negotiation, no per-window memory of other
  panes' fits. The answer says what the pane actually got, as now.
- `fit: "auto"` is unchanged and still releases a window to tmux. What
  changes is that the web client no longer sends it on leaving a view.
- The spec gains a paragraph: **a viewport is kept.** A window stays at
  the size it was last given until another viewport or a release; closing
  the view that gave it does not hand it back.
- The spec's "the client touched last wins" paragraph is rewritten: the
  rule moves from the client (refit on touch, at most every two seconds)
  to the host (any command re-applies that client's viewport, at once).
- `sized_by` in the listing keeps its shape and its meaning (who the
  window's size belongs to). The clients' word for it changes from
  `held by` to `sized by`.

No new endpoint. A focus claim is the client re-sending its viewport,
which needs nothing new.

## 4. Security analysis

- **What an attacker gains.** Resizing is already a write and already
  needs a write grant on a pane marked for writing; this plan does not
  widen that. It *removes* a limit on how often a size can change for a
  principal that already holds the grant, so the cost of the change is
  host CPU: `resize-window` and `select-layout` per request.
  Mitigation: the agent coalesces per window (at most ten applications a
  second, the last one wins) and the hub keeps a per-token request limit
  that answers `429` well above any interactive rate. The agent's
  per-window burst stays as a floor against a client that bypasses the hub.
- **Authorisation.** Unchanged: a write grant matching the address and a
  pane marked `write`. A read-only principal cannot declare a viewport and
  cannot take a window over; a read-only client draws scaled, always.
  Re-applying a viewport on a *command* must re-check the grant of the
  client whose viewport is re-applied, not only of the client that sent
  the command — the two are the same principal in practice, but the check
  is made on the stored viewport's actor at apply time, and a stored
  viewport whose actor no longer has the grant is dropped.
- **Trust boundary.** `cols` (20–500), `rows` (5–300), `layout`
  (≤ 2048 bytes, must name exactly the window's panes, checksum parsed)
  and `client` (1–32 printable, no outer blanks) are validated exactly as
  today; none of the validation is relaxed. The client key the lease is
  stored under is derived host-side from the token id and the validated
  label, never from a client-supplied key.
- **Memory.** The lease is bounded: at most 8 client viewports per window,
  LRU, and the whole record goes when the window goes. A window that keeps
  its size forever keeps one small record, not a growing one.
- **Logging.** The audit line for a resize is unchanged: who, when, which
  pane, the size. No pane content, no token, no secret. The client label
  is already in the listing and in the audit line and stays there.
- **New dependencies.** None.

## 5. Privacy check

No real host, person, service or secret. Diagrams and examples use
`alice-laptop`, `web`, `Pixel 9` and sizes. Screenshots are taken against
the e2e environment's throwaway tmux server. The two screenshots the owner
sent to report the bug are **not** committed and are not described by
name, content or host anywhere in the repository.

## 6. Test plan

Security tests first.

| # | Test | Kind | Expected |
|---|------|------|----------|
| 1 | A read-only token declares a viewport | e2e-security | `403 read_only`; the window's size does not move |
| 2 | A read-only token sends input on a pane another client sized | e2e-security | refused as today; the window's size does not move, no lease taken |
| 3 | A viewport naming a layout with a pane of another window | e2e-security | `400 bad_parameter`, unchanged |
| 4 | `cols`/`rows` outside 20–500 / 5–300, `layout` over 2048 bytes, `client` label with a control character or 33 characters | e2e-security | `400 bad_parameter` each |
| 5 | A stored viewport whose grant was revoked, then a command from that client | e2e-security | the viewport is dropped, not applied; no resize |
| 6 | 200 resizes in a second from one token | e2e-security | the host applies at most ten, the rest coalesce or `429`; the agent does not spawn 200 tmux calls; no error in the log names a token |
| 7 | No response or log line from any resize carries pane content or a token | e2e-security | grep of the run directory is clean |
| 8 | One pane of a one-pane window, tile resized | e2e | the window is exactly the tile's `cols × rows`; the pane too |
| 9 | One pane of a three-pane window, shown alone | e2e | window = viewport, pane zoomed, the siblings untouched underneath |
| 10 | All three panes of a window as tiles | e2e | the exact layout is applied; each pane has the cells its tile draws; no pane under the floor |
| 11 | Two of three panes as tiles | e2e | nothing is sent; the panes keep their size; both tiles draw scaled |
| 12 | A view is left and the pane opened again | e2e | the window is still at the size it had; no release was sent; the second open sends nothing |
| 13 | The agent is restarted, then a pane is read | e2e | the window still has its size (tmux holds the manual mark) |
| 14 | A split, then a listing | e2e | the window is back at the lease's size after the split moved it |
| 15 | Client A sizes a window, client B sends input | e2e | B's stored viewport is applied at once; the listing's `sized_by` names B |
| 16 | Client B has no stored viewport and sends input | e2e | the window does not move; `sized_by` names B |
| 17 | A text-mode client (no viewport ever) reads a pane heavily | e2e | the window never moves |
| 18 | `fit: auto` | e2e | the window is handed back to tmux, unzoomed, as today |
| 19 | A tile that owns its window, through a resize | UI (`135-one-size.spec.ts`) | the rendered font size is identical before and after; screenshots `before`, `in-flight`, `after` |
| 20 | Two tiles side by side of different windows | UI (`135-one-size.spec.ts`) | both draw at the same font size; screenshot `two-tiles` |
| 21 | A tile whose window another client owns | UI (`136-sized-by.spec.ts`) | header says `sized by <token> · <client>`, the screen is scaled; a click takes it over and the font returns to the person's; screenshots `passive`, `taken-over` |
| 22 | The browser window dragged narrower and wider | UI (`135-one-size.spec.ts`) | one resize is sent after the drag stops, not one per step; the font does not change; screenshot `after-drag` |
| 23 | `+ pane` from the pane view with two tiles open | UI (`134-new-pane.spec.ts`) | three tiles, the new one focused, its tab last in the strip; screenshots `before`, `after` |
| 24 | `+ pane` while a desk read of the older view lands in the debounce | UI (`134-new-pane.spec.ts`) | the view keeps three tiles; the older desk is not applied |
| 25 | `+ session` from the pane view, and `+ pane` from the pane list | UI (`134-new-pane.spec.ts`) | the new pane opens focused from both paths |
| 26 | `measureCell`, `cellsFor`, the viewport chosen for a box | unit (vitest) | the cell is independent of the rendered font; the viewport is the box divided by the cell |
| 27 | The lease: owner changes, LRU cap at 8, drop on grant loss, re-apply after a split | unit (Go) | as §2.2 |
| 28 | `exactLayout` unchanged | unit | existing tests pass untouched |
| 29 | The existing fit specs (`60`, `61`, `63`, `64`, `75`, `76`, `77`, `99`, `122`, `128`) | UI | rewritten where they assert the old negotiation; each one's new expectation listed in the commit that changes it |

## 7. Documentation

- `docs/protocol/v1.md`: the resize section rewritten (§3), `scope: "pane"`
  marked deprecated with its simplified meaning, the kept viewport, the
  host-side last-command-wins rule, the coalescing limit.
- `docs/features/web-client.md` and a new `docs/features/sizing.md`: one
  page for the whole model, with the sequence diagram of §2.2 and a state
  diagram of a window's size (automatic → owned by a client → owned by
  another → released).
- `docs/ui-guideline.md` §1.4: the `fit` row rewritten — it is the longest
  row in the table and most of it describes machinery this plan removes.
  The new row states: the cell is the person's font size and never scales
  while the view owns the window; one viewport per window; a subset of a
  window's panes sends nothing; `sized by <token> · <client>` and a touch
  takes it over at once; a viewport is kept when the view is left. The
  key table's `fit on / off, again` row keeps `f` and `r`.
- `docs/ARCHITECTURE.md`: the paragraph on sizing.
- The client repositories (`muxway-android`, `muxway-glasses-even`,
  `muxway-midp`) are untouched by this plan and keep working on the
  deprecated `scope: "pane"`; an issue per repository follows in the next
  round, not here.

## 8. Implementation steps

Each step builds and passes tests on its own.

1. **Reproduce the new-pane bug** with `134-new-pane.spec.ts` (tests
   23–25). Done: the desk race takes the new tile away again, and the
   new pane's tab lands mid-strip. *(The second cause turned out not to
   be the tab order alone: a pane made here is pinned by its pane id,
   which a layout does not renumber, not by its address.)*
2. **Fix it**: a view with an unsent desk applies no incoming one
   (`deskPending`); a pane made here goes last in the strip
   (`web/src/term/made.ts`). Specs green.
   *(This lands first and on its own: it is the bug the owner is hitting
   today and it does not depend on the rest.)*
3. **Web, the viewport per window**: every window group of open tiles
   declares one, whatever its size — a group of one with `zoom`, a group
   of two or more with the exact layout
   [some-window](2026-11-11-some-window.md) added. No tile is then held
   by its own window. Specs 8–11, 19–20.
4. **Agent**: the lease record, last-command-wins, coalescing, re-apply
   after a split or a layout change, the LRU cap and the grant re-check.
   Go unit tests (27).
5. **Agent/tmux**: `ResizePane`'s rounds and the `fits`/`fitters` maps
   removed; `scope: "pane"` reduced to one pass; `ResizeWindow` the only
   path. Go unit tests, e2e 8–18.
6. **Hub**: the resize limit retuned (§4), the audit line unchanged, the
   listing's `sized_by` fed from the lease.
7. **Web, keeping the size**: `releaseKept`, the keepalive release and
   the service-worker relay go; the view sends no `fit: auto` on leaving.
   Unit tests (26), e2e 12–13.
8. **Web, drawing**: the font is the person's while the view owns the
   window; scaled only when another owns it or fit is off; `HOLD_FRAME_MS`
   to 600 ms; `held` becomes `sized by`. UI specs 19–22.
9. **Existing specs** rewritten (29), run by run, each in its own commit.
10. **Docs** (§7) in the commits that change the behaviour they describe.
11. **`make e2e`**, the run recorded as a `test-run` issue, this plan's
    *Test run* filled in.

---

## Review (after implementation)

- [ ] Diff matches the plan, deviations explained here
- [ ] Security rules (AGENTS.md section 2) hold
- [ ] Privacy check passed: `scripts/prepush-check.sh` clean and diff read
- [ ] Docs and diagrams updated

## Test run

- Steps 1–3 (the new pane, and one viewport per window):
  [#355](https://github.com/notmarkopadjen/muxway/issues/355), passed at
  `5716b97`, 295 tests, 0 failed. Run directory
  `20261125-152443-5716b97`.
  - Two specs failed on `origin/main` on the same machine before any of
    this landed, and are fixed in step 3: 77 assumed its window started
    unfitted, 76 dragged a divider a fixed distance from wherever it
    began. The cause is general — a page closed without navigating away
    sends no release, and a release gives a window its size back but
    only restores the saved proportions once — and about 27 specs
    assume a window starts unfitted. Step 7 keeps the viewport and
    releases nothing, so each of those specs will have to start from a
    state it sets itself; `releaseWindow` in `web/e2e/fixtures.ts` is
    there for it.

---

## Decisions for the owner

1. **A window keeps its size for good.** No release when a view is left.
   A window a browser once showed at 126×34 stays 126×34 at the host, so a
   terminal attached there sees a window that does not match it. You said
   you never attach at the host; this is that trade, written down.
2. **A subset of a window's panes sizes nothing** (§2.1). Two tiles of a
   three-pane window draw scaled instead of fighting over the window.
3. **`scope: "pane"` is deprecated, not removed**, so the Android, glasses
   and MIDP clients keep working unchanged until their own round.
4. **Input takes the window over** (§2.2), not only a resize. Typing on
   the phone moves the window to the phone's size. That is what "the
   active client is the one who sent the latest command" asks for, and it
   is worth naming because it means a stray keypress on a forgotten device
   resizes what you are looking at — until you touch yours, which takes it
   straight back.
