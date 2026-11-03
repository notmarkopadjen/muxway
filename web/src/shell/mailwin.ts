import { useSyncExternalStore } from 'react';

// The mail window: one pane's mail, opened from an envelope, a mail row
// or M. The shell shows it; any view asks for it.
export interface MailWindow {
  address: string;
  // A mail to bring into view, by its id.
  mailId?: number;
  // Open with the line focused (M).
  line?: boolean;
}

let current: MailWindow | null = null;
const listeners = new Set<() => void>();

export function openMailWindow(w: MailWindow) {
  current = w;
  listeners.forEach((fn) => fn());
}

export function closeMailWindow() {
  if (!current) return;
  current = null;
  listeners.forEach((fn) => fn());
}

export function useMailWindow(): MailWindow | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}
