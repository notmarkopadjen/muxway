import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Key, Pane } from '../api/types';
import { commandsFor, isShell, remember, useRecent, type Command } from '../term/commands';
import { CommandBar } from './CommandBar';
import { KeyBar } from './KeyBar';

// The input line, the key bar and the command row for the focused pane,
// shared by the tiles, the window view and the board.
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
  const field = useRef<HTMLInputElement>(null);
  const recent = useRecent();
  const row = pane ? commandsFor(pane, recent) : null;

  const line = async (t: string) => {
    if (t) {
      if (pane && isShell(pane.command)) remember(t);
      await send({ text: t });
    }
    await send({ key: 'Enter' });
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text;
    setText('');
    await line(t);
  };
  const run = (c: Command) => {
    if (c.send) void line(c.text);
    else {
      setText(c.text);
      field.current?.focus();
    }
  };

  return (
    <>
      <form className="mx-input" onSubmit={submit}>
        <span className="mx-prompt">{writable ? '>' : '○'}</span>
        <input
          ref={field}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!writable}
          placeholder={placeholder}
          aria-label="input"
          autoComplete="off"
          data-testid="input"
        />
        <button type="submit" disabled={!writable}>
          send
        </button>
      </form>
      <div>
        <KeyBar onKey={(k) => void send({ key: k })} disabled={!writable} />
        {row && <CommandBar row={row} disabled={!writable} onRun={run} />}
        {children}
      </div>
    </>
  );
}
