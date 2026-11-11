import { useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import { useChanges } from '../api/queries';
import { clearChanges, putChanges } from '../api/shares';
import type { Change, Changes, SharedChanges } from '../api/types';
import { buildTree, countOf, MARKS, nameOf, summary, type Dir } from '../term/changes';
import { RELAY_KEEPALIVE_MS } from './FileWindow';

// The changes window: git's view of the repository the pane works in,
// docked to the tile's right edge over the screen, so the tile keeps its
// size. A tree of the changed paths with a mark and a colour each, the
// branch and the counts in its bar; _ folds it to the bar, × closes it.
// A click on a file opens it in the file window, as its diff or as it is.
//
// With shares of the pane live, the window relays its listing and its
// folding to the hub, so the observers' pages open the same; on an
// observer's page the window is given what to show and fetches nothing.
export function ChangesWindow({
  address,
  folded,
  onFold,
  onClose,
  onOpen,
  direct,
  relay,
  observed,
}: {
  address: string;
  folded: boolean;
  onFold: () => void;
  onClose: () => void;
  onOpen: (change: Change, root: string) => void;
  // Direct typing is on: Escape is the pane's, and × or ⎇ closes.
  direct?: boolean;
  // The shares of the pane to tell what this window shows.
  relay?: { ids: string[]; hub?: string };
  // On an observer's page: the owner's listing and folding, given; the
  // bar has no fold and no close, and a file row opens nothing.
  observed?: { data: SharedChanges };
}) {
  const q = useChanges(address, !observed);
  // Escape closes the window before the page hears it, unless a file
  // window lies over it: that one closes first.
  useEffect(() => {
    if (direct || observed) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || document.querySelector('.mx-picture-back')) return;
      const target = ev.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, direct]);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const toggle = (path: string) =>
    setClosed((s) => {
      const n = new Set(s);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });
  // A 404 says the pane left the repository: the counts the header's
  // share of the query still holds are not shown as the window's.
  const data = observed
    ? observed.data
    : q.error instanceof ApiError && q.error.status === 404
      ? undefined
      : q.data;
  const shut = observed ? !!observed.data.folded : folded;
  const repo = data?.root.split('/').pop() ?? '';
  const counts = data ? summary(countOf(data.entries)) : '';
  const where = data
    ? `${repo} · ${data.branch}${data.ahead ? ` ↑${data.ahead}` : ''}${data.behind ? ` ↓${data.behind}` : ''}`
    : '';
  const err = observed
    ? null
    : q.error instanceof ApiError
      ? q.error.code
      : q.error
        ? 'hub unreachable'
        : null;
  const tree = data ? buildTree(data.entries) : null;
  // The relay: the listing goes to the hub for the observers when it
  // changes, with the folding; the window says again every few minutes
  // that it is open, and clears the whole when it goes. The root goes as
  // the repository's name alone: its place on the host is the owner's.
  const relayIds = relay?.ids.join(' ') ?? '';
  const relayHub = relay?.hub;
  const relayed = data && !observed ? JSON.stringify({ ...data, root: repo }) : '';
  useEffect(() => {
    if (!relayIds) return;
    const ids = relayIds.split(' ');
    if (!relayed) {
      if (err) ids.forEach((id) => void clearChanges(id, relayHub).catch(() => undefined));
      return;
    }
    const c = JSON.parse(relayed) as Changes;
    const send = () =>
      ids.forEach((id) => void putChanges(id, c, folded, relayHub).catch(() => undefined));
    send();
    const t = window.setInterval(send, RELAY_KEEPALIVE_MS);
    return () => window.clearInterval(t);
  }, [relayIds, relayHub, relayed, folded, err]);
  useEffect(() => {
    if (!relayIds) return;
    const ids = relayIds.split(' ');
    return () => ids.forEach((id) => void clearChanges(id, relayHub).catch(() => undefined));
  }, [relayIds, relayHub]);
  const rows = (dir: Dir, depth: number): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    for (const d of dir.dirs) {
      const shut = closed.has(d.path);
      out.push(
        <button
          type="button"
          key={`d:${d.path}`}
          className="mx-change-row mx-change-dir"
          data-testid="change-dir"
          data-path={d.path}
          data-open={shut ? undefined : ''}
          style={{ paddingLeft: `${6 + depth * 12}px` }}
          onClick={() => toggle(d.path)}
          title={shut ? `unfold ${d.path}` : `fold ${d.path}`}
        >
          <span className="mx-change-mark" aria-hidden>
            {shut ? '▸' : '▾'}
          </span>
          <span className="mx-change-name">{d.name}/</span>
          {shut && <span className="mx-dim">{d.count}</span>}
        </button>,
      );
      if (!shut) out.push(...rows(d, depth + 1));
    }
    for (const f of dir.files) {
      out.push(
        <button
          type="button"
          key={`f:${f.path}`}
          className="mx-change-row"
          data-testid="change"
          data-path={f.path}
          data-kind={f.kind}
          data-staged={f.staged ? '' : undefined}
          style={{ paddingLeft: `${6 + depth * 12}px` }}
          onClick={observed ? undefined : () => data && onOpen(f, data.root)}
          title={`${f.kind}${f.staged ? ', staged' : ''}${f.from ? `, from ${f.from}` : ''}: ${f.path}`}
        >
          <span className="mx-change-mark" aria-hidden>
            {MARKS[f.kind]}
            {f.staged ? <span className="mx-change-staged">●</span> : null}
          </span>
          <span className="mx-change-name">{nameOf(f)}</span>
        </button>,
      );
    }
    return out;
  };
  return (
    <div
      className="mx-changes"
      role="region"
      aria-label="changes"
      data-testid="changes-window"
      data-folded={shut ? '' : undefined}
      data-observed={observed ? '' : undefined}
      onClick={(ev) => ev.stopPropagation()}
    >
      <div className="mx-changes-bar" data-testid="changes-bar">
        <span>┌─ changes ─ </span>
        {where && (
          <span className="mx-changes-where" data-testid="changes-where" title={data?.root}>
            {where}
          </span>
        )}
        {where && <span> ─ </span>}
        <span className="mx-changes-counts" data-testid="changes-counts">
          {counts}
          {data?.truncated ? ' …' : ''}
        </span>
        <span className="mx-spacer">─</span>
        {observed ? (
          <span className="mx-dim" data-testid="changes-observed">
            as shown
          </span>
        ) : (
          <>
            <button
              type="button"
              onClick={onFold}
              title={folded ? 'unfold the window' : 'fold the window to its bar'}
              data-testid="changes-fold"
            >
              {folded ? '▭' : '_'}
            </button>
            <button
              type="button"
              onClick={onClose}
              title="close (g, Esc)"
              data-testid="changes-close"
            >
              ×
            </button>
          </>
        )}
      </div>
      <div className="mx-changes-body" data-testid="changes-body">
        {err ? (
          <span className="mx-dim" data-testid="changes-none">
            {err === 'not_found'
              ? 'not in a repository the host shows'
              : err === 'read_only'
                ? 'read-only'
                : err}
          </span>
        ) : !tree ? (
          <span className="mx-dim">loading…</span>
        ) : tree.count === 0 ? (
          <span className="mx-dim" data-testid="changes-clean">
            nothing changed
          </span>
        ) : (
          rows(tree, 0)
        )}
      </div>
    </div>
  );
}
