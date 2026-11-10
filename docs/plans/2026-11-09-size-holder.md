# Feature: who holds a window's size, and the client touched last wins

> Status: written 2026-11-09 from the owner's decision in the console,
> after the Android client's `docs/plans/2026-11-09-held-scale-and-ghost-right.md`
> showed three of the owner's own clients fitting one pane in turns.
> Approved 2026-11-09 evening in the console and implemented on the
> branch `size-holder`. The Android half is
> `docs/plans/2026-11-09-last-client-wins.md` in `muxway-android`.

## 1. Goal

A pane the owner reads in the browser at the desk, on a phone and on a
foldable is fitted by all three: each asks for the pane's whole window
at its own cells, and when the host drifts from its size each sends
once more and then backs off, saying *held*. The agent's audit log on
the owner's host shows the browser asking `197×42` and the phones
`49×48` and `96×42` for the same window within seconds, and the window
ending up at whichever asked last. On the narrow phone a 197-column
pane is either specks or re-cut rows; only the host taking the phone's
size reads well. The rule the clients follow today, written for two
clients fighting, is the right rule for two *unattended* clients and
the wrong one for the client the person is actually using.

Two changes, decided by the owner:

1. **The protocol says who holds the size.** Every pane in the listing
   and in a read carries `sized_by`: the token name and the client
   label of the last fit that sized its window, when it was, and
   whether that fit was this principal's. A client can then tell the
   host's floor or a terminal at the host (nobody holds it) from
   another client (someone does), say so in its header (*held by web*),
   and decide whether to take the size back.
2. **The client touched last wins.** A client whose pane another client
   holds sends its fit again when the person interacts with the pane
   there: types, sends a key, focuses the tile, opens the view. A client
   nobody is touching stays backed off, as now. So the browser tab left
   open at the desk stops reclaiming a pane the owner is reading on the
   phone, and the first word typed on the phone gives the phone the
   size. Two people typing into one pane from two clients still fight,
   and that is what they are doing.

Out of scope: the text-mode listing (the glasses and the MIDP phone
never fit a pane, so the column is not added now and would be a
compatible addition later); detecting a size set by a terminal at the
host (the agent does not know who resized tmux from outside; `sized_by`
names the last muxway fit, and a client reads drift from the size as it
does now); any change to the floor, the zoom or the release.

## 2. Design

### 2.1 The holder, on the agent

The agent executes every resize and already keeps, per window, the pane
sizes the fits gave (`fits`) and the panes that fitted it (`fitters`).
It gains `holders map[windowID]holder{actor, name, client string; at
int64}`: set on every successful resize that carries `cols` and `rows`
(pane or window scope, with or without a layout, zoom or not), left as
it is by an arrange-only request (a layout without a size), and deleted
by a release (`fit: auto`), by the window being given back when its
fitters are gone, and by the window going away. The wire request gains
`actor_name` (the principal's name) and `client` (the label below), both
only on resizes; the agent's audit line gains `client`.

The agent's listing annotates every pane of a held window with
`SizedBy{Actor, Name, Client, At}` from the map. The hub's `view` turns
it into JSON and drops the actor id, adding `mine` by comparing the id
with the principal's; a pane whose window nobody holds has no
`sized_by`.

```mermaid
sequenceDiagram
    participant P as Phone (token phone, client Pixel 9)
    participant B as Browser (token web, client Chrome)
    participant H as Hub
    participant A as Agent
    B->>H: POST resize {cols:197, rows:42, scope:window, zoom:true, client:"Chrome"}
    H->>A: resize actor=web-id actor_name=web client=Chrome
    A->>A: tmux resize-window; holders[@1] = {web, Chrome, now}
    A-->>H: ok
    H-->>B: pane 197×42, sized_by {token:web, client:Chrome, mine:true}
    P->>H: GET /v1/panes
    H->>A: list
    A-->>H: pane 197×42 + SizedBy{web-id, web, Chrome}
    H-->>P: sized_by {token:web, client:Chrome, at, mine:false}
    P->>P: header "197×42 held by web · Chrome"; no fit sent, nobody is typing here
    Note over P: the owner types a word on the phone
    P->>H: POST resize {cols:49, rows:48, scope:window, zoom:true, client:"Pixel 9"}
    H->>A: resize actor_name=phone client=Pixel 9
    A->>A: holders[@1] = {phone, Pixel 9, now}
    H-->>P: pane 49×48, sized_by {mine:true}
    B->>H: GET /v1/panes (its poll)
    H-->>B: pane 49×48, sized_by {token:phone, client:Pixel 9, mine:false}
    B->>B: header "49×48 held by phone · Pixel 9"; nobody is typing here, it stays
```

### 2.2 The client label

The resize body gains an optional `"client"`: 1 to 32 characters,
printable, no control characters, no leading or trailing blank; the hub
refuses anything else with `400 bad_parameter` and treats an absent
label as the request's `X-Muxway-Client` header, or `""`. The web sends
its browser's family (`Chrome`, `Firefox`, `Safari`, else `browser`),
the CLI `cli`, the Android client the device's model (`Build.MODEL`,
ASCII only, cut to 32). The label is the fitter's own description of
itself for the other clients' headers and the audit log; it grants
nothing, is compared with nothing and is shown as text.

