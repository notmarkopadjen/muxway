import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { ApiError } from '../api/client';
import { fileType, sendFile, transcribe, useFiles, useHosts, useTranscriber } from '../api/queries';
import type { Key, Pane } from '../api/types';
import { commandsFor, isShell, remember, useRecent, type Command } from '../term/commands';
import { complete, completions } from '../term/complete';
import { meter, Recorder, RecorderError } from '../term/recorder';
import { CommandBar } from './CommandBar';
import { Completions } from './Completions';
import { KeyBar } from './KeyBar';
import { Keyboard } from './Keyboard';
import { useToast } from './Toast';

// The input line, the key bar and the command row for the focused pane,
// shared by the tiles, the window view and the board. The line is a small
// editor: Enter sends, Shift+Enter starts a new line, and it grows upward
// to six rows. While the first word is typed a list of completions opens
// above it. From an empty line the console keys go to the pane. With a
// transcriber on the hub a microphone button records a clip and puts the
// words on the line, to be read before they are sent.

const ROWS = 6;
// A press on the microphone longer than this is a hold.
const HOLD_MS = 400;

type Mic = 'idle' | 'recording' | 'hearing';

// What the hub's refusal of a clip says in a toast.
function micRefusal(err: unknown): string {
  if (!(err instanceof ApiError)) return 'hub unreachable';
  switch (err.status) {
    case 429:
      return 'one clip every five seconds';
    case 502:
    case 404:
      return 'transcriber unavailable';
    case 413:
      return 'too long';
    case 400:
      return 'too short';
    case 403:
      return 'no write grant';
    default:
      return err.code;
  }
}

// What an empty field sends when these keys are pressed, so a menu in
// the pane is driven without leaving the line.
const CONSOLE_KEYS: Record<string, Key> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Home: 'Home',
  End: 'End',
  Tab: 'Tab',
};

