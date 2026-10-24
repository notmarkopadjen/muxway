# Feature: the microphone: spoken input in the browser and on the phone

> Status: approved by the owner on 2026-10-24. Asked for
> as "since we have voice input from the glasses now, make the microphone
> button as well to capture input, retro; do not show it on servers which
> don't have the transcriber".

## 1. Goal

The hub transcribes spoken clips for the glasses. The browser and the
phone have microphones too. A `◉` button on the input line records a
clip, sends it to the hub, and puts the words on the input line for the
person to read and then send, exactly as the glasses do. The button is
there only when the hub answers the transcriber probe and the focused
pane is writable; a hub without a transcriber shows nothing.

Out of scope: streaming while speaking; sending without reading back;
wake words; any change to the hub's transcription endpoint.

## 2. Design

```
> ______________________________________ ◉ [send]       idle
> ■ ▁▃▅▇▅▃▁ 4 s · click to stop        [cancel]        recording
> ⟳ hearing…                                             sent
> run the tests again                     ◉ [send]       heard: edit or send
```

```mermaid
sequenceDiagram
    participant P as Person
    participant C as Client
    participant H as Hub
    C->>H: GET /v1/transcribe (once per sign-in)
    H-->>C: 204 → the button shows; 404 → it does not
    P->>C: ◉ (or v)
    C->>C: mic opens, 16 kHz mono PCM kept in memory, meter drawn
    P->>C: ■ (or v, or 60 s)
    C->>H: POST /v1/transcribe, audio/wav
    H-->>C: {"text": "run the tests again"}
    C->>C: text on the input line, caret at its end, focus
    P->>C: Enter
    C->>H: POST input text, then Enter
```

**Web.** `term/recorder.ts`: `getUserMedia({audio: {channelCount: 1,
sampleRate: 16000, echoCancellation: true, noiseSuppression: true}})`,
an `AudioContext({sampleRate: 16000})` and an `AudioWorklet` module
served from the client's own files that posts frames of 16-bit PCM;
where the context cannot run at 16 kHz the frames are resampled on stop
by linear interpolation. The WAV header is the glasses' `wavFile`,
copied. The meter is the RMS of the last frame in block characters,
`▁▂▃▄▅▆▇█`, redrawn with each frame; the head counts seconds; 60 s stops
the clip, half a second is the least sent. `Esc` or *cancel* drops the
clip and closes the mic. The transcript replaces the input line's text
when that is empty, or is appended after a space, and focus goes to the
line. Errors as toasts: `microphone refused`, `no microphone`, `one clip
every five seconds`, `transcriber unavailable`, `too long`. Key: `v`.
The button sits between the field and *send*; the tracks are stopped
the moment recording ends, so the browser's recording indicator is
honest.

**Android.** The same button in the text row. First tap asks for
`RECORD_AUDIO`; `AudioRecord` at 16 kHz mono PCM16 fills a buffer up to
60 s; the same WAV; `Api.transcribe`; the text into the field. The probe
runs with the first pane list after connecting (and per hub, once
several hubs exist). The meter and the seconds are drawn in the field's
place while recording.

## 3. Protocol and API changes

None: `GET` and `POST /v1/transcribe` exist. `docs/protocol/v1.md`
gains nothing but a line naming the browser and the phone as clients.

## 4. Security analysis

- Audio goes to the hub only, over the session the page already has
  (same-origin cookie and client header) or the phone's bearer token, and
  from the hub only to the transcriber the owner chose. The client keeps
  the clip in memory for the request and drops it; nothing is stored or
  logged by the client.
- The hub's checks stand: write grant, WAV header, 4 MiB, one clip per
  five seconds per principal, 90 s on the transcriber, 64 KiB answer,
  text cleaned and capped. The client cannot bypass them.
- The transcript is shown before anything is sent; a hostile transcriber
  gets text on a line the person reads, nothing more, and the input
  endpoint's own checks apply when it is sent.
- The browser's permission prompt gates the microphone; the page never
  records without a click (`v` only while the pane view has focus and
  the field is enabled). The worklet is a file of the client's own,
  under the existing `script-src 'self'`; no CSP change.
- No new dependencies on either client.

## 5. Privacy check

