# Feature: charset on the text pane list

> Status: implemented 2026-10-24. A small follow-up to
> `2026-10-24-text-mode-charsets.md`, asked for by the MIDP client's
> plan "panes listed by the name the host reports".

## 1. Goal

The MIDP client is to list panes by the title the program in the pane
set, as Claude Code does (`✳ <session name>`), instead of by address.
The text pane list already carries `command` and `title`, but only in
UTF-8, which the smallest phones cannot show. The list takes the same
`charset` parameter as a pane read, and `✳` folds to `*`.

## 2. Design

`GET /v1/panes` in text mode reads `charset` exactly as a read does:
absent means UTF-8, a repeated or unknown value is `400 bad_parameter`.
`command` and `title` go through `text.Fold`, the body through
`text.Encode`, and `Content-Type` names the charset. Address, mode and
kind are ASCII by construction and unchanged. JSON mode ignores the
parameter. The fold table gains U+2733 `✳` as `*`.

## 3. Protocol and API changes

Compatible: a new optional query parameter on an existing endpoint, same
values and errors as `GET /v1/panes/{address}`.

## 4. Security analysis

The title and command are chosen by the program in the pane and already
limited by the hub to printable text of at most 256 bytes; the fold maps
each rune to ASCII or Latin-1 and cannot produce a tab or a newline, so
a title cannot forge a row or a column. No new grant, no new logging,
no dependency.

## 5. Privacy check

Tests use `alice-laptop` and the title `✳ bücher`.

## 6. Test plan

| # | Test | Kind | Expected |
|---|------|------|----------|
| 1 | Sec08: `/v1/panes?charset=utf-16`, repeated `charset` | e2e-security | 400 |
| 2 | Flow16: list with no charset, `latin1`, `ascii` after titling a pane `✳ bücher` | e2e | `✳ bücher` / `* b\xfccher` / `* bucher`, Content-Type per charset |
| 3 | fold unit: `✳` | unit | `*` |

## 7. Documentation

`docs/protocol/v1.md` (pane list), `docs/features/text-mode.md` (table).

## 8. Implementation steps

One commit: `charsetParam` shared by read and list, fold entry, tests, docs.

---

## Review (after implementation)

- [x] Diff matches the plan
- [x] Security rules hold: validation as on the read, nothing new logged
- [x] Privacy check: `scripts/prepush-check.sh` clean and diff read
- [x] Docs updated

## Test run

To be recorded.
