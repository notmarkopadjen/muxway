import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAllPanes, useMail, useTalk } from '../api/queries';
import type { Pane, Talk as TalkEntry } from '../api/types';
import { tabName } from '../term/lens';
import { routeFor } from '../term/tiles';
import { Box } from './Box';
import { ago } from './Inbox';
import { ChainMark } from './TalkMark';

// The messages window: what panes said to panes, mail and typed writes,
// on every hub of the hubs box, oldest at the top. Enter or a click lays
// the two panes side by side; the line at the bottom mails the focused
// pane, and nothing is typed for it.

// Entries of the last ten minutes, the window the listing groups panes for.
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

// The seen mark: the newest entry the owner looked at, per hub, in this
// browser. The header counts what came after it.
const SEEN_KEY = 'mx-talk-seen';

export function loadSeen(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

export function markSeen(talk: TalkEntry[] | undefined): Record<string, number> {
  const seen = loadSeen();
  for (const e of talk ?? []) seen[e.hub ?? ''] = Math.max(seen[e.hub ?? ''] ?? 0, e.seq);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // a private window: the count starts over next time
  }
  return seen;
}

export function unseen(talk: TalkEntry[] | undefined, seen: Record<string, number>): number {
  return (talk ?? []).filter((e) => e.seq > (seen[e.hub ?? ''] ?? 0)).length;
}

export function Talk({
  onClose,
  to,
  line = false,
}: {
  onClose: () => void;
  // The focused pane, which the line at the bottom mails; none on the list.
  to?: string;
  // Open with the line focused (M).
  line?: boolean;
}) {
  const talk = useTalk(true);
  const all = useAllPanes(true);
  const navigate = useNavigate();
  const mail = useMail();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(t);
  }, []);
  const rows = useMemo(() => talk.data ?? [], [talk.data]);
  const [sel, setSel] = useState(-1);
  const at = sel < 0 ? rows.length - 1 : Math.min(sel, rows.length - 1);
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const open = (e: TalkEntry | undefined) => {
    if (!e) return;
    onClose();
    const panes =
      !e.from || e.from.address === e.to.address ? [e.to.address] : [e.from.address, e.to.address];
    navigate({ to: '/p/$', params: { _splat: routeFor(panes) } });
  };
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.target === input.current) return;
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
  useEffect(() => {
    if (line) input.current?.focus();
  }, [line]);
  const send = () => {
    const t = text.trim();
    if (!to || !t || mail.isPending) return;
    mail.mutate({ address: to, text: t }, { onSuccess: () => setText('') });
  };
  const who = (e: TalkEntry) => (e.from ? nameOf(all.data, e.from.address, e.from.pane_id) : 'you');
  return (
    <div className="mx-help" onClick={onClose} data-testid="talk">
      <div onClick={(e) => e.stopPropagation()}>
        <Box title={`messages · ${rows.length}`} enter={false}>
          <ul className="mx-palette-list mx-talk-list">
            {rows.map((e, i) => (
              <li
                key={`${e.hub ?? ''}${e.seq}`}
                className={i === at ? 'mx-selected' : ''}
                onClick={() => open(e)}
                data-testid="talk-row"
                data-from={e.from?.address}
                data-to={e.to.address}
                data-kind={e.kind}
                data-reply={e.reply_to ? '' : undefined}
                data-live={now - e.at * 1000 < TALK_WINDOW_MS ? '' : undefined}
              >
                {e.kind === 'mail' ? (
                  <span className="mx-mark-talk mx-mail-glyph" aria-label="mail">
                    ✉
                  </span>
                ) : (
                  <ChainMark />
                )}
                <span className="mx-talk-who">
                  <span className="mx-talk-name">{who(e)}</span>
                  <span className="mx-dim"> → </span>
                  <span className="mx-talk-name">
                    {nameOf(all.data, e.to.address, e.to.pane_id)}
                  </span>
                </span>
                <span className="mx-talk-text" title={e.text}>
                  {e.kind === 'text' || e.kind === 'mail' ? e.text : `${e.kind}: ${e.text}`}
                </span>
                <span className="mx-meta">
                  {ago(e.at, now)} · {e.actor.name}
                </span>
              </li>
            ))}
            {rows.length === 0 && (
              <li className="mx-dim mx-empty">no pane talked to another lately</li>
            )}
          </ul>
          <form
            className="mx-talk-line"
            onSubmit={(ev) => {
              ev.preventDefault();
              send();
            }}
          >
            <label className="mx-dim" htmlFor="mx-mail-line">
              ✉ mail to {to ? nameOf(all.data, to) : 'the open pane'}
            </label>
            <input
              id="mx-mail-line"
              ref={input}
              data-testid="mail-line"
              value={text}
              disabled={!to || mail.isPending}
              placeholder={to ? 'a message for its process; nothing is typed' : 'open a pane first'}
              onChange={(ev) => setText(ev.target.value)}
              maxLength={4000}
            />
            <button type="submit" disabled={!to || !text.trim() || mail.isPending}>
              send
            </button>
            {mail.isError && (
              <span className="mx-warn" data-testid="mail-error">
                refused
              </span>
            )}
          </form>
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
