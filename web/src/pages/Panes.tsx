import { useNavigate } from '@tanstack/react-router';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useHosts, useTree } from '../api/queries';
import type { Host, Pane } from '../api/types';
import { Badge } from '../components/Badge';
import { Box } from '../components/Box';
import { PaneTitle } from '../components/PaneTitle';
import { label } from '../term/describe';

function HostTree({
  host,
  filter,
  selected,
  onSelect,
  register,
}: {
  host: Host;
  filter: string;
  selected: string | null;
  onSelect: (address: string) => void;
  register: (host: string, panes: Pane[]) => void;
}) {
  const tree = useTree(host.name, host.online);
  const navigate = useNavigate();
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
      {!host.online && <div className="mx-empty">offline</div>}
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
                  <div
                    className="mx-window"
                    data-testid="window-row"
                    onClick={() => navigate({ to: `/w/${host.name}/${s.name}/${w.index}` })}
                    title="open the window view"
                  >
                    {w.index}: {w.name}
                    {ps.length > 1 && <span className="mx-faint"> ▦ {ps.length}</span>}
                  </div>
                  {ps.map((p) => (
                    <div
                      key={p.pane_id}
                      className={`mx-pane-row${selected === p.address ? ' mx-selected' : ''}`}
                      onClick={() => onSelect(p.address)}
                      data-testid="pane-row"
                      data-address={p.address}
                    >
                      <Badge attention={p.attention} />
                      <span className="mx-meta">
                        <PaneTitle pane={p} />
                      </span>
                      <span className="mx-addr">
                        {p.alias && <span className="mx-dim">@{p.alias} </span>}
                        {p.address}
                      </span>
                      <span className={`mx-mode ${p.mode}`}>{p.mode}</span>
                    </div>
                  ))}
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

  // A layout effect: the listener exists before the first paint, so a key
  // pressed the instant the page shows is not lost.
  useLayoutEffect(() => {
    let pendingG = false;
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        if (ev.key === 'Enter' && target === filterRef.current && ordered.length) {
          navigate({ to: '/p/$', params: { _splat: selected ?? ordered[0] } });
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
      else if (ev.key === 'Enter' && selected)
        navigate({ to: '/p/$', params: { _splat: selected } });
      else if (ev.key === '/') {
        ev.preventDefault();
        filterRef.current?.focus();
      } else if (ev.key === 'g') pendingG = true;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ordered, selected, navigate, hosts.data, lists]);

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
          onSelect={(a) => navigate({ to: '/p/$', params: { _splat: a } })}
          register={register}
        />
      ))}
    </div>
  );
}
