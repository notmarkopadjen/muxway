import { useSyncExternalStore } from 'react';
import type { Pane } from '../api/types';

// What the header names: the pane a view is about, and where it is. A
// view sets it while it is shown; the shell reads it.
export interface Heading {
  pane?: Pane;
  place: string;
}

let current: Heading = { place: '' };
const listeners = new Set<() => void>();

export function setHeading(h: Heading) {
  if (h.place === current.place && h.pane === current.pane) return;
  current = h;
  listeners.forEach((fn) => fn());
}

export function useHeading(): Heading {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}
