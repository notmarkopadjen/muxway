import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { keys, splitWindow, useAllPanes, useHosts, useHubMe } from '../api/queries';
import type { Pane } from '../api/types';
import { shownName, useHubs } from '../hubs';
import { SessionForm, splitDirection } from '../pages/Panes';
import { addRows } from '../term/addmenu';
import { describe } from '../term/describe';
import { tabName, useLens } from '../term/lens';
import { LensMark } from './Lens';
import { ClaudeMark } from './PaneTitle';

// `+` after the tabs: one more pane beside the focused one on its host, a
// new session there, the panes minimised below, and every other readable
// pane as one more tile, in that order. The two first ask the hub; a pick
// asks nothing. What the token or the host does not allow is dimmed with
// its reason.
export function AddMenu({
  pane,
  open,
  minimised = [],
  onMade,
  onPick,
  onRefused,
}: {
  pane: Pane | undefined;
  open: string[];
  minimised?: string[];
  onMade: (address: string) => void;
  onPick: (address: string) => void;
  onRefused: (why: string) => void;
}) {
  const [isOpen, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  // The menu hangs from the button's left edge, or its right edge when
  // the button sits too far right for that.
  const [flip, setFlip] = useState(false);
  const busy = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const hosts = useHosts();
  const mes = useHubMe();
  const hubs = useHubs();
  const all = useAllPanes(true);
  const lens = useLens();
  const qc = useQueryClient();
  const rows = addRows({
    panes: all.data ?? [],
    hosts: hosts.data ?? [],
    me: mes.find((m) => (m.own ? undefined : m.hub.name) === pane?.hub)?.data,
    open,
    minimised,
    focused: pane,
  });
  useEffect(() => {
    if (!isOpen) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) {
        setOpen(false);
        setNaming(false);
      }
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [isOpen]);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (ev.key === '+' && pane) {
        ev.preventDefault();
        const r = box.current?.getBoundingClientRect();
        setFlip(!!r && r.left + 440 > window.innerWidth);
        setOpen(true);
      } else if (ev.key === 'Escape' && isOpen) {
        ev.stopImmediatePropagation();
        setOpen(false);
        setNaming(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  if (!pane) return null;
  const close = () => {
    setOpen(false);
    setNaming(false);
  };
  const split = async () => {
    if (busy.current) return;
    busy.current = true;
    close();
    try {
      const made = await splitWindow(
        pane.host,
        pane.session,
        pane.window_index,
        splitDirection(pane),
        pane.hub,
      );
      qc.invalidateQueries({ queryKey: keys.panesOf(pane.hub) });
      onMade(made.pane.address);
    } catch (err) {
      onRefused(err instanceof ApiError ? err.code.replace('_', ' ') : 'failed');
    } finally {
      busy.current = false;
    }
  };
  const entry = (p: Pane, testId: string) => {
    const st = lens.status(p);
    return (
      <button
        key={p.address}
        type="button"
        role="menuitem"
        className="mx-add-pane mx-painted"
        data-testid={testId}
        data-address={p.address}
        data-state={st === 'quiet' ? undefined : st}
        onClick={() => {
          close();
          onPick(p.address);
        }}
      >
        <span className="mx-add-name">
          {describe(p).agent === 'claude' && <ClaudeMark />}
          {st !== 'quiet' && <LensMark status={st} attention={p.attention} />}
          {tabName(p)}
        </span>
        <span className="mx-dim">{p.address}</span>
      </button>
    );
  };
  return (
    <div className="mx-add" ref={box}>
      <button
        type="button"
        className={`mx-add-button${isOpen ? ' on' : ''}`}
        onClick={(e) => {
          setFlip(e.currentTarget.getBoundingClientRect().left + 440 > window.innerWidth);
          setOpen((o) => !o);
        }}
        title="one more pane (+)"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        data-testid="add"
      >
        +
      </button>
      {isOpen && (
        <div
          className={`mx-menu mx-add-menu${flip ? ' mx-menu-right' : ''}`}
          role="menu"
          data-testid="add-menu"
        >
          {rows.full && (
            <div className="mx-add-heading" data-testid="add-full">
              four open: a pick replaces {tabName(pane)}
            </div>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => void split()}
            disabled={!rows.pane.on}
            title={rows.pane.on ? undefined : rows.pane.why}
            data-testid="add-split"
          >
            + pane{' '}
            <span className="mx-dim">
              {rows.pane.on ? `beside ${tabName(pane)} on ${pane.host}` : rows.pane.why}
            </span>
          </button>
          {naming && rows.session.on ? (
            <SessionForm
              host={pane.host}
              hub={pane.hub}
              onDone={(address) => {
                close();
                if (address) {
                  qc.invalidateQueries({ queryKey: keys.panesOf(pane.hub) });
                  onMade(address);
                }
              }}
            />
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => setNaming(true)}
              disabled={!rows.session.on}
              title={rows.session.on ? undefined : rows.session.why}
              data-testid="add-session"
            >
              + session{' '}
              <span className="mx-dim">
                {rows.session.on ? `on ${pane.host}` : rows.session.why}
              </span>
            </button>
          )}
          {rows.minimised.length > 0 && (
            <>
              <hr />
              <div className="mx-add-heading">minimised</div>
              {rows.minimised.map((p) => entry(p, 'add-minimised'))}
            </>
          )}
          {rows.groups.length > 0 && <hr />}
          {rows.groups.map((g, i) => (
            <div key={g.key} className="mx-add-group" data-testid="add-group">
              {g.hub !== undefined && g.hub !== rows.groups[i - 1]?.hub && (
                <div className="mx-add-hub" data-testid="add-hub">
                  ═ {g.hub || (hubs[0] && shownName(hubs[0]))} ═
                </div>
              )}
              <div className="mx-add-heading">
                {g.host} · {g.session}
              </div>
              {g.panes.map((p) => entry(p, 'add-pane'))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
