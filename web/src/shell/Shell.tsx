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
import { forgetLocal, useSession } from '../auth/session';
import { GLYPH } from '../components/Badge';
import { useToast } from '../components/Toast';
import { cycleTheme, getNotify, toggleMotion, useSettings } from '../settings';
import { Help } from './Help';
import { Hubs } from './Hubs';
import { shownName, splitAddress, useHubs } from '../hubs';
import { Palette } from '../components/Palette';
import { Inbox } from '../components/Inbox';
import { loadSeen, markSeen, recent, Talk, unseen } from '../components/Talk';
import { onUpdate, reloadWithUpdate, updateWaiting } from '../sw';
import { useAnswer, useInbox, useTalk } from '../api/queries';
import { HeaderSlot } from './HeaderSlot';
import { Profile } from './Profile';
import { Closing } from '../components/Closing';
import { onPaletteRequest } from '../term/intent';
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
  const [inbox, setInbox] = useState(false);
  const inboxList = useInbox(signedIn);
  const waitingCount = inboxList.data?.length ?? 0;
  // Messages: what panes said to panes, mail and typed; the header counts
  // what the owner has not looked at, and the window clears it.
  const [talkOpen, setTalkOpen] = useState(false);
  const [talkLine, setTalkLine] = useState(false);
  const talkList = useTalk(signedIn);
  const [seen, setSeen] = useState(loadSeen);
  const talkCount = unseen(talkList.data, seen);
  const talkLately = recent(talkList.data).length > 0;
  const openTalk = (line = false) => {
    setTalkLine(line);
    setTalkOpen(true);
  };
  useEffect(() => {
    if (talkOpen) setSeen(markSeen(talkList.data));
  }, [talkOpen, talkList.data]);
  // mutate keeps its identity; the mutation object does not, and onEvent
  // must stay the same or the event stream re-subscribes on every render.
  const { mutate: answerQuestion } = useAnswer();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => onPaletteRequest(() => setPalette(true)), []);
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
  // A new build of the client waits to take over: the status bar says so.
  const [updateReady, setUpdateReady] = useState(updateWaiting);
  useEffect(() => onUpdate(() => setUpdateReady(true)), []);

  // The pane an event is about, as some list already has it.
  const qc = useQueryClient();
  const known = useCallback(
    (address: string): Pane | undefined => {
      const open = qc.getQueryData<PaneContent>(keys.pane(address))?.pane;
      if (open) return open;
      const { hub, address: bare } = splitAddress(address);
      const all = qc.getQueryData<Pane[]>(keys.panesOf(hub))?.find((p) => p.address === address);
      if (all) return all;
      const host = bare.split('/')[0];
      for (const s of qc.getQueryData<Tree>(keys.tree(host, hub))?.sessions ?? [])
        for (const w of s.windows)
          for (const p of w.panes) if (p.address === bare) return hub ? { ...p, address, hub } : p;
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
        actions: e.choices?.map((c) => ({
          label: c,
          onClick: () => answerQuestion({ address: e.address, choice: c }),
        })),
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
    [toast, navigate, flash, known, answerQuestion],
  );
  useEventStream(onEvent, signedIn);

  // The hub forgot the session, after a restart or an expiry: sign in again.
  useEffect(
    () =>
      onUnauthorized(() => {
        if (location.pathname === '/signin') return;
        qc.clear();
        forgetLocal();
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
        else if (inbox) setInbox(false);
        else if (talkOpen) setTalkOpen(false);
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
      } else if (ev.key === 'I' && signedIn) {
        setInbox((v) => !v);
        ev.preventDefault();
      } else if (ev.key === 'o' && signedIn && !inbox) {
        const oldest = inboxList.data?.[0];
        if (oldest) navigate({ to: '/p/$', params: { _splat: oldest.address } });
        ev.preventDefault();
      } else if (ev.key === 'T' && signedIn) {
        if (talkOpen) setTalkOpen(false);
        else openTalk();
        ev.preventDefault();
      } else if (ev.key === 'M' && signedIn && heading.pane) {
        openTalk(true);
        ev.preventDefault();
      } else if (ev.key === 'H') {
        setHubsOpen((h) => !h);
        ev.preventDefault();
      } else if (ev.key === 't') {
        const theme = cycleTheme();
        setResync(true);
        toast.push({ kind: 'theme', title: theme });
      } else if (ev.key === 'm') {
        toast.push({ kind: 'effects', title: toggleMotion() ? 'on' : 'off' });
      } else if (ev.key === 'i' || ev.key === ':') {
        const input = document.querySelector<HTMLTextAreaElement>('[data-testid="input"]');
        if (input && !input.disabled) {
          ev.preventDefault();
          input.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    help,
    palette,
    inbox,
    talkOpen,
    hubsOpen,
    signedIn,
    location.pathname,
    navigate,
    toast,
    heading.pane,
    inboxList.data,
  ]);

  return (
    <>
      <header className="mx-header">
        <Link to="/" className="mx-brand" title="back to the panes (Esc)" data-testid="back">
          ┌─ muxway ─┐
        </Link>
        {hubs.length > 1 && (
          <span className="mx-hub" data-testid="hub-here">
            {shownName(hubs[0])}
          </span>
        )}
        {signedIn && waitingCount > 0 && (
          <button
            type="button"
            className="mx-inbox-count"
            title="the inbox: every pane that waits for you (I)"
            data-testid="inbox-count"
            onClick={() => setInbox(true)}
          >
            ⚑ {waitingCount}
          </button>
        )}
        {signedIn && (talkCount > 0 || talkLately) && (
          <button
            type="button"
            className="mx-talk-count"
            data-unseen={talkCount > 0 ? '' : undefined}
            title="messages: what panes said to panes, mail and typed (T); M mails the open pane"
            data-testid="talk-count"
            onClick={() => openTalk()}
          >
            ✉{talkCount > 0 ? ` ${talkCount}` : ''}
          </button>
        )}
        <div className="mx-header-slot" ref={setSlot} />
        <span className="mx-crumb" data-testid="crumb">
          {heading.place && !heading.pane && <span className="mx-place">{heading.place}</span>}
        </span>
        {signedIn ? (
          <Profile
            name={me?.name ?? ''}
            admin={!!me?.admin}
            onHubs={() => setHubsOpen(true)}
            onHelp={() => setHelp(true)}
            onLogout={() => void logout().then(() => navigate({ to: '/signin' }))}
          />
        ) : (
          <button
            type="button"
            onClick={() => setHubsOpen(true)}
            title="hubs (H)"
            data-testid="open-hubs"
          >
            ⇄
          </button>
        )}
      </header>
      <main
        className={`mx-main${resync ? ' mx-resync' : ''}`}
        onAnimationEnd={() => setResync(false)}
      >
        <HeaderSlot.Provider value={slot}>
          <Outlet />
        </HeaderSlot.Provider>
      </main>
      <footer className="mx-status" data-testid="status">
        <span className={online ? '' : 'mx-offline mx-noise'} data-testid="online">
          {online ? '● hub' : '○ hub unreachable, retrying'}
        </span>
        <span className="mx-spacer" />
        {updateReady && (
          <button
            type="button"
            className="mx-update"
            data-testid="update"
            title="a new build of muxway is ready"
            onClick={reloadWithUpdate}
          >
            new version · reload
          </button>
        )}
        {heading.direct ? (
          <span data-testid="status-direct">
            <kbd>▮</kbd> direct: keys go to the pane · <kbd>Shift+Esc</kbd> leaves
          </span>
        ) : (
          <span>
            <kbd>?</kbd> help · <kbd>t</kbd> theme · <kbd>/</kbd> filter
          </span>
        )}
      </footer>
      <Closing open={help}>
        <Help onClose={() => setHelp(false)} />
      </Closing>
      <Closing open={hubsOpen}>
        <Hubs signedIn={signedIn} onClose={() => setHubsOpen(false)} />
      </Closing>
      <Closing open={palette}>
        <Palette onClose={() => setPalette(false)} />
      </Closing>
      <Closing open={inbox}>
        <Inbox onClose={() => setInbox(false)} />
      </Closing>
      <Closing open={talkOpen}>
        <Talk onClose={() => setTalkOpen(false)} to={heading.pane?.address} line={talkLine} />
      </Closing>
    </>
  );
}
