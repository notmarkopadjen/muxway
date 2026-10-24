import { Link, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isOnline, onReachability, onUnauthorized } from '../api/client';
import { useEventStream } from '../api/events';
import { keys } from '../api/queries';
import type { Pane, Tree, PaneContent } from '../api/types';
import { PaneTitle } from '../components/PaneTitle';
import { label } from '../term/describe';
import { useHeading } from './heading';
import type { Event } from '../api/types';
import { useSession } from '../auth/session';
import { GLYPH } from '../components/Badge';
import { useToast } from '../components/Toast';
import { cycleTheme, getNotify, toggleMotion, useSettings } from '../settings';
import { Help } from './Help';
import { Hubs } from './Hubs';
import { shownName, useHubs } from '../hubs';
import { Palette } from '../components/Palette';
import { addPane, loadBoard, saveBoard } from '../term/board';
import { changedRecently, noteEvent } from '../term/lens';

const ATTENTION = new Set(['question', 'permission', 'idle', 'done']);

function useOnline(): boolean {
  const [online, setOnline] = useState(isOnline());
  useEffect(() => onReachability(setOnline), []);
  return online;
}

// Keeps the tab title, and flashes it until the window has focus again.
function useTitleFlash(title: string) {
  const timer = useRef<number | null>(null);
  const base = useRef(title);
  const stop = useCallback(() => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    document.title = base.current;
  }, []);
  useEffect(() => {
    base.current = title;
    if (!timer.current) document.title = title;
  }, [title]);
  useEffect(() => {
    window.addEventListener('focus', stop);
    return () => window.removeEventListener('focus', stop);
  }, [stop]);
  return useCallback(() => {
    if (document.hasFocus() || timer.current) return;
    let on = false;
    timer.current = window.setInterval(() => {
      on = !on;
      document.title = on ? `[!] ${base.current}` : base.current;
    }, 800);
  }, []);
}

