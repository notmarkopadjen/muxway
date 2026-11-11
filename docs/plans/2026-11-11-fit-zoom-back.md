# Feature: the fit back from a zoom is always sent

> Status: approved by the owner on 2026-11-11 in the console ("Do the
> fix"), after the cause of the red run [#340](https://github.com/notmarkopadjen/muxway/issues/340)
> was read from its artifact.

## 1. Goal

Browser spec 122 (three of four panes as tiles, zoomed in on one and
out again, every tile back at its ask) failed on CI at the header-zoom
merge: the zoomed pane was left at 28 columns for a 42-column ask. The
agent's audit log shows the page re-fitting the two other tiles after
the second `z` and sending nothing for the zoomed pane, so the host
never heard the zoom-out. It is a race in the web client, not the
spec: the tile that comes back spares a fit the listing says the host
already has, and the listing is a poll that can predate the zoom. After
this change the fit that brings a pane back from a zoom this page made
is sent whatever the listing says. Out of scope: zooms made by another
client, which this page learns of from the listing as before.

## 2. Design

`useFit` (`web/src/term/useFit.ts`) keeps, next to `kept`, the set of
panes this page last asked zoomed (`zoomedHere`): added when a fit with
`zoom` is sent, dropped when a fit without it is answered, released or
the page left. The decision whether a fit is spared moves to a pure
function, `spared` in `web/src/term/spare.ts`: a pane is spared when it
is kept, the listing has it at the size asked (zoomed, when the fit
asks a zoom) **and** the fit does not take it back from a zoom this
page made. Nothing else changes: the tiles still remount across a
change of count, the poll is still the listing.

```mermaid
sequenceDiagram
    participant T as tile (web)
    participant H as hub
    participant A as agent
    T->>H: GET pane (poll)
    T->>H: resize zoom (z)
    H->>A: zoom
    A-->>H: 135×29 zoomed
    H-->>T: 42×29 (poll answered first, before the zoom)
    H-->>T: 135×29 zoomed (resize answer; not written to the listing)
    Note over T: z again: tiles come back, new tile asks 42×29
    Note over T: before: listing says 42×29, nothing sent, pane stays zoomed
    T->>H: after: resize 42×29 (the pane was zoomed here)
    H->>A: unzoom and fit
    A-->>T: 42×29
```

## 3. Protocol and API changes

None.

## 4. Security analysis

None: one more resize the page already sends in every other order of
events, under the same write grant, audited as before.

## 5. Privacy check

The plan, the code and the test name the test fixture's `alice-laptop`
only.

## 6. Test plan

| # | Test | Kind | Expected |
|---|------|------|----------|
| 1 | `spare.test.ts`: a kept pane at its ask is spared; a zoom asks the listing's `zoomed`; a pane zoomed here is never spared by a fit without zoom; an unknown pane is sent | unit | pass |
| 2 | spec 122, both tests, in the full browser suite | UI | pass; `122-tiles`, `122-zoomed`, `122-back` |
| 3 | spec 75 (zoom) and the rest of the suite | e2e, UI | unchanged |

## 7. Documentation

`docs/features/web-client.md` and the fit row of `docs/ui-guideline.md`
say that a pane zoomed here is sent all the same when its tiles come
back.

## 8. Implementation steps

1. `spare.ts` with `spared` and its test.
2. `useFit.ts`: `zoomedHere`, `spared` in `send`, cleared on release.
3. The two doc pages.

---

## Review (after implementation)

- [x] Diff matches the plan
- [x] Security rules (AGENTS.md section 2) hold: no grant, log or input changes
- [x] Privacy check passed: `scripts/prepush-check.sh` clean and diff read
- [x] Docs updated

## Test run

- Full suite on the fixed tree (`20261111-173146-d11a035`, run before
  the commit): [#345](https://github.com/notmarkopadjen/muxway/issues/345),
  295 Go tests, 199 browser specs, two failed: 62 (a read-only account
  in the window view) and 119 (the observer's share), both with
  `net::ERR_NETWORK_CHANGED` in the trace, the browser dropping a
  request while Docker added an interface on the box; neither touches
  the fit. Spec 122, both tests, and 75 passed.
- The same tree with specs 62 and 119 alone in the browser, the Go
  suite in full: [#346](https://github.com/notmarkopadjen/muxway/issues/346),
  passed.