function size(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1 << 20) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1 << 20)).toFixed(1)} MiB`;
}

export function InputPanel({
  pane,
  writable,
  placeholder,
  send,
  children,
}: {
  pane: Pane | undefined;
  writable: boolean;
  placeholder: string;
  send: (body: { text: string } | { key: string }) => Promise<boolean | void>;
  children?: ReactNode;
}) {
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  const [closed, setClosed] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const wantCaret = useRef<number | null>(null);
  const wantFocus = useRef(false);
  const textNow = useRef(text);
  textNow.current = text;
  const recent = useRecent();
  const toast = useToast();
  const transcriber = useTranscriber().data === true;
  // The keyboard window, for the focused pane; the host says whether its
  // agent takes the whole key grammar.
  const [board, setBoard] = useState(false);
  const hosts = useHosts();
  const grammar = hosts.data?.find((h) => h.name === pane?.host)?.keys === 2;
  const boardOpen = board && writable && !!pane;
  const [mic, setMic] = useState<Mic>('idle');
  const [level, setLevel] = useState<{ levels: number[]; seconds: number }>({
    levels: [],
    seconds: 0,
  });
  const rec = useRef<Recorder | null>(null);
  const canMic = transcriber && writable && !!pane;
  const canFile = useFiles(pane?.address, writable).data === true && writable && !!pane;
  const [sending, setSending] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const row = pane ? commandsFor(pane, recent) : null;
  const list = pane && writable && !closed ? completions(pane, text, caret, recent) : [];
  const picked = Math.min(pick, Math.max(list.length - 1, 0));

  // The field grows with its text up to ROWS rows, then scrolls inside.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const pad =
      parseFloat(cs.paddingTop) +
      parseFloat(cs.paddingBottom) +
      parseFloat(cs.borderTopWidth) +
      parseFloat(cs.borderBottomWidth);
    const max = ROWS * parseFloat(cs.lineHeight) + pad;
    el.style.height = 'auto';
    const want = el.scrollHeight + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    el.style.height = `${Math.min(want, max)}px`;
    if (wantCaret.current !== null) {
      el.setSelectionRange(wantCaret.current, wantCaret.current);
      wantCaret.current = null;
    }
  }, [text]);

  const change = (next: string, at: number) => {
    setText(next);
    setCaret(at);
    setPick(0);
    setClosed(false);
  };

  // Files for the pane's program: each goes to the host's inbox, and its
  // path lands on the line with a space after it, for the person to finish
  // the sentence. One after another; nothing is sent to the pane.
  const sendFiles = async (files: File[]) => {
    if (!pane || !canFile || sending) return;
    for (const f of files) {
      const type = fileType(f);
      if (!type) {
        toast.push({ kind: 'file', title: `${f.name}: not a type the host takes` });
        continue;
      }
      setSending(`⇪ ${f.name} · ${size(f.size)}…`);
      try {
        const { path } = await sendFile(pane.address, f, type);
        const t = textNow.current;
        const next = `${t && !t.endsWith(' ') ? `${t} ` : t}${path} `;
        textNow.current = next;
        wantCaret.current = next.length;
        change(next, next.length);
      } catch (err) {
        toast.push({
          kind: 'file',
          title: `${f.name}: ${err instanceof ApiError ? err.code.replace('_', ' ') : 'failed'}`,
        });
      }
    }
    setSending(null);
    wantFocus.current = true;
  };
  // A paste with a file in it, or a file dropped anywhere on the view.
  useEffect(() => {
    if (!canFile) return;
    const hasFiles = (dt: DataTransfer | null) => !!dt && [...dt.types].includes('Files');
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      void sendFiles(files);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e.dataTransfer)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      void sendFiles([...(e.dataTransfer?.files ?? [])]);
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  });

  // The microphone. The clip stays in memory until the hub has answered;
  // the words land on the line, after a space when something is there,
  // and the line takes focus so they are read before Enter.
  const say = (what: string) => toast.push({ kind: 'mic', title: what });
  const hear = async () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    const clip = r.stop();
    if (!clip) {
      setMic('idle');
      wantFocus.current = true;
      say('too short');
      return;
    }
    setMic('hearing');
    try {
      const heard = await transcribe(clip.wav);
      if (heard) {
        const t = textNow.current;
        const next = t ? `${t} ${heard}` : heard;
        wantCaret.current = next.length;
        change(next, next.length);
      }
    } catch (err) {
      say(micRefusal(err));
    }
    setMic('idle');
    wantFocus.current = true;
  };
  const record = async () => {
    if (!canMic || mic !== 'idle' || rec.current) return;
    const r = new Recorder();
    r.onFrame = (levels, seconds) => setLevel({ levels: [...levels], seconds });
    r.onFull = () => void hear();
    rec.current = r;
    setLevel({ levels: [], seconds: 0 });
    setMic('recording');
    try {
      await r.start();
    } catch (err) {
      // Unless Esc dropped it while the browser was still asking.
      if (rec.current !== r) return;
      rec.current = null;
      setMic('idle');
      say(
        err instanceof RecorderError && err.why === 'refused'
          ? 'microphone refused'
          : 'no microphone',
      );
    }
  };
  // The button records while held and stops on release; a press shorter
  // than a moment is a click, and the next click stops. The click that
  // ends a hold is not a toggle.
  const pressed = useRef(0);
  const swallow = useRef(false);
  const micDown = () => {
    if (mic !== 'idle' || !canMic) return;
    pressed.current = Date.now();
    void record();
  };
  const micUp = () => {
    if (!pressed.current || Date.now() - pressed.current < HOLD_MS) return;
    pressed.current = 0;
    swallow.current = true;
    void hear();
  };
  const micClick = () => {
    if (swallow.current) {
      swallow.current = false;
      return;
    }
    if (pressed.current) {
      pressed.current = 0;
      return;
    }
    void (mic === 'recording' ? hear() : record());
  };
  // The toasts line up with the key row: its top is published for them.
  const below = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = below.current;
    if (!el) return;
    const root = document.documentElement.style;
    const place = () => {
      root.setProperty('--mx-rows-top', `${Math.round(el.getBoundingClientRect().top)}px`);
      root.setProperty('--mx-rows-bottom', 'auto');
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    if (el.previousElementSibling) ro.observe(el.previousElementSibling);
    window.addEventListener('resize', place);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
      root.removeProperty('--mx-rows-top');
      root.removeProperty('--mx-rows-bottom');
    };
  }, []);
  const cancelMic = () => {
    rec.current?.cancel();
    rec.current = null;
    setMic('idle');
    wantFocus.current = true;
  };
  // Leaving the view, or the focused pane changing under it, drops the clip.
  useEffect(() => cancelMic, [pane?.address]);
  useEffect(() => {
    if (mic === 'idle' && wantFocus.current) {
      wantFocus.current = false;
      field.current?.focus();
    }
  }, [mic, text]);
  // v works like the button: held, it records until released; tapped, it
  // starts a clip and the next tap stops it. Esc drops one. Seen before the
  // page's own keys, so Esc does not leave the view mid-clip.
  const vDown = useRef(0);
  useEffect(() => {
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const target = ev.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (ev.key === 'v' && ev.repeat && vDown.current) {
        // the key's own repeat while held
      } else if (mic === 'recording') {
        if (ev.key === 'Escape') {
          vDown.current = 0;
          cancelMic();
        } else if (ev.key === 'v' && !typing) void hear();
        else return;
      } else if (mic === 'idle' && ev.key === 'v' && !ev.repeat && !typing && canMic) {
        vDown.current = Date.now();
        void record();
      } else if (ev.key === 'K' && !typing && writable) setBoard((b) => !b);
      else if (ev.key === 'Escape' && boardOpen && !typing) setBoard(false);
      else return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
    };
    const onUp = (ev: globalThis.KeyboardEvent) => {
      if (ev.key !== 'v' || !vDown.current) return;
      const held = Date.now() - vDown.current >= HOLD_MS;
      vDown.current = 0;
      if (held && mic === 'recording') void hear();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onUp, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onUp, true);
    };
  });
  const line = async (t: string) => {
    if (t) {
      if (pane && isShell(pane.command) && !t.includes('\n')) remember(t);
      await send({ text: t });
    }
    await send({ key: 'Enter' });
  };
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const t = text;
    change('', 0);
    await line(t);
  };
  const take = (c: string) => {
    const r = complete(text, caret, c);
    wantCaret.current = r.caret;
    change(r.text, r.caret);
    field.current?.focus();
  };
  const run = (c: Command) => {
    if (c.send) void line(c.text);
    else {
      wantCaret.current = c.text.length;
      change(c.text, c.text.length);
      field.current?.focus();
    }
  };
  const select = (e: SyntheticEvent<HTMLTextAreaElement>) => {
    const at = e.currentTarget.selectionStart;
    if (at !== caret) setCaret(at);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const k = e.key;
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
    if (k === 'Enter' && plain && !e.shiftKey) {
      e.preventDefault();
      if (list.length) {
        const r = complete(text, caret, list[picked]);
        change('', 0);
        void line(r.text.trimEnd());
      } else void submit();
    } else if (k === 'Escape' && e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      void send({ key: 'Escape' });
    } else if (k === 'Escape' && list.length) {
      e.preventDefault();
      e.stopPropagation();
      setClosed(true);
    } else if (list.length && plain && (k === 'ArrowDown' || k === 'ArrowUp')) {
      e.preventDefault();
      const step = k === 'ArrowDown' ? 1 : list.length - 1;
      setPick((picked + step) % list.length);
    } else if (list.length && plain && !e.shiftKey && k === 'Tab') {
      e.preventDefault();
      take(list[picked]);
    } else if (text === '' && plain && !e.shiftKey && CONSOLE_KEYS[k]) {
      e.preventDefault();
      void send({ key: CONSOLE_KEYS[k] });
    }
  };

  return (
    <>
      <form className="mx-input" onSubmit={submit}>
        <span className={`mx-prompt${mic === 'recording' ? ' mx-rec' : ''}`}>
          {mic === 'recording' ? '●' : writable ? '>' : '○'}
        </span>
        {sending ? (
          <div className="mx-mic-line mx-hearing" data-testid="file-line">
            {sending}
          </div>
        ) : mic === 'idle' ? (
          <textarea
            ref={field}
            rows={1}
            value={text}
            onChange={(e) => change(e.target.value, e.target.selectionStart)}
            onSelect={select}
            onKeyDown={onKey}
            disabled={!writable}
            placeholder={placeholder}
            aria-label="input"
            autoComplete="off"
            spellCheck={false}
            data-testid="input"
          />
        ) : (
          <div
            className={`mx-mic-line${mic === 'hearing' ? ' mx-hearing' : ''}`}
            data-testid="mic-line"
            data-state={mic}
            onClick={mic === 'recording' ? () => void hear() : undefined}
          >
            {mic === 'recording'
              ? `${meter(level.levels)} ${Math.floor(level.seconds)} s · click to stop`
              : '⟳ hearing…'}
          </div>
        )}
        <button
          type="button"
          className={`mx-mic mx-kbd${boardOpen ? ' on' : ''}`}
          disabled={!writable}
          onClick={() => setBoard((b) => !b)}
          title={
            writable
              ? 'keyboard (K): every key, sent as you click it'
              : 'keyboard: this pane is read-only'
          }
          aria-label="keyboard"
          aria-pressed={boardOpen}
          data-testid="keyboard-open"
        >
          {'⌨\uFE0E'}
        </button>
        {canFile && (
          <>
            <button
              type="button"
              className="mx-mic mx-file"
              disabled={!!sending}
              onClick={() => picker.current?.click()}
              title="send a file to the host: its path lands on the line (or paste, or drop one)"
              aria-label="send a file"
              data-testid="file"
            >
              ⇪
            </button>
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.md,.json,image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/markdown,application/json"
              data-testid="file-picker"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = '';
                void sendFiles(files);
              }}
            />
          </>
        )}
        {canMic && (
          <button
            type="button"
            className={`mx-mic${mic === 'recording' ? ' on' : ''}`}
            disabled={mic === 'hearing'}
            onPointerDown={micDown}
            onPointerUp={micUp}
            onPointerLeave={micUp}
            onPointerCancel={micUp}
            onClick={micClick}
            title={
              mic === 'recording'
                ? 'stop and hear (v); Esc drops the clip'
                : 'speak (v): hold and release, or click and click again'
            }
            aria-label={mic === 'recording' ? 'stop' : 'speak'}
            data-testid="mic"
            data-state={mic}
          >
            {mic === 'recording' ? '■' : '◉'}
          </button>
        )}
        {mic === 'recording' ? (
          <button type="button" className="mx-send" onClick={cancelMic} data-testid="mic-cancel">
            cancel
          </button>
        ) : (
          <button
            type="submit"
            className="mx-mic mx-send-icon"
            disabled={!writable || mic === 'hearing' || !!sending}
            title="send (Enter)"
            aria-label="send"
            data-testid="send"
          >
            ⏎
          </button>
        )}
        {list.length > 0 && <Completions items={list} picked={picked} onTake={take} />}
      </form>
      {boardOpen && (
        <Keyboard
          target={pane.address}
          grammar={grammar}
          send={async (body) => (await send(body)) !== false}
          onRefused={(why) => toast.push({ kind: 'refused', title: why })}
          onClose={() => setBoard(false)}
        />
      )}
      <div className="mx-below" ref={below}>
        <KeyBar onKey={(k) => void send({ key: k })} disabled={!writable} />
        {row && <CommandBar row={row} disabled={!writable} onRun={run} />}
        {children}
      </div>
    </>
  );
}
