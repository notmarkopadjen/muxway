import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { keys, splitWindow, useHosts, useMe } from '../api/queries';
import type { Pane } from '../api/types';
import { SessionForm, splitDirection } from '../pages/Panes';
import { mayWriteOn } from '../term/grants';

// `+` after the tabs: one more pane beside the focused one on its host, or
// a new session there, where the token and the host allow it. The pane
// made opens beside the others.
export function AddMenu({
  pane,
  onMade,
  onRefused,
}: {
  pane: Pane | undefined;
  onMade: (address: string) => void;
  onRefused: (why: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const busy = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const hosts = useHosts();
  const me = useMe();
  const qc = useQueryClient();
  const canSplit = pane?.mode === 'write';
  const host = hosts.data?.find((h) => h.name === pane?.host);
  const canStart = !!host?.sessions && mayWriteOn(me.data?.write ?? [], host.name);
  // The button stays whenever something could be added anywhere; what the
  // focused pane does not allow is disabled with its reason.
  const anyStart = !!hosts.data?.some(
    (h) => h.sessions && mayWriteOn(me.data?.write ?? [], h.name),
  );
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) {
        setOpen(false);
        setNaming(false);
      }
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (ev.key === '+' && (canSplit || canStart)) {
        ev.preventDefault();
        setOpen(true);
      } else if (ev.key === 'Escape' && open) {
        ev.stopImmediatePropagation();
        setOpen(false);
        setNaming(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  if (!pane || (!canSplit && !canStart && !anyStart)) return null;
  const split = async () => {
    if (busy.current) return;
    busy.current = true;
    setOpen(false);
    try {
      const made = await splitWindow(
        pane.host,
        pane.session,
        pane.window_index,
        splitDirection(pane),
      );
      qc.invalidateQueries({ queryKey: keys.panes });
      onMade(made.pane.address);
    } catch (err) {
      onRefused(err instanceof ApiError ? err.code.replace('_', ' ') : 'failed');
    } finally {
      busy.current = false;
    }
  };
  return (
    <div className="mx-add" ref={box}>
      <button
        type="button"
        className={`mx-add-button${open ? ' on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="one more pane (+)"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="add"
      >
        +
      </button>
      {open && (
        <div className="mx-menu" role="menu" data-testid="add-menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => void split()}
            disabled={!canSplit}
            title={canSplit ? undefined : 'this pane is read-only for you'}
            data-testid="add-split"
          >
            split here <span className="mx-dim">a new pane beside this one on {pane.host}</span>
          </button>
          {(canStart || anyStart) &&
            (naming && canStart ? (
              <SessionForm
                host={pane.host}
                onDone={(address) => {
                  setNaming(false);
                  setOpen(false);
                  if (address) {
                    qc.invalidateQueries({ queryKey: keys.panes });
                    onMade(address);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                role="menuitem"
                onClick={() => setNaming(true)}
                disabled={!canStart}
                title={canStart ? undefined : `${pane.host} does not start sessions for you`}
                data-testid="add-session"
              >
                new session <span className="mx-dim">on {pane.host}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
