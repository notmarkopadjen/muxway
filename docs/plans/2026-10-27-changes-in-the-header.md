# Feature: the changes counted in the tile's header, and a taller header

## 1. Goal

The changes window shows how a pane's repository stands, but only once it
is opened. The owner wants the overview without opening anything: the
counts of changed files in the tile's header, at its right next to `×`,
on every tile whose pane works in a repository the host shows. The count
is the way in: a click on it opens the changes window, which also makes
`⎇` findable from the tile itself. Along with it the tile header grows to
twice its height, with larger type and controls a finger can hit.

Out of scope: the window view's cell headers (they mirror the host's
layout, where rows are dear), the Android client (the changes window is
web-only), the branch's history.

## 2. Design

**The header's count.** A writable tile on a host with `preview` asks
`GET /v1/panes/{address}/git` with the same query the changes window
uses, so one request serves both: every ten seconds for the header,
every five while the window is open (the smaller interval wins, as the
query is shared), only while the tab is in the foreground. The header
draws, before `×`:

| answer | drawn |
|---|---|
| a repository with changes | `⎇ +3 ~5 −1` as the window's bar counts them (`+` added or untracked, `~` modified or renamed, `−` deleted, `!` conflict), the `!` in the warn colour |
| a clean repository | `⎇ ✓` dim |
| `404` (no repository, no roots, no git) | nothing; asked again every sixty seconds, since the pane may `cd` into one |
| `429` or the hub unreachable | the last counts stay |

The count is a button titled `changes (g)`: a click opens the changes
window on that tile (focusing it first), a second click closes it; while
the window is open the button is lit like the `⎇` tool. A read-only
tile, or a host without roots, shows nothing and asks nothing.

**A taller header.** `.mx-tile-head` goes from one line of 12 px type
with 1 px of padding (about 18 px) to twice that: a 36 px row, 14 px
type, the mode's pixel word 10 px, `×` and the count as full-height
buttons. The painting rules for *waiting* and *working* are unchanged.
Overflow keeps its order: the attention text shrinks first, then the
address and size; the count and `×` never shrink.

**The hub's burst.** Four tiles and an open window ask at once when the
view opens, so the status limit's burst goes from three to six; the
rate stays one a second per principal.

```mermaid
sequenceDiagram
    participant C as Client
    participant H as Hub
    participant A as Agent
    Note over C: a writable tile opens, host has roots
    loop every 10 s (5 s with the window open; 60 s after a 404)
        C->>H: GET /v1/panes/{address}/git
        H->>A: git-status {pane}
        A-->>H: {entries, …} or no_file
        H-->>C: 200 or 404
        C->>C: header: ⎇ +3 ~5 −1, ⎇ ✓, or nothing
    end
    C->>H: a click on the count: the changes window opens, same query
```

## 3. Protocol and API changes

None to the shapes. The status endpoint's burst is six instead of three
(`docs/protocol/v1.md`), a compatible loosening.

## 4. Security analysis

- No new reach: the same endpoint, the same write grant and writable
  pane, the same roots. A reader's tile asks nothing.
- More requests: a tile polls while the view is open and the tab is in
  the foreground. Per pane and principal that is six status reads a
  minute, each one audit line on the hub and the agent; four tiles make
  twenty-four lines a minute. The owner should know the audit grows
  this way; the alternative, auditing only the window's reads, would
  hide reads from the log, so the lines stay.
- The burst of six is still one request a second sustained; a status
  read is `git status` under `--no-optional-locks` with a ten second
  timeout, so the agent's cost is bounded as before.
- Nothing new is drawn from the answer but counts, as text.

## 5. Privacy check

The UI root's repository is made by the test with `alice` as the
committer; the screenshot is of the test environment.

## 6. Test plan

| # | Test | Kind | Expected |
|---|------|------|----------|
| 1 | Seven status reads in a row | e2e-security | the seventh is `429` (test 164 updated from the fourth) |
| 2 | A read-only tile and a pane outside a repository | UI | no count in the header; the hub saw no status request for the read-only pane |
| 3 | A tile in the UI repository | UI | the header reads `⎇ +6 ~2 −1`; a click opens the changes window with the same counts in its bar and lights the button; a second click closes it; screenshot `web-changes.png` retaken |
| 4 | The header's height | UI | at least 32 px, `×` and the count as tall as the row |
| 5 | `countOf`, `summary` | unit | unchanged, already covered |

## 7. Documentation

`docs/features/changes.md` (the header's count, the burst), `docs/
protocol/v1.md` (the burst), `docs/ui-guideline.md` §1.4 header row and
the changes row in the key table, `docs/features/web-client.md`,
README's feature line.

## 8. Implementation steps

1. Hub: `changesBurst = 6`; test 164.
2. Web: `useChanges` takes the interval (ten seconds, sixty after a
   404); the Tile asks when writable and the host previews, draws the
   count button, opens the window; the header's styles.
3. Spec 103 extended; screenshot.
4. Docs.

---

## Review (after implementation)

- [x] Diff matches the plan. Deviations: the header and the window
  share one query, so a 404 slows the window's poll to a minute too;
  the window still re-asks when the pane's output settles, so a `cd`
  into a repository shows at once while it is open. One addition the
  owner asked for in the same round: the screen no longer draws the
  browser's focus ring (a light bar around the pane) when direct typing
  focuses it; the `▮` prompt and the status bar say where keys go. The
  taller header broke the one-window fit's row match (spec 100): the
  fit sent a proportional layout and let tmux split rows the headers
  had taken, so a stacked tile lost a row per header, two now. The fit
  sends an exact layout measured from the tiles' screens instead
  (`exactLayout`), the sync recognises its own layout coming back, and
  the spec lets a tile across from a stack hold up to three spare rows.
  With exact sizes a host split within a cell of even (50/49 of 99
  columns) must read as even, or it comes back as 66/64 at a wider
  size: the tiles' adoption of a host layout (`fromHost`) reads such
  shares as equal (spec 99); the window view's mirror stays exact (spec
  62). A 429 on the status is asked again after a second, and only a
  404 slows the poll to a minute (spec 103 under the full run's load).
- [x] Security rules hold: the same endpoint, grant, pane and roots;
  only the burst changed, and every status read is still audited.
- [x] Privacy check: `scripts/prepush-check.sh` clean and the diff
  read; the fixtures are the test's repository with `alice`.
- [x] Docs: `changes.md`, protocol, guideline, web client.

## Test run

Run `20261027-123559-1027274`: 152 tests passed, 0 failed (Go end-to-end
test 164 updated; specs 103, 99, 100 updated, screenshot `web-changes`
retaken); recorded as the test-run issue linked from the commit.
