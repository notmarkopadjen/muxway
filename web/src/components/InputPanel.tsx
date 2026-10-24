import {
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import type { Key, Pane } from '../api/types';
import { commandsFor, isShell, remember, useRecent, type Command } from '../term/commands';
import { complete, completions } from '../term/complete';
import { CommandBar } from './CommandBar';
import { Completions } from './Completions';
import { KeyBar } from './KeyBar';

// The input line, the key bar and the command row for the focused pane,
// shared by the tiles, the window view and the board. The line is a small
// editor: Enter sends, Shift+Enter starts a new line, and it grows upward
// to six rows. While the first word is typed a list of completions opens
// above it. From an empty line the console keys go to the pane.

const ROWS = 6;

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
  send: (body: { text: string } | { key: Key }) => Promise<void>;
  children?: ReactNode;
}) {
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  const [closed, setClosed] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const wantCaret = useRef<number | null>(null);
  const recent = useRecent();
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
      void submit();
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
        <span className="mx-prompt">{writable ? '>' : '○'}</span>
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
        <button type="submit" disabled={!writable}>
          send
        </button>
        {list.length > 0 && <Completions items={list} picked={picked} onTake={take} />}
      </form>
      <div>
        <KeyBar onKey={(k) => void send({ key: k })} disabled={!writable} />
        {row && <CommandBar row={row} disabled={!writable} onRun={run} />}
        {children}
      </div>
    </>
  );
}