export function Shell() {
  const { me, signedIn, logout } = useSession();
  const online = useOnline();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [help, setHelp] = useState(false);
  const [palette, setPalette] = useState(false);
  const [hubsOpen, setHubsOpen] = useState(false);
  const hubs = useHubs();
  const [resync, setResync] = useState(false);
  const heading = useHeading();
  const flash = useTitleFlash(
    heading.pane
      ? `${label(heading.pane)} · muxway`
      : heading.place
        ? `${heading.place} · muxway`
        : 'muxway',
  );
  useSettings();

  // The pane an event is about, as some list already has it.
  const qc = useQueryClient();
  const known = useCallback(
    (address: string): Pane | undefined => {
      const open = qc.getQueryData<PaneContent>(keys.pane(address))?.pane;
      if (open) return open;
      const all = qc.getQueryData<Pane[]>(keys.panes)?.find((p) => p.address === address);
      if (all) return all;
      const host = address.split('/')[0];
      for (const s of qc.getQueryData<Tree>(keys.tree(host))?.sessions ?? [])
        for (const w of s.windows) for (const p of w.panes) if (p.address === address) return p;
      return undefined;
    },
    [qc],
  );
  const onEvent = useCallback(
    (e: Event, live: boolean) => {
      noteEvent(e.address, e.kind);
      if (!live || !ATTENTION.has(e.kind)) return;
      // Idle while the screen still moves is background work: no notice.
      if (e.kind === 'idle' && changedRecently(e.address)) return;
      const kind = e.kind as keyof typeof GLYPH;
      const pane = known(e.address);
      toast.push({
        kind: `${GLYPH[kind]} ${e.kind}`,
        title: pane ? <PaneTitle pane={pane} /> : e.address,
        meta: pane ? e.address : undefined,
        text: e.text,
        onClick: () => navigate({ to: '/p/$', params: { _splat: e.address } }),
      });
      flash();
      if (getNotify() && document.visibilityState === 'hidden') {
        try {
          new Notification(`muxway: ${e.kind}`, {
            body: pane ? `${label(pane)} · ${e.address}` : e.address,
            tag: e.address,
          });
        } catch {
          /* denied */
        }
      }
    },
    [toast, navigate, flash, known],
  );
  useEventStream(onEvent, signedIn);

  // The hub forgot the session, after a restart or an expiry: sign in again.
  useEffect(
    () =>
      onUnauthorized(() => {
        if (location.pathname === '/signin') return;
        qc.clear();
        navigate({ to: '/signin' });
      }),
    [location.pathname, navigate, qc],
  );

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (ev.key === 'Escape') {
        if (palette) setPalette(false);
        else if (hubsOpen) setHubsOpen(false);
        else if (help) setHelp(false);
        else if (typing) (target as HTMLElement).blur();
        else if (location.pathname !== '/') navigate({ to: '/' });
        return;
      }
      if (typing || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.key === '?') {
        setHelp((h) => !h);
        ev.preventDefault();
      } else if (ev.key === 'p' && signedIn) {
        setPalette(true);
        ev.preventDefault();
      } else if (ev.key === 'H') {
        setHubsOpen((h) => !h);
        ev.preventDefault();
      } else if (ev.key === 'b' && signedIn) {
        // From a pane, b puts the focused one on the main board; from
        // anywhere, b opens the board.
        if (location.pathname.startsWith('/p/') && heading.pane)
          saveBoard('main', addPane(loadBoard('main'), heading.pane.address, null, 'h'));
        navigate({ to: '/b/$name', params: { name: 'main' } });
        ev.preventDefault();
      } else if (ev.key === 't') {
        const theme = cycleTheme();
        setResync(true);
        toast.push({ kind: 'theme', title: theme });
      } else if (ev.key === 'm') {
        toast.push({ kind: 'effects', title: toggleMotion() ? 'on' : 'off' });
      } else if (ev.key === 'i') {
        const input = document.querySelector<HTMLTextAreaElement>('[data-testid="input"]');
        if (input && !input.disabled) {
          ev.preventDefault();
          input.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [help, palette, hubsOpen, signedIn, location.pathname, navigate, toast, heading.pane]);

  return (
    <>
      <header className="mx-header">
        <span className="mx-brand">
          <Link to="/">┌─ muxway ─┐</Link>
        </span>
        {hubs.length > 1 && (
          <span className="mx-hub" data-testid="hub-here">
            {shownName(hubs[0])}
          </span>
        )}
        <span className="mx-crumb" data-testid="crumb">
          {heading.pane && <PaneTitle pane={heading.pane} />}
          {heading.place && <span className="mx-place">{heading.place}</span>}
        </span>
        <span className="mx-spacer" />
        <button
          type="button"
          onClick={() => setHubsOpen(true)}
          title="hubs (H)"
          data-testid="open-hubs"
        >
          ⇄
        </button>
        {signedIn && (
          <>
            <span className="mx-who" data-testid="who">
              {me?.name}
            </span>
            <button
              type="button"
              onClick={() => setPalette(true)}
              title="go to a pane (p)"
              data-testid="open-palette"
            >
              ≡
            </button>
            <button type="button" onClick={() => setHelp(true)} title="help (?)">
              ?
            </button>
            <button
              type="button"
              onClick={() => logout().then(() => navigate({ to: '/signin' }))}
              data-testid="logout"
            >
              logout
            </button>
          </>
        )}
      </header>
      <main
        className={`mx-main${resync ? ' mx-resync' : ''}`}
        onAnimationEnd={() => setResync(false)}
      >
        <Outlet />
      </main>
      <footer className="mx-status" data-testid="status">
        <span className={online ? '' : 'mx-offline mx-noise'} data-testid="online">
          {online ? '● hub' : '○ hub unreachable, retrying'}
        </span>
        <span className="mx-spacer" />
        <span>
          <kbd>?</kbd> help · <kbd>t</kbd> theme · <kbd>/</kbd> filter
        </span>
      </footer>
      {help && (
        <Help
          onClose={() => setHelp(false)}
          onHubs={() => {
            setHelp(false);
            setHubsOpen(true);
          }}
        />
      )}
      {hubsOpen && <Hubs onClose={() => setHubsOpen(false)} />}
      {palette && <Palette onClose={() => setPalette(false)} />}
    </>
  );
}
