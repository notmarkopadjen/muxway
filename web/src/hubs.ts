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

// A pane of another hub is named `<hub name>~<address>` wherever the page
// keys panes by address: routes, tiles, the strip, the selector. This
// page's own hub keeps bare addresses, so every bookmark stands.
export function splitAddress(a: string): { hub?: string; address: string } {
  const i = a.indexOf('~');
  if (i < 0) return { address: a };
  const hub = a.slice(0, i);
  return HUB_NAME.test(hub) ? { hub, address: a.slice(i + 1) } : { address: a };
}

export function joinAddress(hub: string | undefined, address: string): string {
  return hub ? `${hub}~${address}` : address;
}

// The origin of another hub in the box, by its name; nothing for this
// page's own hub or a name the box does not have.
export function originOfHub(name: string): string | undefined {
  return loadHubs().find((h, i) => i > 0 && h.name === name)?.url;
}

// A list is carried to another hub in the URL's fragment, names and
// origins only. That page never takes it as it is: the entries it does
// not know wait in the tab until the person, signed in, adds or ignores
// each one.
export function fragment(hubs: Hub[]): string {
  return '#hubs=' + encodeURIComponent(JSON.stringify(hubs.filter((h) => h.name)));
}

// The well shaped, named entries of a carried list that are not in the
// list already, this hub's own among them while it has no name; nothing
// when the address carries none.
export function fromFragment(hash: string, current: Hub[], origin: string): Hub[] | null {
  if (!hash.startsWith('#hubs=')) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(decodeURIComponent(hash.slice(6)));
  } catch {
    return [];
  }
  const known = new Set(current.filter((h) => h.name || h.url !== origin).map((h) => h.url));
  return normalize(raw, origin).filter((h) => h.name && !known.has(h.url));
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

// Reads a list carried in the address once, then strips it. What is new
// in it is only held, in this tab, until it is added or ignored.
export function takeFragment() {
  const found = fromFragment(location.hash, loadHubs(), location.origin);
  if (found === null) return;
  history.replaceState(null, '', location.pathname + location.search);
  if (!found.length) return;
  const have = loadPending();
  const urls = new Set(have.map((h) => h.url));
  savePending([...have, ...found.filter((h) => !urls.has(h.url))].slice(0, MAX));
}

const PENDING = 'mx-hubs-carried';
let pendingCache: { raw: string | null; hubs: Hub[] } | null = null;

export function loadPending(): Hub[] {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(PENDING);
  } catch {
    raw = null;
  }
  if (pendingCache && pendingCache.raw === raw) return pendingCache.hubs;
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  pendingCache = { raw, hubs: normalize(parsed, location.origin).filter((h) => h.name) };
  return pendingCache.hubs;
}

function savePending(hubs: Hub[]) {
  try {
    if (hubs.length) sessionStorage.setItem(PENDING, JSON.stringify(hubs));
    else sessionStorage.removeItem(PENDING);
  } catch {
    /* private mode */
  }
  pendingCache = null;
  listeners.forEach((fn) => fn());
}

// A carried entry the person took goes into the list, or names this hub
// when it is this hub's own; one ignored is gone.
export function acceptPending(url: string): string | null {
  const h = loadPending().find((p) => p.url === url);
  if (!h) return null;
  if (h.url === location.origin) {
    if (loadHubs().some((x) => x.name === h.name)) return 'that name is taken';
    renameHub(h.url, h.name);
  } else {
    const problem = checkHub(h.name, h.url, loadHubs());
    if (problem) return problem;
    addHub(h.name, h.url);
  }
  ignorePending(url);
  return null;
}

export function ignorePending(url: string) {
  savePending(loadPending().filter((h) => h.url !== url));
}

export function usePending(): Hub[] {
  return useSyncExternalStore((fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, loadPending);
}

export function useHubs(): Hub[] {
  return useSyncExternalStore((fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, loadHubs);
}