Playwright records from Chromium's fake device (`--use-fake-device-for-
media-stream`); the test transcriber (`e2e/s1_transcribe_test.go`'s)
answers a fixed sentence. No real audio, no real text.

## 6. Test plan

| # | Test | Kind | Expected |
|---|------|------|----------|
| 1 | hub without a transcriber | e2e-security (UI) | no button, no probe repeated |
| 2 | read-only token, hub with a transcriber | e2e-security (UI) | no button on a read-only pane |
| 3 | a clip within five seconds of another | e2e-security (UI) | toast `one clip every five seconds`; the line unchanged |
| 4 | record, stop | UI | the meter and the seconds while recording; afterwards the line reads the sentence and has focus; nothing was sent; screenshots `93-recording`, `93-heard` |
| 5 | record, Esc | UI | mic closed, nothing posted (the fake transcriber counts) |
| 6 | the transcriber answers 502 | UI | toast `transcriber unavailable`, the line unchanged |
| 7 | `wavFile`, the resampler, the meter | unit | header fields; 48 kHz → 16 kHz length; RMS 0 for silence |
| 8 | Android: `Recorder` | unit | WAV header; the 60 s cap |

## 7. Documentation

- `docs/ui-guideline.md` §1.4 *input* row: the button; §1.6: `v` / tap.
- `docs/features/transcription.md`: a section per client; `web-client.md`
  Using it and Security considerations; Android `pane-view.md`.

## 8. Implementation steps

1. Guideline rows.
2. Web: recorder, worklet, meter, the button and the key, toasts; unit
   tests; the harness gains a UI environment with the test transcriber.
3. Web: spec 93; `web/dist`; docs.
4. Android: permission, recorder, button, probe; tests; docs; version.
5. Run, record, push.

---

## Review (after implementation)

- [x] Diff matches the plan. Deviations: a clip under half a second is
  not sent, the client says `too short` itself (and reads the hub's
  `400` the same way), `403` reads `no write grant`; `v` while recording
  stops the clip as `■` does and `Esc` drops it, through a listener that
  runs before the page's own keys so `Esc` does not leave the view
  mid-clip; the worklet posts a frame per tenth of a second and the
  meter shows the last eight; the probe is one query that never goes
  stale and is cleared with the session, not a flag; the UI harness got
  a second Go test with the transcription suite's stand-in hub rather
  than a switch on the main one, since the main hub must stay without a
  transcriber for the no-button case, and the one spec file serves both
  through `MX_STT`. Android: the clip (header, cap, meter) lives in the
  protocol module as `Clip`, pure and tested on the JVM, and `Recorder`
  only drives `AudioRecord` into it; refusals go to the status line
  under the input bar, where a refused send already shows, since the
  phone has no toasts; the transcribe call gets a 95 s read timeout to
  match the hub's 90 s on the transcriber.
- [x] Security rules (AGENTS.md section 2) hold: no protocol change; the
  clip goes to the hub only, over the session cookie and client header
  on the web and the bearer token on the phone; the hub's write-grant,
  WAV, size and rate checks are untouched and the UI tests prove the
  refusals reach the user as toasts without a clip reaching the stand-in;
  recording starts only from a click, a tap or a key on the page behind
  the browser's or the system's permission prompt, and the tracks are
  closed the moment it stops; the worklet is a file of the client's own
  under `script-src 'self'` and spec 93 checks the policy reported
  nothing; the transcript is cleaned (hub) and cleaned again as typed
  text (Android), shown before anything is sent, and goes through the
  input endpoint's checks when it is; no new dependency on either client.
- [x] Privacy check passed: `scripts/prepush-check.sh` clean and the diff
  read; the audio is Chromium's fake device, the sentence the stand-in's.
- [x] Docs updated: guideline §1.4 (input) and §1.6 (speak); the
  transcription page (a section for the browser and one for the phone,
  security considerations); web-client (using it, keyboard, security
  considerations); the protocol's note on who the clients are; the
  testing page (the second UI environment); Android pane-view (typing,
  security considerations).

## Test run

[Run 20261024-190449-45b4755](https://github.com/notmarkopadjen/muxway/issues/77): passed, 82 tests, at
`45b4755`, with spec 93's five tests across the two UI environments (no
button and one probe on a hub without a transcriber; no button on a
read-only pane or for a read-only token; the meter, the words on the
line focused and unsent, and a second clip within five seconds refused
with no clip reaching the stand-in; Esc dropping a clip and the words
joining typed text; the transcriber failing) and the screenshots
`93-recording` and `93-heard`; the header, resampler and meter unit
tests run with the web client's suite. Android:
[Run 20261024-191445-67df4f5](https://github.com/notmarkopadjen/muxway-android/issues/15): passed, 98 tests,
commit `67df4f5` (0.7.5 (17)) against core `b6f4cb2`'s sources, with the
clip's JVM tests (the header, the sixty-second cap, the meter) and the
API's (the probe reads 204 and 404, the clip goes as `audio/wav` with
the bearer token and the text comes back cleaned); no device attached,
so a recording on the phone waits for the next device run.
