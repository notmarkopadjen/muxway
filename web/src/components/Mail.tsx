import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAllPanes, useMail, useMailbox, useMailboxes, useTalk } from '../api/queries';
import type { MailWindow } from '../shell/mailwin';
import { mailRows, partnersOf } from '../term/mailrows';
import { routeFor } from '../term/tiles';
import { Box } from './Box';
import { ago } from './Inbox';
import { nameOf } from './Talk';

// The mail window: one pane's mail in full, what came in and what it
// sent, oldest at the top, and a line that mails the pane or whoever
// wrote to it. Nothing is typed into any pane. Reading here does not
// take a mail from the process: `unread` says it has not seen it yet.

export function Mail({ w, onClose }: { w: MailWindow; onClose: () => void }) {
  const all = useAllPanes(true);
  const talk = useTalk(true);
  const box = useMailbox(w.address);
  const send = useMail();
  const navigate = useNavigate();
  const pane = all.data?.find((q) => q.address === w.address);
  const self = useMemo(
    () => (pane ? { host: pane.host, pane_id: pane.pane_id, address: pane.address } : undefined),
    [pane],
  );
  // The panes of this conversation that the token reads: the ones that
  // mailed this pane and the ones it mailed. Their mailboxes give the
  // whole texts of what went to them.
  const sentTo = useMemo(() => {
    if (!self) return [];
    const out = new Set<string>();
    for (const m of box.data ?? []) if (m.from) out.add(m.from.address);
    for (const e of talk.data ?? [])
      if (e.kind === 'mail' && e.from?.host === self.host && e.from.pane_id === self.pane_id)
        out.add(e.to.address);
    out.delete(self.address);
    return [...out].filter((a) => all.data?.some((q) => q.address === a)).sort();
  }, [self, box.data, talk.data, all.data]);
  const boxes = useMailboxes(sentTo);
  const rows = useMemo(
    () => (self ? mailRows(self, box.data, talk.data, boxes) : []),
    [self, box.data, talk.data, boxes],
  );
  const partners = partnersOf(rows, w.address);
  const [to, setTo] = useState(w.address);
  const [text, setText] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(t);
  }, []);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (w.line) input.current?.focus();
  }, [w.line]);
  // The mail asked for, else the newest, comes into view once.
  const list = useRef<HTMLUListElement>(null);
  const brought = useRef(false);
  useEffect(() => {
    if (brought.current || rows.length === 0) return;
    brought.current = true;
    const el = w.mailId
      ? list.current?.querySelector(`[data-dir="in"][data-id="${w.mailId}"]`)
      : list.current?.lastElementChild;
    el?.scrollIntoView({ block: 'nearest' });
  }, [rows, w.mailId]);
  const writable = (a: string) => all.data?.find((q) => q.address === a)?.mode === 'write';
  const name = (a: string, id?: string) => nameOf(all.data, a, id);
  const submit = () => {
    const t = text.trim();
    if (!t || send.isPending || !writable(to)) return;
    send.mutate({ address: to, text: t }, { onSuccess: () => setText('') });
  };
  // L lays the pane beside the line's target, or its latest partner.
  const beside = () => {
    const other = to !== w.address ? to : partners[0];
    onClose();
    navigate({
      to: '/p/$',
      params: { _splat: routeFor(other ? [w.address, other] : [w.address]) },
    });
  };
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA'))
        return;
      if (ev.key !== 'L' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      ev.preventDefault();
      ev.stopPropagation();
      beside();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  const targets = [w.address, ...partners];
  return (
    <div className="mx-help" onClick={onClose} data-testid="mail-window">
      <div onClick={(e) => e.stopPropagation()}>
        <Box
          title={`mail · ${pane ? name(pane.address) : w.address}`}
          enter={false}
          className="mx-mail-box"
        >
          <ul className="mx-mail-list" ref={list} data-testid="mail-list">
            {rows.map((r) => (
              <li
                key={r.key}
                data-testid="mail-row"
                data-dir={r.dir}
                data-id={r.id}
                data-from={r.dir === 'in' ? r.who?.address : undefined}
                data-to={r.dir === 'out' ? r.who?.address : undefined}
                data-unread={r.unread ? '' : undefined}
                data-reply={r.replyTo ? '' : undefined}
                data-focused={w.mailId && r.dir === 'in' && r.id === w.mailId ? '' : undefined}
              >
                <div className="mx-mail-head">
                  <span className="mx-mark-talk mx-mail-way" aria-hidden="true">
                    {r.dir === 'in' ? '←' : '→'}
                  </span>
                  <span className="mx-talk-name">
                    {r.who ? name(r.who.address, r.who.pane_id) : 'you'}
                  </span>
                  <span className="mx-meta">
                    {' · '}
                    {ago(r.at, now)} · {r.yours ? `you (${r.actor})` : r.actor}
                    {r.replyTo ? ` · answers ${r.replyTo}` : ''}
                  </span>
                  <span className="mx-spacer" />
                  {r.cut && (
                    <span
                      className="mx-meta"
                      title="the first 200 characters: this token does not read that pane's mail"
                    >
                      cut
                    </span>
                  )}
                  {r.unread && (
                    <span className="mx-mail-state" data-testid="mail-unread">
                      unread
                    </span>
                  )}
                  {r.unread === false && <span className="mx-meta">read</span>}
                  {r.replied && <span className="mx-meta">· replied</span>}
                  {r.dir === 'in' && r.who && (
                    <button
                      type="button"
                      className="mx-mail-back"
                      data-testid="mail-back"
                      disabled={!writable(r.who.address)}
                      title={
                        writable(r.who.address)
                          ? 'the line mails this pane'
                          : 'you may not write to that pane'
                      }
                      onClick={() => {
                        setTo(r.who!.address);
                        input.current?.focus();
                      }}
                    >
                      mail back
                    </button>
                  )}
                </div>
                <div className="mx-mail-text">{r.text}</div>
              </li>
            ))}
            {rows.length === 0 && (
              <li className="mx-dim mx-empty">
                {box.isError ? 'this pane holds no mail you may read' : 'no mail yet'}
              </li>
            )}
          </ul>
          <form
            className="mx-talk-line"
            onSubmit={(ev) => {
              ev.preventDefault();
              submit();
            }}
          >
            <label className="mx-dim" htmlFor="mx-mail-to">
              ✉ mail to
            </label>
            <select
              id="mx-mail-to"
              data-testid="mail-to"
              value={targets.includes(to) ? to : w.address}
              onChange={(ev) => setTo(ev.target.value)}
            >
              {targets.map((a) => (
                <option key={a} value={a} disabled={!writable(a)}>
                  {name(a)}
                  {writable(a) ? '' : ' · read-only'}
                </option>
              ))}
            </select>
            <input
              ref={input}
              data-testid="mail-text"
              value={text}
              disabled={!writable(to) || send.isPending}
              placeholder="a message for its process; nothing is typed"
              onChange={(ev) => setText(ev.target.value)}
              maxLength={4000}
            />
            <button type="submit" disabled={!writable(to) || !text.trim() || send.isPending}>
              send
            </button>
            {send.isError && (
              <span className="mx-warn" data-testid="mail-refused">
                refused
              </span>
            )}
          </form>
          <div className="mx-toggles">
            <span className="mx-dim">
              <kbd>Enter</kbd> send · <kbd>L</kbd> both panes side by side · <kbd>Esc</kbd> close
            </span>
          </div>
        </Box>
      </div>
    </div>
  );
}