### 2.3 The listing and a read

```json
"sized_by": {"token": "web", "client": "Chrome", "at": 1767225600, "mine": false}
```

On every pane of a window a muxway fit holds, in `GET /v1/panes`,
`GET /v1/panes/{address}`, the tree, the window read and the answer to
a resize; absent when nobody holds the window. `token` is the fitting
principal's name as the admin named the token (or the user's name for a
signed-in user), `client` its label (may be `""`), `at` the fit's time,
`mine` whether the requesting principal sent it. The id is never
given. An agent before this change gives no `sized_by`: a client treats
that as *unknown* and keeps the rule it has.

### 2.4 The web client: touched last wins

`useFit` already has `refit`. `Pane.tsx` calls it for the focused tile
when `sized_by` names another principal (`mine` false) or another
client of the same principal (`client` differs from this page's label)
and the person interacts with the pane: the input line sends, direct
typing sends a key or text, the tile is clicked into focus, or the
page gains focus with the view open. At most one refit per pane every
two seconds; none while `sized_by` is mine or absent. The header's
*held* becomes *held by `<token>` · `<client>`* when the holder is
another, stays *held* (the floor, a terminal) when nobody holds it, and
the tooltip on the name says the same. The window view does the same for
its one fit.

### 2.5 State

```mermaid
stateDiagram-v2
    [*] --> Nobody: window never fitted, or released
    Nobody --> Mine: this client's fit lands
    Nobody --> Other: another client's fit lands
    Mine --> Other: another client's fit lands (drift; header "held by …")
    Other --> Mine: the person interacts here, refit lands
    Other --> Other: another client's interaction, its refit lands
    Mine --> Nobody: release (view left, fit off)
    Other --> Nobody: the holder releases
```

## 3. Protocol and API changes

- `POST /v1/panes/{address}/resize`: optional `"client"` (string, 1 to
  32 printable characters) on a body with `cols` and `rows`; refused
  with `400 bad_parameter` otherwise; ignored on a release and on an
  arrange-only body.
- Pane objects everywhere gain the optional `"sized_by": {"token",
  "client", "at", "mine"}`.
- Agent channel: the `resize` request gains `actor_name` and `client`;
  the listing's panes gain `sized_by` with the actor id, which the hub
  strips. Version: compatible; an older agent gives no `sized_by`, an
  older hub ignores `client` (it rejects unknown fields today: the
  hub is deployed before the clients send it, as every protocol change
  is).

## 4. Security analysis

- **What an attacker gains.** Nothing new to do: `sized_by` is read
  with the pane, so only a principal who may read the pane learns which
  token name and client label sized its window. The token's id never
  leaves the hub. A write grant is still needed to resize, as before.
- **Input across the boundary.** The client label: length, printable
  characters and no control characters checked by the hub, `400`
  otherwise; carried to the agent as a string, written to the audit log
  and the listing as a string, drawn as text by the clients (React
  escapes; Compose draws text). It is never used to look anything up.
- **Rate.** A refit on interaction is bounded by the client's own
  two-second gate and by the host's existing bucket (four at once per
  window, then one a second); a hostile client gains no more resizes
  than it has today.
- **Fighting.** Two people typing in two clients still trade the size;
  that is the honest outcome of the rule the owner chose, and each
  header says who has it. A client that nobody is touching never sends.
- **Logged.** The audit line gains the client label; no secret, no pane
  content.
- **Dependencies.** None added.

## 5. Privacy check

The plan, the tests and the docs use `alice-laptop`, `phone`, `web`,
`Pixel 9` as a label and `Chrome`; the owner's audit log is quoted in
shape only. No host name, person or secret of the owner's appears.

## 6. Test plan

