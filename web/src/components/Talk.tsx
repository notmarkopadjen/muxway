import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useAllPanes, useTalk } from '../api/queries';
import type { Pane, Talk as TalkEntry } from '../api/types';
import { tabName } from '../term/lens';
import { routeFor } from '../term/tiles';
import { Box } from './Box';
import { ago } from './Inbox';
import { ChainMark } from './TalkMark';

// The talk window: what panes said to panes, on every hub of the hubs
// box, newest at the bottom. Enter or a click lays the two panes side by
// side.

// Entries of the last ten minutes, the window the listing marks panes for.
export const TALK_WINDOW_MS = 10 * 60_000;

export function recent(talk: TalkEntry[] | undefined, now = Date.now()): TalkEntry[] {
  return (talk ?? []).filter((e) => now - e.at * 1000 < TALK_WINDOW_MS);
}

// A pane's name as its tab shows it, by its current address or, after the
// address moved, by its id; the address alone when the listing lacks it.
export function nameOf(panes: Pane[] | undefined, address: string, paneId?: string): string {
  const p =
    panes?.find((q) => q.address === address) ??
    (paneId
      ? panes?.find((q) => q.pane_id === paneId && q.host === address.split('/')[0])
      : undefined);
  return p ? tabName(p) : address.split('/').slice(1).join('/');
}

export function Talk({ onClose }: { onClose: () => void }) {
  const talk = useTalk(true);
  const all = useAllPanes(true);
  const navigate = useNavigate();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(t);
  }, []);
  const rows = useMemo(() => recent(talk.data, now), [talk.data, now]);
  const [sel, setSel] = useState(-1);
  const at = sel < 0 ? rows.length - 1 : Math.min(sel, rows.length - 1);
  const open = (e: TalkEntry | undefined) => {
    if (!e) return;
    onClose();
    const panes = e.from.address === e.to.address ? [e.to.address] : [e.from.address, e.to.address];
    navigate({ to: '/p/$', params: { _splat: routeFor(panes) } });
  };
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'ArrowDown' || ev.key === 'j') setSel(Math.min(at + 1, rows.length - 1));
      else if (ev.key === 'ArrowUp' || ev.key === 'k') setSel(Math.max(at - 1, 0));
      else if (ev.key === 'Enter') open(rows[at]);
      else return;
      ev.preventDefault();
      ev.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  useEffect(() => {
    document.querySelector('.mx-talk-list .mx-selected')?.scrollIntoView({ block: 'nearest' });
  }, [at]);
  return (
    <div className="mx-help" onClick={onClose} data-testid="talk">
      <div onClick={(e) => e.stopPropagation()}>
        <Box title={`talk · ${rows.length} in ten minutes`} enter={false}>
          <ul className="mx-palette-list mx-talk-list">
            {rows.map((e, i) => (
              <li
                key={`${e.hub ?? ''}${e.seq}`}
                className={i === at ? 'mx-selected' : ''}
                onClick={() => open(e)}
                data-testid="talk-row"
                data-from={e.from.address}
                data-to={e.to.address}
              >
                <ChainMark />
                <span className="mx-talk-who">
                  <span className="mx-talk-name">
                    {nameOf(all.data, e.from.address, e.from.pane_id)}
                  </span>
                  <span className="mx-dim"> → </span>
                  <span className="mx-talk-name">
                    {nameOf(all.data, e.to.address, e.to.pane_id)}
                  </span>
                </span>
                <span className="mx-talk-text" title={e.text}>
                  {e.kind === 'text' ? e.text : `${e.kind}: ${e.text}`}
                </span>
                <span className="mx-meta">
                  {ago(e.at, now)} · {e.actor.name}
                </span>
              </li>
            ))}
            {rows.length === 0 && <li className="mx-dim">no pane talked to another lately</li>}
          </ul>
          <div className="mx-toggles">
            <span className="mx-dim">
              <kbd>Enter</kbd> both panes side by side · <kbd>Esc</kbd> close
            </span>
          </div>
        </Box>
      </div>
    </div>
  );
}
