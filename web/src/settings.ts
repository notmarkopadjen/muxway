import { useSyncExternalStore } from 'react';

// Per-browser preferences: theme, effects, browser notifications.
export const THEMES = ['green', 'amber', 'paper'] as const;
export type Theme = (typeof THEMES)[number];

const listeners = new Set<() => void>();
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
  listeners.forEach((fn) => fn());
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function applyRoot() {
  const theme = getTheme();
  document.documentElement.dataset.theme = theme === 'green' ? '' : theme;
  document.documentElement.dataset.motion = getMotion() ? '' : 'off';
}

export function getTheme(): Theme {
  const v = read('mx-theme');
  return (THEMES as readonly string[]).includes(v ?? '') ? (v as Theme) : 'green';
}
export function setTheme(t: Theme) {
  write('mx-theme', t);
  applyRoot();
}
export function cycleTheme(): Theme {
  const next = THEMES[(THEMES.indexOf(getTheme()) + 1) % THEMES.length];
  setTheme(next);
  return next;
}
export function getMotion(): boolean {
  return read('mx-motion') !== 'off';
}
export function toggleMotion(): boolean {
  const next = !getMotion();
  write('mx-motion', next ? 'on' : 'off');
  applyRoot();
  return next;
}
export function getNotify(): boolean {
  return (
    read('mx-notify') === 'on' && 'Notification' in window && Notification.permission === 'granted'
  );
}
export async function toggleNotify(): Promise<boolean> {
  if (getNotify()) {
    write('mx-notify', 'off');
    return false;
  }
  if (!('Notification' in window)) return false;
  const perm = await Notification.requestPermission();
  write('mx-notify', perm === 'granted' ? 'on' : 'off');
  return perm === 'granted';
}

export function useSettings() {
  return useSyncExternalStore(subscribe, () => `${getTheme()}|${getMotion()}|${getNotify()}`);
}
