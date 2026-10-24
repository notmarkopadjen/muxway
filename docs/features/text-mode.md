# Text mode

Text mode is the hub's answer for clients too small for JSON and colour: a
feature phone, a pair of glasses, a script with `curl`. Ask for it with
`Accept: text/plain` on `GET /v1/panes` and `GET /v1/panes/{address}`.

## What it does

- Pane listings come one pane per line, tab-separated: address, mode,
  command, title, pending attention.
- Pane content comes as the last `lines` rows, escape sequences and
  control characters removed, tabs expanded, trailing blanks trimmed,
  rewrapped to `width` columns, one row per line.
- Responses carry an `ETag`; `If-None-Match` gets a `304` when the pane
  has not changed, so polling costs a few bytes.

```mermaid
flowchart LR
    A[agent: pane content] --> S[strip escapes and control characters]
    S --> F{charset}
    F -- utf-8 --> W[wrap to width]
    F -- latin1 / ascii --> T[fold: lines, symbols, letters] --> W
    W --> E[encode, Content-Type names the charset]
```

## Charsets

The smallest phones cannot show Unicode: a 2002 Nokia has no glyph for
`─` and decodes bytes as Latin-1 unless told otherwise, so a rule drawn
by Claude Code arrives as rows of odd glyphs, three bytes per character.
`charset=latin1` or `charset=ascii` makes the hub rewrite the content
before wrapping (and, on the pane list, each pane's command and title), and the answer's `Content-Type` says what was sent:
`text/plain; charset=iso-8859-1` or `charset=us-ascii`. Without the
parameter, or with `charset=utf-8`, nothing changes.

| Characters | Become |
|---|---|
| horizontal lines `─ ━` and dashed variants | `-`; the double line `═` becomes `=` |
| vertical lines `│ ┃ ║` and dashed variants | `\|` |
| corners, tees and crosses | `+` |
| diagonals `╱ ╲ ╳` | `/ \ X` |
| block elements `▀ ▄ █ ░ ▒ ▓` | `#` |
| `❯ › » ▶ ▸ ⏵ ➜ →` | `>`; `‹ « ◀ ←` `<`; `↑` `^`; `↓` `v` |
| bullets `● • ○ ◦ ■ □ ▪ ◆ ★ ☆`, braille spinners, Claude Code's `✳` | `*` |
| `·` | `.`; `…` `...`; `— – ‐ −` `-`; `×` `x`; `✓ ✔` `v`; `✗ ✘ ✖` `x`; `⚠` `!` |
| curly quotes, no-break space | `'`, `"`, a space |
| letters with marks (Latin-1 Supplement, Latin Extended-A) | the base letter; `ß` `ss`, `æ` `ae`, `œ` `oe`, `þ` `th`, `ĳ` `ij` |
| anything else the charset lacks | `?` |

In `latin1` the characters Latin-1 has (`ä`, `é`, `ñ`, `»`, `·`) stay as
they are; only those beyond it are folded. `…` becomes three characters
and `─` one, so folding runs before wrapping and rows still fit `width`.

## Security considerations

The parameter changes how content the token may already read is encoded.
It is matched against three fixed values and refused otherwise with
`400 bad_parameter`, before the agent is asked. Folding maps each
character to a fixed short string, at most three bytes, so a body cannot
grow past three times the agent's cap. Nothing about it is logged.
