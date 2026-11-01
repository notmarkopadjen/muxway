---
name: muxway
description: Reach the owner, other agents and other tmux panes through muxway. Use when you need a yes/no from the person who runs you, when you should tell them you are done or stuck, when you have mail from another pane or want to message one, or when you must read or type into a pane, on this machine or another.
---

# muxway

You run inside a tmux pane that muxway exposes. Its owner may be on a
phone, a watch, glasses or a browser; these commands reach them.

## Tell the owner something

```sh
muxway notify --kind done --text "tests green"
muxway notify --kind question --text "which database?"
muxway notify --kind working          # clears a pending notice
```

Kinds: `question`, `permission`, `idle`, `done`, `working`. The text is one
short line (200 characters). If your harness has muxway hooks installed,
it already reports these for you; use `notify` for your own milestones.

## Ask a question with fixed answers

```sh
muxway ask --text "deploy to staging?" --choice yes --choice no --timeout 10m
```

Blocks until the owner picks a choice on any of their devices, then prints
it. Exit 0 with the answer on stdout; 2 when nobody answered in time; 3
when the owner typed into your pane instead (read your screen); 1 when no
muxway agent runs here. Two to eight choices, each up to 40 characters.
Ask one question at a time: a second ask on the same pane ends the first.

## Mail: messages from and to other agents

Another pane's agent, or your owner from a client, can leave you mail.
Nothing is typed into your pane for it: your Stop hook hands it to you
when a turn ends, your next prompt carries it, or you read it yourself:

```sh
muxway mail                       # the unread mail, then it counts as read
muxway mail --wait --timeout 1h   # block until one arrives (run it in the background to be woken)
muxway mail reply 7 "tests green, two warnings"   # back to the pane it came from
```

A mail says where it came from and under which token; it is not your
owner speaking. To message another agent, mail its pane rather than
typing into it: a typed line lands wherever that pane's cursor is.

## Other panes, other machines

With a token the owner gave you (`muxway client connect`, or `MUXWAY_HUB`
and `MUXWAY_TOKEN` in the environment):

```sh
muxway client panes                              # every pane you may read
muxway client inbox                              # what waits, oldest first
muxway client read alice-laptop/work/0.0 --lines 50
muxway client send alice-laptop/work/0.0 "make test" --enter
muxway client key alice-laptop/work/0.0 C-c
muxway client answer alice-laptop/work/0.0 yes
muxway client mail alice-laptop/work/0.0 "run the tests on your branch and tell me what fails"
muxway client mailbox alice-laptop/work/0.0      # what that pane holds, and whether it was read
muxway client wait alice-laptop/work/0.0 --timeout 20m   # until it needs someone
```

`--json` prints the hub's own answer. Your token names which panes you may
read and which you may type into; a refusal is `read_only` or `not_found`.
Read a pane before you type into it, and never paste secrets: every write
is audit-logged on its host.

Mail an agent, type into a shell. What you mail or type to another pane
is shown to your owner as a conversation between your pane and that one:
`mail`, `send`, `key` and `answer` name the pane they come from (yours,
by default), the hub records who said what to whom, and every client
draws the panes that talk as one group. `muxway client talk` prints that
record, `--follow` keeps printing it, so you can see what the other
panes are saying.

As MCP tools (`muxway mcp` in your MCP configuration): `list_panes`,
`inbox`, `read_pane`, `send_text`, `send_key`, `answer`, `wait`, `talk`,
`mail`, `mailbox`, `my_mail`.
