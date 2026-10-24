import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAllPanes } from '../api/queries';
import type { Pane } from '../api/types';
import { Badge } from './Badge';
import { Box } from './Box';

// The pane selector: every pane and window the person may reach, filtered
// as they type, attention first.
interface Row {
  key: string;
  kind: 'pane' | 'window';
  label: string;
  meta: string;
  pane?: Pane;
  to: () => void;
}

export function Palette({ onClose }: { onClose: () => void }) {
  const panes = useAllPanes(true);
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const windows = new Map<string, Pane[]>();
    for (const p of panes.data ?? []) {
      const wk = `${p.host}/${p.session}/${p.window_index}`;
      windows.set(wk, [...(windows.get(wk) ?? []), p]);
      out.push({
        key: p.address,
        kind: 'pane',
        label: p.address + (p.alias ? ` @${p.alias}` : ''),
        meta: [p.command, p.title !== p.command ? p.title : ''].filter(Boolean).join(' · '),
        pane: p,
        to: () => navigate({ to: '/p/$', params: { _splat: p.address } }),
      });
    }
    for (const [wk, ps] of windows) {
      if (ps.length < 2) continue;
      const p = ps[0];
      out.push({
        key: 'w:' + wk,
        kind: 'window',
        label: `${wk} (${ps.length} panes)`,
        meta: p.window,
        to: () => navigate({ to: `/w/${p.host}/${p.session}/${p.window_index}` }),
      });
    }
    const rank = (r: Row) => (r.pane?.attention ? 0 : 1);
    const f = q.trim().toLowerCase();
    return out
      .filter((r) => !f || `${r.label} ${r.meta}`.toLowerCase().includes(f))
      .sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
  }, [panes.data, q, navigate]);

  useEffect(() => setSel(0), [q]);
  const go = (r: Row | undefined) => {
    if (!r) return;
    onClose();
    r.to();
  };
  return (
    <div className="mx-help" onClick={onClose} data-testid="palette">
      <div onClick={(e) => e.stopPropagation()}>
        <Box title="go to" enter={false}>
          <input
            ref={field}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="pane, alias, command, title"
            aria-label="find a pane"
            data-testid="palette-filter"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || (e.key === 'j' && e.ctrlKey))
                setSel((s) => Math.min(s + 1, rows.length - 1));
              else if (e.key === 'ArrowUp' || (e.key === 'k' && e.ctrlKey))
                setSel((s) => Math.max(s - 1, 0));
              else if (e.key === 'Enter') go(rows[sel]);
              else if (e.key === 'Escape') onClose();
              else return;
              e.preventDefault();
            }}
          />
          <ul className="mx-palette-list">
            {rows.slice(0, 40).map((r, i) => (
              <li
                key={r.key}
                className={i === sel ? 'mx-selected' : ''}
                onClick={() => go(r)}
                data-testid="palette-row"
              >
                {r.kind === 'pane' ? (
                  <Badge attention={r.pane?.attention} />
                ) : (
                  <span className="mx-badge mx-win">▦</span>
                )}
                <span className="mx-addr">{r.label}</span>
                <span className="mx-meta">{r.meta}</span>
              </li>
            ))}
            {rows.length === 0 && <li className="mx-dim">nothing matches</li>}
          </ul>
        </Box>
      </div>
    </div>
  );
}
