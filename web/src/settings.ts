import { useMemo, useSyncExternalStore } from 'react';
import { ORDER_MAX } from './term/order';

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
  // The installed app's window colour: the theme's background.
  const colour = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (colour) colour.content = THEME_BG[theme];
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
// The backgrounds of the three themes, as tokens.css has them.
const THEME_BG: Record<Theme, string> = { amber: '#0a0603', green: '#050806', paper: '#f1ead8' };

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

// The strip's order: the addresses dragged into place, first to last.
// Garbage in storage is an empty order; see term/order.ts for the rest.
export function parseOrder(raw: string | null): string[] {
  if (!raw || raw.length > 65_536) return [];
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string' || !x || x.length > 256) return [];
    if (!out.includes(x)) out.push(x);
    if (out.length === ORDER_MAX) break;
  }
  return out;
}
export function getTabOrder(): string[] {
  return parseOrder(read('mx-tab-order'));
}
export function setTabOrder(order: string[]) {
  write('mx-tab-order', JSON.stringify(order.slice(0, ORDER_MAX)));
}
export function useTabOrder(): string[] {
  const raw = useSyncExternalStore(
    subscribe,
    () => read('mx-tab-order'),
    () => null,
  );
  return useMemo(() => parseOrder(raw), [raw]);
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