| # | Test | Kind | Expected |
|---|------|------|----------|
| 1 | A read-only token's resize with a `client` is still `403`; `sized_by` on its listing names the writer, `mine` false; the holder's token id appears nowhere in any response | e2e-security | as stated |
| 2 | A `client` of 33 characters, with a control character, or empty → `400 bad_parameter`; nothing resized, no holder set | e2e-security | as stated |
| 3 | A label with `<`, `"` and `&` comes back in `sized_by` as the same string, JSON-escaped, and is drawn as text in the web header (spec) | e2e-security + web spec | no markup interpreted |
| 4 | Refits on interaction are held by the window's bucket: a burst of typed keys gives at most the bucket's resizes; the others are not sent (client gate) | e2e + web spec | ≤ 4 then 1/s |
| 5 | After token A's window fit, `sized_by` is `{A, "Chrome", at, mine}` for A and `mine: false` for token B on every pane of the window; absent for a window never fitted | e2e | as stated |
| 6 | A pane-scope fit sets the holder too; an arrange-only body leaves it; `fit: auto` clears it; the window given back when its fitters are gone clears it | e2e | as stated |
| 7 | The hub's audit line carries `client`; the agent's too | e2e | present |
| 8 | Web spec: two pages on one pane, B holds; typing on A refits once, A holds, B's header reads *held by phone · …* and B sends nothing while idle | web spec | as stated |
| 9 | Web spec: a tile whose holder is itself never refits on typing | web spec | no request |
| 10 | Older-agent shape: a listing without `sized_by` leaves the web's header at *held* and its rule unchanged | unit (web) | as stated |

Security tests first (1 to 4). Every run recorded as a test-run issue.

## 7. Documentation

- `docs/protocol/v1.md`: the resize body, the pane object, the agent
  channel.
- `docs/features/web-client.md`: the *held* rows, *held by*, the rule.
- `docs/ui-guideline.md` §1.4 *fit* row: the holder and the
  touched-last rule, for every client that fits (web, Android).
- A new `docs/features/fit.md` is not opened; the fit lives in the
  web-client page and the guideline today, and this keeps to that.

## 8. Implementation steps

1. Wire and agent: `actor_name`, `client`, `holders`, `SizedBy` on the
   listing, audit; agent unit tests.
2. Hub: the label validated, passed on, `sized_by` with `mine` in
   `view`; e2e tests 1 to 7.
3. Web: the label, the header, the refit on interaction; specs 8 to 10.
4. Docs; the guideline row; the run; the pull request. Deploy after the
   merge, before the Android client sends `client`.

## Review (after implementation)

- [x] Diff matches the plan. Deviations: an empty `client` is an absent
  one (the body's `""` and no field are the same thing), so the label
  falls back to the client's kind from its headers, `go-http-client` for
  a bare Go client; the audit line carries the label last, after
  `result`, so the lines the tests and the owner's eyes know keep their
  shape; the web treats the same principal from another client (two
  phones on one token) as *other*, by the label, which the plan said
  for Android and the web does the same; the window view refits on a
  touch but has no *held* word to extend. Nothing else.
- [x] Security rules hold: the label is checked for length and
  printability before anything leaves the hub, carried and shown as
  text, compared with nothing; the token id never leaves the hub (Sec226
  searches every answer for one); a refit on a touch stays under the
  window's bucket (Sec229); a read-only token sees the holder and cannot
  resize (Sec226); nothing new is logged but the label.
- [x] Privacy check passed: the secret scan and the deny-list grep over
  the branch's commits are clean, the diff read; the tests name
  `alice-laptop`, tokens `phone`, `web`, `writer`, `viewer` and
  `handset`, the labels `Pixel 9` and `Chrome`.
- [x] Docs and diagrams updated: the protocol's resize body, pane object
  and agent channel; the web client page's *held* passage; the
  guideline's *fit* row; this plan's diagrams.

## Test run

The full suite, 287 tests, 0 failed, at `f49bf44`
([#332](https://github.com/notmarkopadjen/muxway/issues/332),
`20261109-182012-f49bf44`): the Go end-to-end tests with the five new
ones (Sec226 to Sec229, Flow227), the web's unit tests with the
holder's, and the browser specs with 128 (126 was taken by the echo spec on main by the time this merged). The first run at `4a8b6c9`
([#331](https://github.com/notmarkopadjen/muxway/issues/331), closed)
failed three tests on the tests' side: two layout tests read the audit
line with `rows=` next to `result=`, and the admin spec counts tokens
named `phone`, which the control endpoint had made one of; both fixed
in `f49bf44`.

After the merge of main (the echo on the input's answer, #327 and #329)
into this branch: the conflict was the input mutation's one line (the
touch note and `read=1` both kept), the held-by spec became 128, and
spec 62 compares a host layout read twice the same, since the host
settles its own layout a moment after the size is given back.
[Run 20261110-081450-0a699aa](https://github.com/notmarkopadjen/muxway/issues/336):
passed, 293 tests, at `0a699aa`; CI green on the same commit.

