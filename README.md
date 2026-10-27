```
┌─ muxway ─┐
```

Your tmux, from anywhere. A hub, a small agent per machine, and clients
from the browser to a phone, a watch, smart glasses and a 2002 feature
phone. Security first: a tmux pane is a shell.

![Four panes from two machines on one screen: an AI agent asking for a permission tall on the left, a build above a log and a docker host on the right](docs/images/tiles.png)

> Young, and used daily by its author. The hub, the agent, the protocol,
> the web client, notifications from AI coding agents and sign-in with
> OpenID Connect are all in; the
> [Android](https://github.com/notmarkopadjen/muxway-android),
> [glasses](https://github.com/notmarkopadjen/muxway-glasses-even) and
> [Java ME](https://github.com/notmarkopadjen/muxway-midp) clients are
> in their own repositories. Expect the protocol to grow, not to break.

## Only here

What sets muxway apart from the other ways of reaching a terminal from
a browser or a phone:

<table>
<tr>
<td width="72" valign="top"><img src="docs/images/icons/tiles.png" width="54" alt=""></td>
<td><strong>Panes from several machines in one view.</strong> Up to four tiles from
any mix of hosts, sessions and windows: the build on your workstation
beside the logs on a server and an AI agent on your laptop, all live
and typable. Drag a header to swap two tiles or split a place, drag a
divider to resize; tiles that are one window's panes move that window
on its host as you rearrange them here.</td>
</tr>
<tr>
<td valign="top"><img src="docs/images/icons/voice.png" width="54" alt=""></td>
<td><strong>Voice input.</strong> Hold the microphone in the browser, on the phone, on
the watch or on the glasses. The hub transcribes, the words land on
the input line for you to read, and nothing is sent until you say so.</td>
</tr>
<tr>
<td valign="top"><img src="docs/images/icons/files.png" width="54" alt=""></td>
<td><strong>Files both ways.</strong> Paste a screenshot, drop a PDF, pick a zip, and
it lands in an inbox on the host with its path on your line, for the
program in the pane to read. The other way round, a path a pane prints
is a link: a click shows the file over the page, an image, a PDF, a
plan in Markdown, a CSV, with a download, from the inbox or from the
directories the host's owner opened for it.</td>
</tr>
<tr>
<td valign="top"><img src="docs/images/icons/notify.png" width="54" alt=""></td>
<td><strong>Your AI agent calls you.</strong> An AI coding agent in a pane tells muxway,
through its hooks, when it asks a question, wants a permission, has
gone idle or has finished. The pane lights up in every client, the
phone and the watch buzz, the glasses show a banner, and you answer
from wherever you are: a tap, a key, a few typed words, a spoken
reply. Claude Code is the agent tested so far; another needs its hooks
to call <code>muxway notify</code> on the host, and a lens for its screen.</td>
</tr>
<tr>
<td valign="top"><img src="docs/images/icons/clients.png" width="54" alt=""></td>
<td><strong>Clients down to a 2002 feature phone.</strong> The API is small and text
mode is plain text, so a browser, an Android phone with a Wear OS
watch, Even Realities G2 glasses and a Java ME MIDlet in 30 KiB are
all clients, and yours can be too.</td>
</tr>
<tr>
<td valign="top"><img src="docs/images/icons/keys.png" width="54" alt=""></td>
<td><strong>Direct keyboard input.</strong> Type as you would at the terminal. A key
bar covers what a phone keyboard lacks, the web adds a full terminal
keyboard (F1 to F24, Ctrl, Alt, the keypad) and the mouse for programs
that take it. Every key goes through a fixed grammar, never a raw
escape sequence.</td>
</tr>
<tr>
<td valign="top"><img src="docs/images/icons/lens.png" width="54" alt=""></td>
<td><strong>A lens for tiny screens.</strong> A lens knows an agent's screen and
reshapes it, so the conversation fits on a watch, on glasses, or on a
96 by 65 pixel Nokia.</td>
</tr>
</table>

## Why

**Built like a remote shell service, because it is one.** Panes are
opt-in: nothing is reachable until its owner marks it. A token names
which hosts and panes it may read, and separately which it may type
into. Input is text and a fixed grammar of keys, never raw escapes.
Every authentication step is rate limited and locked out, every write is
audit logged on the host, secrets are hashed, compared in constant time
and never logged. One Go binary per role, one third-party dependency,
no cgo.

**Anything that can speak HTTP is a client.** The clients prove it: a
React web app served by the hub itself, an Android app with a Wear OS
face, an Even Realities G2 app, and a Java ME MIDlet that fits in 30
KiB. Build your own from the [protocol specification](docs/protocol/v1.md).

## How it works

```mermaid
flowchart LR
    subgraph Clients
        W[Web]
        AN[Android + Wear]
        G[Glasses]
        J[Java ME]
    end
    H[(Hub)]
    subgraph Host[Each machine]
        A[Agent] --- T[tmux]
        AI[AI coding agent] -- hooks --> A
    end
    W & AN & G & J -- "HTTPS, token or session" --> H
    A -- "outbound WSS, signed and encrypted" --> H
```

The **agent** runs next to tmux on each machine, dials out to the hub,
and exposes only the panes its owner marked. The **hub** authenticates
clients, enforces grants, relays reads and input, and serves the web
client from files embedded in its binary. Clients never reach a machine
directly. Read [the architecture](docs/ARCHITECTURE.md) for the whole
picture.

## Quick start

```sh
go install github.com/notmarkopadjen/muxway/cmd/muxway@latest

# on the hub (behind a TLS proxy here; see the docs for direct TLS)
muxway hub serve --listen 127.0.0.1:7600 --public-url https://hub.example.com --trust-proxy &
muxway hub pair-code --host alice-laptop

# on the machine with tmux
muxway agent pair <code>
muxway agent run &
muxway expose -t work:1.0 --write --name build
muxway hooks claude-code   # hooks so Claude Code in a pane can call for you

# back on the hub: a token for a client
muxway hub token create --name phone --read 'alice-laptop/*' --write 'alice-laptop/@build'
```

Open `https://hub.example.com/` in a browser and paste the token, or
sign in with your identity provider if the hub has one. For scripts and
small clients, a pane is one request away:

```sh
curl -H "Authorization: Bearer $TOKEN" -H "Accept: text/plain" \
  "https://hub.example.com/v1/panes/alice-laptop/@build?width=40&lines=20"
```

[Hub and agent](docs/features/hub-and-agent.md) has the flags, the
service units, the reverse proxy, backups and token rotation.

## The web client

Served by the hub, nothing to install. The pane list groups every host
you may reach; a badge marks a pane that needs you.

![The pane list: two hosts, their sessions and windows, an AI agent's pane waiting for a permission](docs/images/panes.png)

A pane running an AI agent is named by what the agent says it is doing,
the header carries its question, and the command row offers the agent's
slash commands; a shell's gets its recent lines. The Claude Code lens is
the one there is today.

![A single pane with Claude Code asking whether to run a git commit](docs/images/claude.png)

Amber by default; phosphor green, and paper for daylight.

| Green | Paper |
|---|---|
| ![the green theme](docs/images/green.png) | ![the paper theme](docs/images/paper.png) |

On a phone the keys stay under the thumb and the pane buttons fold
behind one `⋯`.

| A pane on a phone | The pane buttons, folded |
|---|---|
| <img src="docs/images/phone.png" alt="The pane view on a phone-sized screen" width="300"> | <img src="docs/images/phone-tools.png" alt="The pane buttons as a menu on a phone" width="300"> |

A path printed in a pane opens the file over the page, with a download;
a plan here, a screenshot or a PDF the same way.

![A Markdown plan previewed in a window over the pane](docs/images/preview.png)

An admin sees the hub's live log, tokens and users, connected clients
and agents, and the address allow and deny lists.

![The admin page](docs/images/admin.png)

The features: [web client](docs/features/web-client.md),
[keyboard](docs/features/keyboard.md),
[notifications](docs/features/notifications.md),
[sign-in](docs/features/sign-in.md),
[attachments](docs/features/attachments.md),
[preview](docs/features/preview.md),
[changes](docs/features/changes.md),
[transcription](docs/features/transcription.md),
[new panes and sessions](docs/features/new-panes.md),
[admin](docs/features/admin.md),
[text mode](docs/features/text-mode.md).

## The other clients

| Client | What it does | Get it |
|---|---|---|
| [**muxway-android**](https://github.com/notmarkopadjen/muxway-android) | Panes on a phone, one per screen or side by side, set up by scanning a code. A Wear OS watch face, complication and tile show which panes wait; a tap opens a pane's tail on the wrist with a few answers and the microphone. | [Latest APKs](https://github.com/notmarkopadjen/muxway-android/releases/latest): the app, the watch app and the watch face |
| [**muxway-glasses-even**](https://github.com/notmarkopadjen/muxway-glasses-even) | Even Realities G2: the pane list at a glance, a pane through the Claude Code lens, a banner when it needs you, and a reply from a fixed set or by voice. | On the Even Hub: to be provided. Until then, pack it yourself |
| [**muxway-midp**](https://github.com/notmarkopadjen/muxway-midp) | Java ME, MIDP 1.0 and 2.0: list, read, reply and send keys from a Nokia 6310i over GPRS, through a small relay. | [Latest JARs](https://github.com/notmarkopadjen/muxway-midp/releases/latest): MIDP 2.0 and MIDP 1.0 |

| Even Realities G2: Claude Code through the lens | Nokia 6310i, 96 by 65 pixels: the same lens |
|---|---|
| <img src="docs/images/glasses.png" alt="Claude Code through the lens on the glasses" width="576"> | <img src="docs/images/midp.jpg" alt="A Nokia 6310i held in front of a laptop, Claude Code through the lens on its screen" width="226"> |

The clients are one product: [docs/ui-guideline.md](docs/ui-guideline.md)
says what every client shows and which key or gesture does what.

## Build your own client

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is the entry point and
[docs/protocol/v1.md](docs/protocol/v1.md) the contract: bearer tokens,
JSON and text mode, long-polled events, the key grammar, rate limits,
error codes, and how a client learns what a hub supports. Every flow has
a diagram.

## Contributing and security

Contributors and AI agents: read [AGENTS.md](AGENTS.md) first. It holds
the privacy rules (nothing personal ever reaches this repository), the
security rules, how a feature is planned, reviewed and tested, and the
build and test commands. Security issues: see [SECURITY.md](SECURITY.md).

muxway is free software under the [Apache License 2.0](LICENSE), as are
its clients.
