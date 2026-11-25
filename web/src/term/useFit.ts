import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { resizePane } from '../api/queries';
import type { Pane } from '../api/types';
import { CLIENT_LABEL } from './client';
import { spared } from './spare';
import { cellsFor, inner } from './measure';

// The host follows the box. Measures the box, debounces, sends a
// resize, and tries once more after the host's per-second limit. Scope
// "pane" sizes the pane itself, "window" its whole window, laid out as
// `layout` says when one is given. A size already sent is not sent
// again, so `refit` is there for when another client sized the window
// since: it sends this one's size once more. A pane shown in a tile and
// then left for another keeps its size: found at the size asked for it
// is not sent again, unless the fit takes it back from a zoom made here
// (spare.ts). `asked` is the last size sent, with when, so a tile can
// tell a size the host would not give. `slack` is height the box has
// lost to something that is not a resize, the input line grown while a
// message is written: the fit measures as if it were not there, so the
// host is not resized a row at a time.
//
// Nothing here ever hands a window back. A window keeps the size the
// view gave it, so a session carries the size it is being shown at;
// `fit: auto` belongs to the command line and the MCP tool.
export type FitScope = 'pane' | 'window';

export interface FitOptions {
  // The pane's size as last listed, to spare a resize the host has.
  known?: () => { cols: number; rows: number; zoomed?: boolean } | undefined;
  // Window scope takes a cell off for the window view's cell chrome.
  inset?: boolean;
  // The host's answer, which after a layout lists the window's panes.
  onDone?: (r: { panes?: Pane[] }) => void;
  // A refusal other than the rate limit, with its status.
  onRefused?: (status: number) => void;
  slack?: () => number;
  // Window scope: the size and layout measured from the tiles themselves,
  // exact to the cell, instead of the box and the proportional layout.
  exact?: () => { cols: number; rows: number; layout: string } | null;
}

// Panes fitted, across tiles that came and went.
const kept = new Set<string>();
// Panes this page last asked zoomed: the fit that brings their tiles
// back is sent whatever the listing says (spare.ts).
const zoomedHere = new Set<string>();

// Leaving the view forgets what this page fitted; it does not hand the
// windows back. A window keeps the size the view gave it, so a session
// carries the size it is being shown at: coming back finds it as it
// was, with nothing to send and nothing to settle, and the host never
// resizes a window twice over a tab being closed. Fit turned off is
// the way back (below), and `fit: auto` is still there for a client
// that wants one.
export function forgetKept() {
  kept.clear();
  zoomedHere.clear();
}

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
  const fitted = useRef(false);
  const again = useRef<(() => void) | null>(null);
  const { inset = scope === 'window' } = opts;
  const known = useRef(opts.known);
  known.current = opts.known;
  const slack = useRef(opts.slack);
  slack.current = opts.slack;
  const exact = useRef(opts.exact);
  exact.current = opts.exact;
  const done = useRef(opts.onDone);
  done.current = opts.onDone;
  const refused = useRef(opts.onRefused);
  refused.current = opts.onRefused;

  useEffect(() => {
    if (!enabled || !box.current) return;
    const el = box.current;
    // A fit of this run only: once the run is over (the view changed what
    // it fits), a late answer schedules nothing, or a stale size would be
    // sent again until it won.
    let live = true;
    let timer: number | null = null;
    const send = (cols: number, rows: number, lay = layout) => {
      const key = `${cols}x${rows} ${lay ?? ''} ${zoom}`;
      if (key === last.current) return;
      last.current = key;
      fitted.current = true;
      setAsked({ cols, rows, at: Date.now() });
      const have = kept.has(address) ? known.current?.() : undefined;
      const fromZoom = zoomedHere.has(address);
      kept.add(address);
      if (zoom) zoomedHere.add(address);
      if (spared(have, { cols, rows }, zoom, fromZoom)) {
        setSize({ cols, rows });
        return;
      }
      resizePane(address, {
        cols,
        rows,
        scope,
        layout: lay,
        zoom: zoom || undefined,
        client: CLIENT_LABEL,
      })
        .then((r) => {
          if (!zoom) zoomedHere.delete(address);
          setSize({ cols: r.pane.width, rows: r.pane.height });
          if (live) done.current?.(r);
        })
        .catch((err) => {
          if (live && err instanceof ApiError && err.status === 429) {
            last.current = '';
            timer = window.setTimeout(measure, 1100);
          } else if (live && err instanceof ApiError) refused.current?.(err.status);
        });
    };
    const measure = () => {
      if (!live) return;
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
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(measure, 300);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    schedule();
    again.current = () => {
      last.current = '';
      measure();
    };
    return () => {
      live = false;
      ro.disconnect();
      again.current = null;
      if (timer) window.clearTimeout(timer);
      last.current = '';
    };
  }, [address, enabled, box, scope, layout, zoom, inset]);
  const refit = useCallback(() => again.current?.(), []);

  // A pane nothing may size any more (it went read-only, or its tile
  // went) is forgotten, not handed back: the window keeps the size it
  // was given. Nothing in a browser releases a window; `fit: auto` is
  // the command line's and the MCP tool's.
  useEffect(() => {
    if (!enabled && fitted.current) {
      fitted.current = false;
      kept.delete(address);
      zoomedHere.delete(address);
      setSize(null);
    }
  }, [enabled, address]);

  return { size, asked, refit };
}
