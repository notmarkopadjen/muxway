import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { useRename } from '../api/queries';
import type { Pane } from '../api/types';
import { aliasOf, describe, label, type Agent, type Named } from '../term/describe';

// The marks of the AI CLIs, drawn with strokes so they are the same in
// every font: a spark for Claude Code, a hexagon for Codex, a lifted
// chevron for Antigravity. Decorative: the name beside them says who.
export function ClaudeMark() {
  // A spark: twelve rays from the centre.
  const rays = Array.from({ length: 12 }, (_, i) => (i * 30 * Math.PI) / 180);
  return (
    <svg className="mx-mark mx-mark-claude" viewBox="-10 -10 20 20" aria-hidden="true">
      {rays.map((a, i) => (
        <line
          key={i}
          x1={Math.cos(a) * 3}
          y1={Math.sin(a) * 3}
          x2={Math.cos(a) * (i % 2 ? 7 : 9)}
          y2={Math.sin(a) * (i % 2 ? 7 : 9)}
        />
      ))}
    </svg>
  );
}

export function CodexMark() {
  // A hexagon, a point up, with a dot at its heart.
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = ((i * 60 - 90) * Math.PI) / 180;
    return `${(Math.cos(a) * 8).toFixed(2)},${(Math.sin(a) * 8).toFixed(2)}`;
  }).join(' ');
  return (
    <svg className="mx-mark mx-mark-codex" viewBox="-10 -10 20 20" aria-hidden="true">
      <polygon points={pts} fill="none" />
      <circle r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function AntigravityMark() {
  // A chevron lifted off its ground line.
  return (
    <svg className="mx-mark mx-mark-antigravity" viewBox="-10 -10 20 20" aria-hidden="true">
      <polyline points="-7,2 0,-7 7,2" fill="none" />
      <line x1="-5" y1="7.5" x2="5" y2="7.5" />
    </svg>
  );
}

// The mark of an agent, or nothing for a program without one.
export function AgentMark({ agent }: { agent?: Agent }) {
  switch (agent) {
    case 'claude':
      return <ClaudeMark />;
    case 'codex':
      return <CodexMark />;
    case 'antigravity':
      return <AntigravityMark />;
    default:
      return null;
  }
}

// The pane's own name: the owner's, else what runs in it; then the folder
// it works in and what the program says it is doing, both set back.
export function PaneTitle({
  pane,
  folder,
  title,
  onClick,
}: {
  pane: Named;
  folder?: string;
  title?: string;
  onClick?: () => void;
}) {
  const d = describe(pane);
  return (
    <span
      className="mx-title"
      data-testid="pane-title"
      data-agent={d.agent}
      title={title}
      onClick={onClick}
    >
      <AgentMark agent={d.agent} />
      <span className="mx-title-name">{d.name}</span>
      {folder && (
        <span className="mx-title-folder" data-testid="pane-folder" title={folder}>
          {' · '}
          {folder.split('/').filter(Boolean).pop() ?? folder}
        </span>
      )}
      {d.status && <span className="mx-title-status"> · {d.status}</span>}
    </span>
  );
}

// What the header keeps under the pointer: what the program says of
// itself, the place, the size, the mode, the folder's whole path.
export function paneTooltip(p: Pane): string {
  const lines = [
    label({ command: p.command, title: p.title }),
    `${p.address} · ${p.width}×${p.height} · ${p.mode}`,
  ];
  if (p.cwd) lines.push(p.cwd);
  return lines.join('\n');
}

// A second click on a name already focused, slower than a double-click
// and not a forgotten one, asks for a rename.
export const SLOW_MIN_MS = 500;
export const SLOW_MAX_MS = 3_000;
export function slowSecond(prevAt: number | undefined, now: number): boolean {
  return prevAt !== undefined && now - prevAt >= SLOW_MIN_MS && now - prevAt <= SLOW_MAX_MS;
}

function refusedWhy(e: unknown): string {
  const code = e instanceof ApiError ? e.code : '';
  switch (code) {
    case 'alias_taken':
      return 'another pane has it';
    case 'bad_alias':
      return 'a-z, 0-9 and -, up to 32';
    case 'read_only':
      return 'read-only';
    case 'not_found':
      return 'the host does not name panes';
    default:
      return 'refused';
  }
}

// The name as a field, in the header's place: Enter saves, Esc leaves,
// empty takes the name away. What is typed becomes an alias as it goes.
export function RenameField({ pane, onDone }: { pane: Pane; onDone: () => void }) {
  const rename = useRename();
  const [value, setValue] = useState(pane.alias ?? '');
  const [why, setWhy] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const save = () => {
    if (rename.isPending) return;
    if (value === (pane.alias ?? '')) {
      onDone();
      return;
    }
    rename.mutate(
      { address: pane.address, alias: value },
      { onSuccess: onDone, onError: (e) => setWhy(refusedWhy(e)) },
    );
  };
  return (
    <form
      className="mx-rename"
      data-testid="rename"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={input}
        data-testid="rename-field"
        value={value}
        placeholder="a name: a-z 0-9 -"
        maxLength={32}
        spellCheck={false}
        onChange={(e) => {
          setValue(aliasOf(e.target.value));
          setWhy('');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onDone();
          }
        }}
        onBlur={onDone}
      />
      {why && (
        <span className="mx-warn" data-testid="rename-error">
          {why}
        </span>
      )}
    </form>
  );
}
