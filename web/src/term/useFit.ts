import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { resizePane } from '../api/queries';
import { cellsFor, inner } from './measure';

// Fit: the host follows the box. Measures the box, debounces, sends a
// resize, retries once after the host's per-second limit, and releases
// when fit goes off or the view goes away. Scope "pane" sizes the pane
// itself, "window" its whole window, laid out as `layout` says when one
// is given; the release puts both back. A size already sent is not sent
// again, so `refit` is there for when another client sized the window
// since: it sends this one's size once more.
// The release must survive the page going away, hence keepalive. It can
// land within the second of the resize it undoes, so a 429 is tried again.
function release(address: string, tries = 3) {
  fetch(`/v1/panes/${address}/resize`, {
    method: 'POST',
    keepalive: true,
    credentials: 'same-origin',
    headers: { 'X-Muxway-Client': 'web', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fit: 'auto' }),
  })
    .then((r) => {
      if (r.status === 429 && tries > 1) window.setTimeout(() => release(address, tries - 1), 1100);
    })
    .catch(() => {});
}

export type FitScope = 'pane' | 'window';

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
) {
  const [size, setSize] = useState<{ cols: number; rows: number } | null>(null);
  const last = useRef<string>('');
  const timer = useRef<number | null>(null);
  const fitted = useRef(false);
  const again = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled || !box.current) return;
    const el = box.current;
    const send = (cols: number, rows: number) => {
      const key = `${cols}x${rows} ${layout ?? ''} ${zoom}`;
      if (key === last.current) return;
      last.current = key;
      fitted.current = true;
      resizePane(address, { cols, rows, scope, layout, zoom: zoom || undefined })
        .then((r) => setSize({ cols: r.pane.width, rows: r.pane.height }))
        .catch((err) => {
          if (err instanceof ApiError && err.status === 429) {
            last.current = '';
            timer.current = window.setTimeout(() => measure(), 1100);
          }
        });
    };
    const measure = () => {
      const { w, h } = inner(el);
      const inset = scope === 'window' ? CELL_INSET : 0;
      const { cols, rows } = cellsFor(w - inset, h - inset);
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
  }, [address, enabled, box, scope, layout, zoom]);
  const refit = useCallback(() => again.current?.(), []);

  // Release on the way out, if we ever fitted: on unmount, and on a page
  // unload, which runs no React cleanup.
  useEffect(() => {
    const bye = () => {
      if (fitted.current) {
        fitted.current = false;
        release(address);
      }
    };
    window.addEventListener('pagehide', bye);
    return () => {
      window.removeEventListener('pagehide', bye);
      bye();
    };
  }, [address]);

  // Turning fit off releases too.
  useEffect(() => {
    if (!enabled && fitted.current) {
      fitted.current = false;
      release(address);
      setSize(null);
    }
  }, [enabled, address]);

  return { size, refit };
}
