import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, target } from '../api/client';
import { resizePane } from '../api/queries';
import type { Pane } from '../api/types';
import { cellsFor, inner } from './measure';

// Fit: the host follows the box. Measures the box, debounces, sends a
// resize, retries once after the host's per-second limit, and releases
// when fit goes off or the view goes away. Scope "pane" sizes the pane
// itself, "window" its whole window, laid out as `layout` says when one
// is given; the release puts both back. A size already sent is not sent
// again, so `refit` is there for when another client sized the window
// since: it sends this one's size once more. With `keep`, a tile going
// away leaves its pane fitted: the pane view keeps panes at size while
// another is shown in their place and releases them all when it is left
// (releaseKept); a kept pane found at the size asked for is not sent
// again. `asked` is the last size sent, with when, so a tile can tell a
// size the host would not give. `slack` is height the box has lost to something that is not a resize,
// the input line grown while a message is written: the fit measures as
// if it were not there, so the host is not resized a row at a time.
// The release must survive the page going away, hence keepalive. It can
// land within the second of the resize it undoes, so a 429 is tried again.
function release(address: string, tries = 3) {
  const t = target(address);
  fetch(`${t.hub ?? ''}/v1/panes/${t.address}/resize`, {
    method: 'POST',
    keepalive: true,
    credentials: t.hub ? 'include' : 'same-origin',
    headers: { 'X-Muxway-Client': 'web', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fit: 'auto' }),
  })
    .then((r) => {
      if (r.status === 429 && tries > 1) window.setTimeout(() => release(address, tries - 1), 1100);
    })
    .catch(() => {});
}

export type FitScope = 'pane' | 'window';

export interface FitOptions {
  keep?: boolean;
  // The pane's size as last listed, to spare a resize the host has.
  known?: () => { cols: number; rows: number; zoomed?: boolean } | undefined;
  // Window scope takes a cell off for the window view's cell chrome.
  inset?: boolean;
  // The host's answer, which after a layout lists the window's panes.
  onDone?: (r: { panes?: Pane[] }) => void;
  slack?: () => number;
  // Window scope: the size and layout measured from the tiles themselves,
  // exact to the cell, instead of the box and the proportional layout.
  exact?: () => { cols: number; rows: number; layout: string } | null;
}

// Panes fitted and not yet released, across tiles that came and went.
const kept = new Set<string>();
export function releaseKept() {
  for (const a of kept) release(a);
  kept.clear();
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', releaseKept);

// A window's area holds cells with their own padding and border, which
// the cells per axis lose; one cell's worth is taken off.
const CELL_INSET = 14;

export function useFit(
  address: string,
  enabled: boolean,
  box: React.RefObject<HTMLElement | null>,
  scope: FitScope = 'pane',
  layout?: string,
  zoom = false,
  opts: FitOptions = {},
) {
  const [size, setSize] = useState<{ cols: number; rows: number } | null>(null);
  const [asked, setAsked] = useState<{ cols: number; rows: number; at: number } | null>(null);
  const last = useRef<string>('');
  const timer = useRef<number | null>(null);
  const fitted = useRef(false);
  const again = useRef<(() => void) | null>(null);
  const { keep = false, inset = scope === 'window' } = opts;
  const known = useRef(opts.known);
  known.current = opts.known;
  const slack = useRef(opts.slack);
  slack.current = opts.slack;
  const exact = useRef(opts.exact);
  exact.current = opts.exact;
  const done = useRef(opts.onDone);
  done.current = opts.onDone;

  useEffect(() => {
    if (!enabled || !box.current) return;
    const el = box.current;
    const send = (cols: number, rows: number, lay = layout) => {
      const key = `${cols}x${rows} ${lay ?? ''} ${zoom}`;
      if (key === last.current) return;
      last.current = key;
      fitted.current = true;
      setAsked({ cols, rows, at: Date.now() });
      const have = kept.has(address) ? known.current?.() : undefined;
      kept.add(address);
      if (have && have.cols === cols && have.rows === rows && (!zoom || have.zoomed)) {
        setSize({ cols, rows });
        return;
      }
      resizePane(address, { cols, rows, scope, layout: lay, zoom: zoom || undefined })
        .then((r) => {
          setSize({ cols: r.pane.width, rows: r.pane.height });
          done.current?.(r);
        })
        .catch((err) => {
          if (err instanceof ApiError && err.status === 429) {
            last.current = '';
            timer.current = window.setTimeout(() => measure(), 1100);
          }
        });
    };
    const measure = () => {
      const ex = scope === 'window' ? exact.current?.() : undefined;
      if (ex) {
        send(Math.min(500, Math.max(20, ex.cols)), Math.min(300, Math.max(5, ex.rows)), ex.layout);
        return;
      }
      const { w, h } = inner(el);
      const off = inset ? CELL_INSET : 0;
      const { cols, rows } = cellsFor(w - off, h - off + (slack.current?.() ?? 0));
      send(Math.min(500, Math.max(20, cols)), Math.min(300, Math.max(5, rows)));
    };
    const schedule = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(measure, 300);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    schedule();
    again.current = () => {
      last.current = '';
      measure();
    };
    return () => {
      ro.disconnect();
      again.current = null;
      if (timer.current) window.clearTimeout(timer.current);
      last.current = '';
    };
  }, [address, enabled, box, scope, layout, zoom, inset]);
  const refit = useCallback(() => again.current?.(), []);

  // Release on the way out, if we ever fitted: on unmount, unless the
  // pane is kept for the view to release later. A page unload runs no
  // React cleanup; the registry's pagehide listener covers that.
  useEffect(() => {
    return () => {
      if (fitted.current && !keep) {
        fitted.current = false;
        kept.delete(address);
        release(address);
      }
    };
  }, [address, keep]);

  // Turning fit off releases too.
  useEffect(() => {
    if (!enabled && fitted.current) {
      fitted.current = false;
      kept.delete(address);
      release(address);
      setSize(null);
    }
  }, [enabled, address]);

  return { size, asked, refit };
}
