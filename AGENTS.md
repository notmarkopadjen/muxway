# AGENTS.md: muxway

Rules for anyone, human or AI agent, working on this repository. Read all of it before changing anything.

muxway lets you reach your tmux sessions from anywhere: a browser, an Android phone, smart glasses, even a 2002 feature phone. A small **agent** on each machine exposes the tmux panes its owner marks; a **hub** connects clients to agents over authenticated, encrypted channels; clients list panes, read them and type into them. Agents for AI coding CLIs that run in tmux add notifications: a client is told when an agent asks a question or finishes.

## 1. Privacy: nothing personal ever reaches GitHub

This repository will be public. Git history is permanent: a value that was
committed once can be recovered from history, forks and mirrors even after it
is deleted. Treat every commit as published.

Never commit, in code, comments, docs, tests, fixtures, screenshots, logs or
commit messages:

- host names, IP addresses, domains, ports or paths of any real machine
- names, e-mail addresses, phone numbers or account names of real people
- the names of private projects, services, companies or employers that use
  this project
- keys, tokens, passwords, certificates, session ids, cookies, TOTP secrets
- real tmux pane content, real shell history, real agent transcripts

Use placeholders instead: `hub.example.com`, `192.0.2.10` (RFC 5737),
`2001:db8::1`, `alice`/`bob`, `+15555550100`, `<token>`. Test fixtures are
synthetic. Screenshots are taken against the test environment only.

**Before every push** run the pre-push check (`scripts/prepush-check.sh`,
which needs [gitleaks](https://github.com/gitleaks/gitleaks) installed):
it runs a secret scanner over the outgoing commits and a grep for the
project's deny-list (`.denylist`, not committed, one pattern per line for
the owner's own host names, domains, numbers and names). Then read the full
diff yourself. If anything slipped into a commit, do not push: rewrite the
local history first. If it was already pushed, say so at once; rotating the
secret is the fix, deleting the file is not.

## 2. Security is the product

A tmux session is a shell. Whoever can type into a pane controls that
machine, so muxway is a remote shell service and is built like one.

- Every connection is authenticated and encrypted. No plaintext transport
  except to localhost, and no "trusted network" bypass.
- Least privilege: a client token names which hosts and panes it may read
  and which it may write. Read and write are separate grants.
- Panes are opt-in. Nothing is exposed unless the host owner marked it.
- Input is a narrow interface: text, and a fixed whitelist of named keys.
  No raw escape sequences from clients.
- Secrets are never logged, never echoed back, and compared in constant time.
- Rate limits and lockouts on every authentication step.
- Every write to a pane is audit-logged on the host: who, when, which pane,
  how many bytes (not the content).
- Dependencies are few, pinned and reviewed.
- When in doubt, deny. A feature that weakens any of the above needs an
  explicit decision by the owner, written down in the plan.

## 3. Open, documented architecture

Third parties are meant to build their own clients. The API is the product's
public face:

- The protocol is specified in `docs/` (in the core repository) before or
  together with the code that implements it, versioned, with examples.
- Every flow is explained with a diagram. Use Mermaid in Markdown (GitHub
  renders it): sequence diagrams for flows, state diagrams for lifecycles,
  class or component diagrams for structure. Use an image only when Mermaid
  cannot express it, and commit its source next to it.
- Every feature has a page in `docs/features/` describing what it does, how
  to use it, and its security considerations.
- Docs are updated in the same commit as the behaviour they describe.

## 4. Look and feel

Every user interface is retro and made for developers: terminal first,
monospace type, phosphor green or amber on black (and a light "paper
terminal" variant), box-drawing characters, pixel fonts for headings, sharp
corners, keyboard first, information-dense. No gradients, no rounded SaaS
cards, no stock illustrations. On tiny screens (feature phones, glasses)
retro is native: respect the device, do not imitate a bigger one.

The clients are one product. `docs/ui-guideline.md` says what every
client shows (naming, the lens, the pane list, the pane view with its
strip and tiles, the look, and which action each key or gesture
triggers), what is web-only and what is Android-only. A change to a
shared feature starts there and is made in every client that has it;
a key or gesture is added to its table before it is bound anywhere.

## 5. How work is done

Every feature follows `docs/templates/feature.md`:

1. **Plan.** Write the plan from the template and present it in the console
   for the owner to review: goal, design, API changes, diagrams, security
   analysis, test plan. No code before the plan is approved.
2. **Implement** the approved plan. Small commits, each building and passing
   tests.
3. **Local review.** Review the full diff against the plan, the security
   rules and the privacy rules above, and fix what is found.
4. **End-to-end tests.** Write and run them (section 6). A feature is not
   done until its end-to-end tests pass and the run is recorded.
5. **Docs.** Feature page, protocol changes and diagrams updated.

Until the project is public, work is pushed directly to `main`. After that,
every change goes through a pull request.

## 6. Testing

End-to-end tests carry the most weight, and security tests are first among
them. Every feature's test plan has a security section: authentication
missing, wrong or expired; a token used beyond its grants; replay; injection
through pane names, text and keys; oversized and malformed input; rate
limits; and that no secret appears in any response or log.

- End-to-end tests run the real binaries against a throwaway tmux server and
  a test hub, never against a real machine.
- Browser and UI tests use Playwright and plain `.html` fixture pages where
  a page is needed, so a test can be opened and replayed by hand.
- Every run writes a run directory: a summary, the full log of every
  component, and for UI tests a screenshot (and a trace) at each step and on
  failure.
- Every run is recorded as a test run: a GitHub issue labelled `test-run` (see `docs/testing.md`), with its
  date, commit, environment, result per test, and links to the logs and
  screenshots.

## 7. This repository

The core of muxway: the **hub**, the **host agent**, the **web client** and
the **protocol specification**. Native clients live in their own
repositories ([muxway-android](https://github.com/notmarkopadjen/muxway-android),
[muxway-glasses-even](https://github.com/notmarkopadjen/muxway-glasses-even),
[muxway-midp](https://github.com/notmarkopadjen/muxway-midp)) and
depend only on the published protocol.

- Language: Go, one static binary per role, no cgo. The web client is
  served by the hub from embedded files.
- `docs/ARCHITECTURE.md` is the entry point for anyone building a client.
- `docs/protocol/` is the API specification. A change there is a change to
  the public contract: version it and update the examples.
- `docs/features/` has one page per feature.
- `docs/plans/` holds approved feature plans.

Building and testing:

- `make build` builds the `muxway` binary; `make lint` runs `go vet` and
  the web client's eslint and prettier.
- `make test` runs the Go unit tests and vitest. `go test ./...` does
  **not** run the end-to-end suite: it is behind the `e2e` build tag.
- `make web` rebuilds the embedded web client into `web/dist`, which is
  committed and must match the sources (the suite checks that).
- `make e2e` runs `scripts/e2e.sh`: lint, unit tests, the dist check, then
  the end-to-end suite with a run directory under `test-runs/`. It needs
  tmux, Node 22 and Playwright's Chromium (`cd web && npx playwright
  install chromium`). `MX_GREP=<pattern>` runs only the browser specs
  whose title matches, for example `MX_GREP=94-hubs make e2e`.
- `scripts/record-run.sh <run directory>` records a run as the GitHub
  issue section 6 asks for; it needs `gh`, signed in.
