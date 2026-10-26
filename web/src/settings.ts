import { useSyncExternalStore } from 'react';

// Per-browser preferences: theme, effects, browser notifications, the
// screen font size.
export const THEMES = ['amber', 'green', 'paper'] as const;
export type Theme = (typeof THEMES)[number];
export const FONTS = [11, 12, 13, 14, 16, 18, 20] as const;

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
  document.documentElement.dataset.theme = theme === 'amber' ? '' : theme;
  document.documentElement.dataset.motion = getMotion() ? '' : 'off';
  document.documentElement.style.setProperty('--mx-screen-size', `${getFont()}px`);
  // The tab's icon in the theme's colours.
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon) icon.href = theme === 'amber' ? '/icon.svg' : `/icon-${theme}.svg`;
}

// The font size a pane is read at, and the cell the host is sized by.
export function getFont(): number {
  const n = Number(read('mx-font'));
  return (FONTS as readonly number[]).includes(n) ? n : 14;
}
export function setFont(px: number) {
  write('mx-font', String(px));
  applyRoot();
}
export function cycleFont(): number {
  const next = FONTS[(FONTS.indexOf(getFont() as (typeof FONTS)[number]) + 1) % FONTS.length];
  setFont(next);
  return next;
}

export function getTheme(): Theme {
  const v = read('mx-theme');
  return (THEMES as readonly string[]).includes(v ?? '') ? (v as Theme) : 'amber';
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
// How a Markdown file is shown in the file window: rendered, or as its source.
export type PreviewView = 'rendered' | 'plain';
export function getPreview(): PreviewView {
  return read('mx-preview') === 'plain' ? 'plain' : 'rendered';
}
export function setPreview(v: PreviewView) {
  write('mx-preview', v);
}
export function usePreview(): PreviewView {
  return useSyncExternalStore(subscribe, getPreview, getPreview);
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
  return useSyncExternalStore(
    subscribe,
    () => `${getTheme()}|${getMotion()}|${getNotify()}|${getFont()}`,
  );
}
