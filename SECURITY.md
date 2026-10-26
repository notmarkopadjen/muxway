# Security policy

muxway gives remote access to terminal sessions. A flaw in it can hand an
attacker a shell, so security reports come before everything else.

## Reporting a vulnerability

Do not open a public issue, and do not describe the flaw in a pull
request. Use one of these:

- GitHub's private vulnerability reporting: the repository's **Security**
  tab, *Report a vulnerability*.
- E-mail: `<security contact e-mail: to be provided>`. Encrypt to the
  PGP key `<fingerprint: to be provided>` if the report contains an
  exploit or a captured token.

Say what you found, how to reproduce it (a request, a pane name, a
screen), what it gives an attacker, and which commit or release you
tested. A proof of concept against your own hub and host is welcome;
never against someone else's.

## What to expect

| Step | Within |
|---|---|
| Acknowledgement | `<N>` days (target: 3) |
| First assessment and severity | `<N>` days (target: 7) |
| Fix or mitigation for a high or critical finding | `<N>` days (target: 30) |
| Public disclosure | after the fix is released, or `<N>` days after the report (target: 90), whichever comes first, agreed with you |

Credit goes in the release notes and `<the acknowledgements page: to be
provided>` if you want it; say so in the report.

## Supported versions

| Version | Supported |
|---|---|
| `main` | yes |
| the latest release | yes |
| anything older | no: upgrade first |

## Scope

The hub, the host agent, the web client and the protocol in this
repository. Reports are most welcome on:

- authentication and sign-in: tokens, sessions, OpenID Connect, pairing;
- authorisation: read and write grants, exposed and unexposed panes, the
  admin grant, address allow and deny lists;
- transport: the agent's channel to the hub, TLS, headers, CORS;
- input on its way into tmux: text, keys, mouse, resize, files for the
  inbox;
- information leaks: a secret in a response, a log, an error, a listing;
- rate limits and lockouts that can be bypassed;
- the browser client: injection through pane content, stored credentials,
  cross-origin behaviour.

Out of scope: denial of service against your own hub, findings that need
root on the host already, the security of tmux or of the programs run in
a pane, and social engineering.

## Design decisions to know before reporting

Some things are deliberate and documented in `docs/features/` and
`AGENTS.md`: panes are opt-in and nothing is reachable until the host's
owner marks it; the hub never sees a host's shell except through the
agent's narrow operations; the file inbox is off unless the agent is
started with `--inbox`. A report that one of these should be tightened is
still welcome; it is handled as a design discussion rather than a
vulnerability.

## Safe harbour

Research done in good faith against your own installation, within this
policy, will not be reported to anyone or met with legal action by the
maintainers. `<legal wording to be confirmed by the owner>`
