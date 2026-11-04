import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useInbox, useLater } from '../api/queries';
import type { Pane } from '../api/types';
import { inboxOrder, waitingSince } from '../term/order';
import { Badge } from './Badge';
import { Box } from './Box';
import { Choices } from './Choices';
import { PaneTitle } from './PaneTitle';
import { useToast } from './Toast';

// The inbox: every pane that waits for you, on every hub of the hubs
// box, oldest first, and after them the panes parked for later. Enter or
// a click opens the pane, and wakes a parked one; a question's choices
// are answered here, and a pane is parked or woken here too.

export function waiting(panes: Pane[] | undefined): Pane[] {
  return (panes ?? []).filter((p) => p.attention || p.later).sort(inboxOrder);
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
  const later = useLater();
  const toast = useToast();
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
  const park = (p: Pane, on: boolean) =>
    later.mutate(
      { address: p.address, later: on },
      { onError: (err) => toast.push({ kind: 'later', title: p.address, text: String(err) }) },
    );
  const open = (p: Pane | undefined) => {
    if (!p) return;
    if (p.later && p.mode === 'write') park(p, false);
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
                <Badge attention={p.attention} later={p.later} />
                <span className="mx-addr">
                  <PaneTitle pane={p} />
                </span>
                <span className="mx-meta">
                  {p.address} · {p.later ? 'later' : p.attention?.kind}
                  {p.later && p.attention ? ` · ${p.attention.kind}` : ''}
                  {p.attention?.text ? `: ${p.attention.text}` : ''} · {ago(waitingSince(p), now)}
                </span>
                <button
                  type="button"
                  className="mx-inbox-later"
                  data-testid="inbox-later"
                  disabled={p.mode !== 'write' || later.isPending}
                  title={
                    p.mode !== 'write'
                      ? 'read-only: you cannot park it'
                      : p.later
                        ? 'wake: back among the waiting'
                        : 'later: park it after the others'
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    park(p, !p.later);
                  }}
                >
                  {p.later ? 'wake' : 'later'}
                </button>
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
              <kbd>Enter</kbd> open (and wake) · <kbd>o</kbd> the oldest awake, from anywhere ·{' '}
              <kbd>Esc</kbd> close
            </span>
          </div>
        </Box>
      </div>
    </div>
  );
}
