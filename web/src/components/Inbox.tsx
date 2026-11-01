import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useInbox } from '../api/queries';
import type { Pane } from '../api/types';
import { Badge } from './Badge';
import { Box } from './Box';
import { Choices } from './Choices';
import { PaneTitle } from './PaneTitle';

// The inbox: every pane that waits for you, on every hub of the hubs
// box, oldest first. Enter or a click opens the pane; a question's
// choices are answered here.

export function waiting(panes: Pane[] | undefined): Pane[] {
  return (panes ?? [])
    .filter((p) => p.attention)
    .sort((a, b) => (a.attention?.at ?? 0) - (b.attention?.at ?? 0));
}

// How long ago, in a word or two.
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round(now / 1000 - at));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function Inbox({ onClose }: { onClose: () => void }) {
  const panes = useInbox(true);
  const navigate = useNavigate();
  const rows = useMemo(() => waiting(panes.data), [panes.data]);
  const [sel, setSel] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (sel >= rows.length) setSel(Math.max(0, rows.length - 1));
  }, [rows.length, sel]);
  const open = (p: Pane | undefined) => {
    if (!p) return;
    onClose();
    navigate({ to: '/p/$', params: { _splat: p.address } });
  };
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'ArrowDown' || ev.key === 'j') setSel((s) => Math.min(s + 1, rows.length - 1));
      else if (ev.key === 'ArrowUp' || ev.key === 'k') setSel((s) => Math.max(s - 1, 0));
      else if (ev.key === 'Enter') open(rows[sel]);
      else return;
      ev.preventDefault();
      ev.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  return (
    <div className="mx-help" onClick={onClose} data-testid="inbox">
      <div onClick={(e) => e.stopPropagation()}>
        <Box title={`inbox · ${rows.length} waiting`} enter={false}>
          <ul className="mx-palette-list mx-inbox-list">
            {rows.map((p, i) => (
              <li
                key={p.address}
                className={i === sel ? 'mx-selected' : ''}
                onClick={() => open(p)}
                data-testid="inbox-row"
                data-address={p.address}
              >
                <Badge attention={p.attention} />
                <span className="mx-addr">
                  <PaneTitle pane={p} />
                </span>
                <span className="mx-meta">
                  {p.address} · {p.attention?.kind}
                  {p.attention?.text ? `: ${p.attention.text}` : ''} ·{' '}
                  {ago(p.attention?.at ?? 0, now)}
                </span>
                <Choices
                  address={p.address}
                  attention={p.attention}
                  writable={p.mode === 'write'}
                />
              </li>
            ))}
            {rows.length === 0 && <li className="mx-dim mx-empty">nothing waits for you</li>}
          </ul>
          <div className="mx-toggles">
            <span className="mx-dim">
              <kbd>Enter</kbd> open · <kbd>o</kbd> the oldest, from anywhere · <kbd>Esc</kbd> close
            </span>
          </div>
        </Box>
      </div>
    </div>
  );
}
