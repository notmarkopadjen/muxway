import { useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { openShare, pollShowing, probeShare, readSharedPane, showingFile } from '../api/shares';
import type { SharedChanges, Showing } from '../api/types';
import { Box } from '../components/Box';
import { ChangesWindow } from '../components/Changes';
import { FileWindow, gotOf, type Got } from '../components/FileWindow';
import { PaneTitle } from '../components/PaneTitle';
import { Screen } from '../term/Screen';
import { setHeading } from '../shell/heading';

// The observer's view of a shared pane: the password once, then the
// screen at the size the host has, scaled to the box, with the web links
// in it and the windows the owner opens over it: the changes window
// docked to its edge, a file or a diff over the whole. No input, no
// strip, no buttons: this page can only look.

function until(at: number): string {
  return new Date(at * 1000).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Password({ id, onOpen }: { id: string; onOpen: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await openShare(id, password);
      setPassword('');
      onOpen();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'that password was not accepted'
          : err instanceof ApiError && err.status === 404
            ? 'this share has ended'
            : err instanceof ApiError && err.status === 429
              ? 'too many attempts, try again later'
              : 'the hub could not be reached',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-signin">
      <Box title="shared pane" testId="share-signin">
        <div className="mx-dim">
          someone shared a pane with you, read only. the password came apart from the link.
        </div>
        <form onSubmit={submit}>
          <input
            type="password"
            autoComplete="off"
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="share-open-password"
            aria-label="password"
          />
          <button type="submit" disabled={busy || !password} data-testid="share-open">
            open
            <span className="mx-cursor" aria-hidden="true" />
          </button>
        </form>
        {error && (
          <div className="mx-error" role="alert" data-testid="share-open-error">
            {error}
          </div>
        )}
      </Box>
    </div>
  );
}

// The owner's windows, as the hub relays them: the meta and the changes
// from the long poll, the file's bytes fetched once per revision.
interface ObservedState {
  rev: number;
  showing: Showing | null;
  changes: SharedChanges | null;
  got: Got | null;
}

function useObserved(id: string, on: boolean) {
  const [state, setState] = useState<ObservedState>({
    rev: 0,
    showing: null,
    changes: null,
    got: null,
  });
  const url = useRef<string | null>(null);
  useEffect(() => {
    if (!on) return;
    let stopped = false;
    let have: ObservedState = { rev: 0, showing: null, changes: null, got: null };
    const set = (s: ObservedState) => {
      have = s;
      setState(s);
    };
    const ctl = new AbortController();
    (async () => {
      while (!stopped) {
        try {
          const r = await pollShowing(id, have.rev, ctl.signal);
          if (stopped) return;
          if (r.rev === have.rev) continue;
          // The bytes are fetched once per change of the file; a revision
          // that moved only the view or the changes window keeps them.
          if (r.showing && have.got && have.showing?.file_rev === r.showing.file_rev) {
            set({ rev: r.rev, showing: r.showing, changes: r.changes, got: have.got });
            continue;
          }
          if (url.current) URL.revokeObjectURL(url.current);
          url.current = null;
          set({ rev: r.rev, showing: r.showing, changes: r.changes, got: null });
          if (!r.showing) continue;
          const blob = await showingFile(id);
          if (stopped) return;
          url.current = URL.createObjectURL(blob);
          const got = await gotOf(blob, url.current);
          if (!stopped) set({ ...have, got });
        } catch (err) {
          if (stopped || (err as Error).name === 'AbortError') return;
          if (err instanceof ApiError && (err.status === 401 || err.status === 404)) return;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    })();
    return () => {
      stopped = true;
      ctl.abort();
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = null;
    };
  }, [id, on]);
  return state;
}

export function SharePage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const probe = useQuery({
    queryKey: ['share', id],
    queryFn: () => probeShare(id),
    retry: false,
  });
  const [opened, setOpened] = useState(false);
  const pane = useQuery({
    queryKey: ['share-pane', id],
    queryFn: () => readSharedPane(id),
    enabled: opened,
    refetchInterval: 1000,
    retry: (count, err) => !(err instanceof ApiError) && count < 2,
    placeholderData: (prev) => prev,
  });
  const ended =
    (probe.isError && probe.error instanceof ApiError && probe.error.status === 404) ||
    (pane.isError &&
      pane.error instanceof ApiError &&
      (pane.error.status === 404 || pane.error.status === 401));
  const observed = useObserved(id, opened && !ended);
  const p = pane.data?.pane;
  useEffect(() => {
    setHeading({ place: p ? 'shared · read only' : 'shared pane' });
    return () => setHeading({ place: '' });
  }, [p]);
  const box = useRef<HTMLDivElement>(null);
  if (ended)
    return (
      <div className="mx-share mx-share-ended" data-testid="share-ended">
        <div className="mx-empty">this share has ended.</div>
      </div>
    );
  if (probe.isPending) return <div className="mx-empty">…</div>;
  if (probe.isError) return <div className="mx-empty">the hub could not be reached.</div>;
  if (!opened) return <Password id={id} onOpen={() => setOpened(true)} />;
  const showing = observed.showing;
  const changes = observed.changes;
  const nothing = () => undefined;
  return (
    <div className="mx-share" data-testid="share-view">
      <div className="mx-share-head">
        {p ? <PaneTitle pane={p} /> : <span className="mx-dim">…</span>}
        {p && (
          <span className="mx-dim">
            {p.address} ·{' '}
            <span data-testid="share-size">
              {p.width}×{p.height}
            </span>
          </span>
        )}
        <span className="mx-spacer" />
        <span className="mx-dim" data-testid="share-note">
          read only · shared · until {until(pane.data?.expires ?? probe.data?.share.expires ?? 0)}
        </span>
      </div>
      <div className="mx-share-body">
        <Screen
          content={pane.data?.content ?? ''}
          burn={!pane.isPlaceholderData}
          cols={p?.width}
          rows={p?.height}
          boxRef={box}
          height={p && p.height - (pane.data?.trimmed ?? 0)}
          bounds={p && { cols: p.width, rows: p.height }}
          testId="share-screen"
        />
        {changes && (
          <ChangesWindow
            address={p?.address ?? ''}
            folded={!!changes.folded}
            onFold={nothing}
            onClose={nothing}
            onOpen={nothing}
            observed={{ data: changes }}
          />
        )}
      </div>
      {showing && (
        <FileWindow
          shown={{ address: p?.address ?? '', path: showing.path }}
          onClose={() => undefined}
          observed={{
            label: showing.path,
            change: showing.kind === 'diff',
            side: showing.view === 'diff' ? 'diff' : 'file',
            view: showing.view,
            got: observed.got,
          }}
        />
      )}
    </div>
  );
}
