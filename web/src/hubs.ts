import { useSyncExternalStore } from 'react';

// The other hubs this browser knows, as links and nothing more: a name
// and an origin each. The list lives under the origin of the hub whose
// page stored it; the hub serving the page is always its first entry.
// Each hub signs the person in on its own page, so no token and no
// cookie is ever carried from one to another.
export interface Hub {
  name: string;
  url: string;
}

export const HUB_NAME = /^[a-z0-9-]{1,32}$/;
const KEY = 'mx-hubs';
const MAX = 32;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

// The origin a hub address must be: https, or http to this machine, with
// nothing after the host and no credentials in it.
export function hubOrigin(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK.has(u.hostname))) return null;
  if (u.username || u.password || u.search || u.hash) return null;
  if (u.pathname !== '/' && u.pathname !== '') return null;
  return u.origin;
}

// Keeps what is well shaped, one entry per origin, this page's own hub
// first; the first entry's name may be empty until the person names it.
export function normalize(raw: unknown, origin: string): Hub[] {
  const out: Hub[] = [{ name: '', url: origin }];
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { name, url } = item as { name?: unknown; url?: unknown };
    if (typeof url !== 'string' || typeof name !== 'string') continue;
    const o = hubOrigin(url);
    if (!o || (name !== '' && !HUB_NAME.test(name))) continue;
    const have = out.find((h) => h.url === o);
    if (have) {
      if (!have.name && name) have.name = name;
      continue;
    }
    if (name && out.length < MAX) out.push({ name, url: o });
  }
  return out;
}

export function shownName(h: Hub): string {
  return h.name || new URL(h.url).host;
}

// A list is carried to another hub in the URL's fragment, names and
// origins only, which that page reads once into its own storage.
export function fragment(hubs: Hub[]): string {
  return '#hubs=' + encodeURIComponent(JSON.stringify(hubs.filter((h) => h.name)));
}

export function fromFragment(hash: string, current: Hub[], origin: string): Hub[] | null {
  if (!hash.startsWith('#hubs=')) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(decodeURIComponent(hash.slice(6)));
  } catch {
    return current;
  }
  return normalize([...current, ...(Array.isArray(raw) ? raw : [])], origin);
}

const listeners = new Set<() => void>();
let cache: { raw: string | null; hubs: Hub[] } | null = null;

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function loadHubs(): Hub[] {
  const raw = read();
  if (cache && cache.raw === raw) return cache.hubs;
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  cache = { raw, hubs: normalize(parsed, location.origin) };
  return cache.hubs;
}

export function saveHubs(hubs: Hub[]) {
  const clean = normalize(hubs, location.origin);
  try {
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    /* private mode */
  }
  cache = null;
  listeners.forEach((fn) => fn());
}

// Why an entry is refused, or nothing when it may be added.
export function checkHub(name: string, url: string, hubs: Hub[]): string | null {
  if (!HUB_NAME.test(name)) return 'name: a-z, 0-9 and -, up to 32';
  const o = hubOrigin(url);
  if (!o) return 'url: https://host, nothing after it';
  if (hubs.some((h) => h.url === o)) return 'that hub is in the list';
  if (hubs.some((h) => h.name === name)) return 'that name is taken';
  if (hubs.length >= MAX) return `up to ${MAX} hubs`;
  return null;
}

export function addHub(name: string, url: string) {
  const hubs = loadHubs();
  saveHubs([...hubs, { name, url: hubOrigin(url) ?? url }]);
}

export function renameHub(url: string, name: string) {
  saveHubs(loadHubs().map((h) => (h.url === url ? { ...h, name } : h)));
}

export function removeHub(url: string) {
  if (url === location.origin) return;
  saveHubs(loadHubs().filter((h) => h.url !== url));
}

// Reads a list carried in the address once, then strips it.
export function takeFragment() {
  const merged = fromFragment(location.hash, loadHubs(), location.origin);
  if (merged === null) return;
  saveHubs(merged);
  history.replaceState(null, '', location.pathname + location.search);
}

export function useHubs(): Hub[] {
  return useSyncExternalStore((fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, loadHubs);
}
