# Feature: some of a window's panes as tiles fit the window as one

> Status: approved by the owner on 2026-11-11 in the console, from a
> screenshot of three tiles of one window at 83×40, 20×40 and 20×40,
> all *held*: "Is it the consequence of maintaining the same size on
> the backend? Can we pass that restriction? … we can make a fake layout
> which can fit all of our sizes on the server and it doesn't need to
> show well on the server." Then "go" to the plan below.

## 1. Goal

Tiles of one window whose other panes are closed each fitted their own
pane inside the host's shape, and the shape could not hold them: a pane
spanning the window pins its width to its tile's, the row below shares
it, and the rest fall to the floor of 20 columns, drawn scaled and
*held*. Every zoom in and out showed it again. After this change two or
more tiles of one window are laid out on the host as the tiles are,
each pane exactly its tile's cells, and the window's panes not open in a
thin stack at the right at the floor; the window grows to the sum. The
terminal at the host shows a big, odd window; that is accepted.

Out of scope: a window with a pane the principal may not write, which
keeps today's per-pane fits (moving panes on the host needs the grant
on all of them); the Android client, which fits per pane; the window
view, which already lays the window out as it shows it.

## 2. Design

The client only (`web/src/pages/Pane.tsx`, `web/src/term/tiles.ts`,
`web/src/term/useFit.ts`); the hub and the agent take the request they
already take.

- The open tiles are grouped by window. The window with two or more
  tiles (the most, the first tile's on a tie) is fitted as one through
  one writable pane of it, as the one-window fit does today; the other
  tiles fit their own panes. With every pane of the window open nothing
  changes: the tiles follow the host's layout and may be arranged on it.
- With some panes not open, the layout sent is the tiles' tree less the
  other windows' tiles (`someTree`: the surviving splits keep their
  keys, so the weights still apply) beside a stack of the hidden panes.
  Exact (`someExact`): the tiles their cells, the stack `HIDDEN_COLS`
  (20) wide, its panes sharing the tiles' height at 5 rows each at
  least, the host growing the window when they need more. The host
  then has the open panes exactly as the tiles show them, so no tile is
  held, and a zoom in and out comes back to the same layout.
- The window is fitted only when every pane of the window is writable
  in the listing, since the layout moves panes on the host; the hub
  checks the same (`arrange`) and the agent keeps its rule. A refusal
  all the same (a pane the listing lacks, say) is told to the view by
  `useFit`'s new `onRefused`, and the tiles fit their own panes as
  before until the tiles change.
- The arrangement stays on the host after the view is left, as an
  arrangement of a whole window does: a release gives the size back,
  not the old places.

```mermaid
sequenceDiagram
    participant V as pane view (3 of 5 panes as tiles)
    participant H as hub
    participant A as agent
    V->>H: resize, scope window, exact layout: tiles as arranged + stack of the 2 hidden at 20 cols
    H->>H: every pane of the window writable for this token? (arrange)
    H->>A: resize, arrange
    A->>A: resize-window to the sum, lay out, floor kept
    A-->>V: the window's panes, each open one its tile's cells
    Note over V: a zoom in sizes the window to the browser; the zoom out sends the same layout again
```

## 3. Protocol and API changes

None: a window-scope resize with a layout naming every pane, under the
rules the protocol has.

## 4. Security analysis

The same request under the same grants: moving panes on the host still
needs the write grant on every pane of the window, checked by the hub
and the agent; a token without it never moves a pane and gets per-pane
fits. Audited as every resize. A layout names pane ids the listing
gave; nothing else crosses the boundary.

## 5. Privacy check

Fixtures only (`alice-laptop`).

## 6. Test plan

| # | Test | Kind | Expected |
|---|------|------|----------|
| 1 | spec 133: a window with a pane the token may not write: no layout goes to the host, the tiles fit per pane, the window keeps its shape | UI, security | pass |
| 2 | `tiles.test.ts`: `someTree` takes the other windows' tiles out and keeps the keys; `someExact` lays the tiles exact and the stack at the floor; `someLayout` names every pane | unit | pass |
| 3 | spec 133: three of five panes as tiles: one layout for the window, every open pane as the layout says, the hidden two stacked at the right at 20 columns, the window the sum, nothing held; zoom in and out leaves it so; leaving gives the window back (`133-three-of-five`, `133-back`) | UI | pass |
| 4 | the one-window specs (100, 122) and the rest of the suite | e2e, UI | unchanged |

## 7. Documentation

The fit row of `docs/ui-guideline.md` and the tiles section of
`docs/features/web-client.md`.

## 8. Implementation steps

1. `tiles.ts`: `someTree`, `someLayout`, `someExact`, with tests.
2. `useFit.ts`: `onRefused`.
3. `Pane.tsx`: the group, the fit through it, the fallback.
4. Spec 133 and the docs.

---

## Review (after implementation)

- [x] Diff matches the plan
- [x] Security rules (AGENTS.md section 2) hold: the same grants, checked server-side
- [x] Privacy check passed: `scripts/prepush-check.sh` clean and diff read
- [x] Docs updated

## Test run

Recorded below once the suite has run.
