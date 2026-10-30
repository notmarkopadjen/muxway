import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

// A move of the tiles drawn as the browser's view transition: every tile
// (or cell) names itself while the move is on, the browser snapshots the
// named elements before and after the change and motion.css animates
// between them. The zoomed tile is named mx-zoom, the rest after their
// pane. With effects off, reduced motion or no API the change is made
// at once. The tiles mount anew across a change of count, so the state
// lives outside React and the tiles watch it.
interface Moving {
  on: boolean;
  zoom: string | null;
}
let moving: Moving = { on: false, zoom: null };
let run = 0;
const watchers = new Set<() => void>();
function set(m: Moving) {
  moving = m;
  watchers.forEach((fn) => fn());
}
export function useMoving(): Moving {
  return useSyncExternalStore(
    (fn) => {
      watchers.add(fn);
      return () => watchers.delete(fn);
    },
    () => moving,
    () => moving,
  );
}

export function nameFor(id: string, zoom: string | null = null): string {
  if (id === zoom) return 'mx-zoom';
  return `mx-t-${id.replace(/[^a-zA-Z0-9]/g, '-')}`;
}

// React commits the change in a task of its own (a navigation after its
// load); the picture is taken after that. Not a frame: rendering is
// paused while the transition waits, so a frame would never come.
function committed(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => window.setTimeout(resolve, 0);
    ch.port2.postMessage(null);
  });
}

export function drawn(change: () => unknown, zoom: string | null = null) {
  const doc = document as Document & {
    startViewTransition?: (update: () => Promise<void>) => { finished: Promise<void> };
  };
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!doc.startViewTransition || document.documentElement.dataset.motion === 'off' || still) {
    change();
    return;
  }
  // The names are in the DOM before the transition takes its picture.
  const mine = ++run;
  flushSync(() => set({ on: true, zoom }));
  const over = () => {
    if (mine === run) set({ on: false, zoom: null });
  };
  try {
    doc
      .startViewTransition(() => Promise.resolve(change()).then(committed))
      .finished.then(over, over);
  } catch {
    // No transition after all: the change at once, the marks cleared.
    change();
    over();
  }
  window.setTimeout(over, 1500);
}
