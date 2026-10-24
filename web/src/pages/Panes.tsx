import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useHosts, useTree } from '../api/queries';
import type { Host, Pane } from '../api/types';
import { Box } from '../components/Box';
import { LensMark } from '../components/Lens';
import { PaneTitle } from '../components/PaneTitle';
import { label } from '../term/describe';
import { useLens, word } from '../term/lens';
import { MAX_TILES, routeFor } from '../term/tiles';

// The pane list: every host, its sessions, windows and panes. A click
// opens a pane; the pick box, space, or a click while something is
// picked gathers up to four to open side by side. A window row opens the
// window view, the host's own layout.

function HostTree({
  host,
  filter,
  selected,
  picked,
  onOpen,
  onPick,
  register,
}: {
  host: Host;
  filter: string;
  selected: string | null;
  picked: string[];
  onOpen: (address: string) => void;
  onPick: (address: string) => void;
  register: (host: string, panes: Pane[]) => void;
}) {
  const tree = useTree(host.name, host.online);
  const navigate = useNavigate();
  const lens = useLens();
  const panes = useMemo(() => {
    const all: Pane[] = [];
    for (const s of tree.data?.sessions ?? []) for (const w of s.windows) all.push(...w.panes);
    const f = filter.toLowerCase();
    return f
      ? all.filter((p) =>
          `${p.address} ${label(p)} ${p.title} ${p.alias ?? ''}`.toLowerCase().includes(f),
        )
      : all;
  }, [tree.data, filter]);
  useEffect(() => register(host.name, panes), [host.name, panes, register]);

  return (
    <Box
      title={host.name}
      className={host.online ? '' : 'mx-host-offline'}
      active={false}
      testId={`host-${host.name}`}
    >
      <span className="mx-host-state">{host.online ? 'online' : 'offline'}</span>
      {host.online && tree.isPending && <div className="mx-empty">listing…</div>}
      {host.online && tree.isError && (
        <div className="mx-empty mx-bad">could not list this host</div>
      )}
      {host.online && tree.data && panes.length === 0 && (
        <div className="mx-empty">no panes{filter ? ' match' : ' exposed'}</div>
      )}
      <ul className="mx-tree">
        {tree.data?.sessions.map((s) => {
          const shown = s.windows
            .map((w) => ({ w, panes: w.panes.filter((p) => panes.includes(p)) }))
            .filter((x) => x.panes.length);
          if (!shown.length) return null;
          return (
            <li key={s.name}>
              <div className="mx-session">{s.name}</div>
              {shown.map(({ w, panes: ps }) => (
                <div key={w.index}>
                  <div className="mx-window-line">
                    <button
                      type="button"
                      className="mx-window"
                      data-testid="window-row"
                      onClick={() => navigate({ to: `/w/${host.name}/${s.name}/${w.index}` })}
                      title="the window as the host lays it out"
                    >
                      ▦ {w.index}: {w.name} · {w.panes.length} pane{w.panes.length === 1 ? '' : 's'}{' '}
                      · mirror layout ▸
                    </button>
                  </div>
                  {ps.map((p) => {
                    const st = lens.status(p);
                    const isPicked = picked.includes(p.address);
                    return (
                      <div
                        key={p.pane_id}
                        className={`mx-pane-row${selected === p.address ? ' mx-selected' : ''}${isPicked ? ' mx-picked' : ''}`}
                        onClick={() => (picked.length ? onPick(p.address) : onOpen(p.address))}
                        data-testid="pane-row"
                        data-address={p.address}
                        data-state={st === 'quiet' ? undefined : st}
                      >
                        <button
                          type="button"
                          className="mx-pick"
                          data-testid="pick"
                          aria-label={isPicked ? 'unpick' : 'pick'}
                          title="pick, to open several side by side (space)"
                          onClick={(e) => {
                            e.stopPropagation();
                            onPick(p.address);
                          }}
                        >
                          {isPicked ? '[x]' : '[ ]'}
                        </button>
                        <span
                          className="mx-write"
                          title={p.mode === 'write' ? 'you may type here' : 'read-only'}
                        >
                          {p.mode === 'write' ? '*' : ''}
                        </span>
                        <LensMark status={st} attention={p.attention} />
                        <span className="mx-meta">
                          <PaneTitle pane={p} />
                        </span>
                        <span className="mx-addr">
                          {p.alias && <span className="mx-dim">@{p.alias} </span>}
                          {p.address}
                        </span>
                        <span className="mx-state">{word(st, p.attention?.kind)}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </li>
          );
        })}
      </ul>
    </Box>
  );
}

export function PanesPage() {
  const hosts = useHosts();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const filterRef = useRef<HTMLInputElement>(null);
  const [lists, setLists] = useState<Map<string, Pane[]>>(new Map());
  const register = useMemo(
    () => (host: string, panes: Pane[]) => {
      setLists((m) => (m.get(host) === panes ? m : new Map(m).set(host, panes)));
    },
    [],
  );
  const ordered = useMemo(() => {
    const out: string[] = [];
    for (const h of hosts.data ?? []) for (const p of lists.get(h.name) ?? []) out.push(p.address);
    return out;
  }, [hosts.data, lists]);
  const open = useCallback(
    (addresses: string[]) => navigate({ to: '/p/$', params: { _splat: routeFor(addresses) } }),
    [navigate],
  );
  const pick = useCallback((address: string) => {
    setPicked((p) =>
      p.includes(address)
        ? p.filter((a) => a !== address)
        : p.length < MAX_TILES
          ? [...p, address]
          : p,
    );
  }, []);

  // A layout effect: the listener exists before the first paint, so a key
  // pressed the instant the page shows is not lost.
  useLayoutEffect(() => {
    let pendingG = false;
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        if (ev.key === 'Enter' && target === filterRef.current && ordered.length) {
          open(picked.length ? picked : [selected ?? ordered[0]]);
        }
        return;
      }
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (pendingG) {
        pendingG = false;
        const host = (hosts.data ?? []).find((h) => h.name.startsWith(ev.key.toLowerCase()));
        const first = host && lists.get(host.name)?.[0];
        if (first) setSelected(first.address);
        return;
      }
      const i = selected ? ordered.indexOf(selected) : -1;
      if (ev.key === 'j') setSelected(ordered[Math.min(i + 1, ordered.length - 1)] ?? null);
      else if (ev.key === 'k') setSelected(ordered[Math.max(i - 1, 0)] ?? null);
      else if (ev.key === ' ' && selected) {
        ev.preventDefault();
        pick(selected);
      } else if (ev.key === 'Enter' && (picked.length || selected))
        open(picked.length ? picked : [selected!]);
      else if (ev.key === '/') {
        ev.preventDefault();
        filterRef.current?.focus();
      } else if (ev.key === 'g') pendingG = true;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ordered, selected, picked, open, pick, hosts.data, lists]);

  return (
    <div data-testid="panes">
      <div className="mx-filter">
        <span className="mx-dim">/</span>
        <input
          ref={filterRef}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter panes"
          aria-label="filter panes"
          data-testid="filter"
        />
        <span className="mx-dim">
          {ordered.length} pane{ordered.length === 1 ? '' : 's'}
        </span>
      </div>
      {hosts.isPending && <div className="mx-empty">contacting the hub…</div>}
      {hosts.data?.length === 0 && <div className="mx-empty">this account sees no hosts</div>}
      {hosts.data?.map((h) => (
        <HostTree
          key={h.name}
          host={h}
          filter={filter}
          selected={selected}
          picked={picked}
          onOpen={(a) => open([a])}
          onPick={pick}
          register={register}
        />
      ))}
      {picked.length > 0 && (
        <div className="mx-picked-bar" data-testid="picked-bar">
          <button type="button" onClick={() => setPicked([])} data-testid="clear-picked">
            clear
          </button>
          <span className="mx-dim">
            {picked.length}/{MAX_TILES}
          </span>
          <span className="mx-spacer" />
          <button type="button" onClick={() => open(picked)} data-testid="open-picked">
            {picked.length === 1 ? 'open' : `open ${picked.length} side by side`}
          </button>
        </div>
      )}
      <div className="mx-hint mx-dim">
        {picked.length
          ? `${picked.length}/${MAX_TILES} picked · click adds or removes · Enter opens them`
          : 'click to open · [ ] or space picks several'}
      </div>
    </div>
  );
}
