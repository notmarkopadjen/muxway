// One fetch wrapper for the hub: same-origin cookie, the client header the
// hub requires, JSON in and out, and a reachability signal for the status line.
// A call for another hub of the hubs box goes to that hub's origin with the
// browser's cookie for it; that hub's refusals are its own and move nothing here.

import { originOfHub, splitAddress } from '../hubs';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(`${status} ${code}`);
  }
}

type Listener = (online: boolean) => void;
let online = true;
const listeners = new Set<Listener>();

export function onReachability(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function isOnline(): boolean {
  return online;
}
function setOnline(v: boolean) {
  if (v === online) return;
  online = v;
  listeners.forEach((fn) => fn(v));
}

// Told once per 401 the hub answers, so the app can go to sign-in instead
// of polling on with a session the hub has forgotten.
type Unauthorized = () => void;
const unauthorized = new Set<Unauthorized>();
export function onUnauthorized(fn: Unauthorized): () => void {
  unauthorized.add(fn);
  return () => unauthorized.delete(fn);
}

const etags = new Map<string, { etag: string; body: string }>();

// Drops the bodies kept for conditional requests, at sign-out.
export function forgetCached() {
  etags.clear();
}

// A pane of another hub, `<hub>~<address>`: the address that hub knows,
// and its origin to ask. A hub the box does not name is left to this one,
// which does not know the pane either.
export function target(address: string): { address: string; hub?: string } {
  const { hub, address: bare } = splitAddress(address);
  const origin = hub && originOfHub(hub);
  return origin ? { address: bare, hub: origin } : { address };
}

export async function api<T>(
  path: string,
  init: RequestInit & { conditional?: boolean; hub?: string } = {},
): Promise<T> {
  const { conditional, hub, ...rest } = init;
  const headers = new Headers(init.headers);
  headers.set('X-Muxway-Client', 'web');
  headers.set('Accept', 'application/json');
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');
  const url = (hub ?? '') + path;
  const cached = conditional ? etags.get(url) : undefined;
  if (cached) headers.set('If-None-Match', cached.etag);
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers,
      credentials: hub ? 'include' : 'same-origin',
      cache: 'no-store',
    });
  } catch (err) {
    if (!hub && (err as Error).name !== 'AbortError') setOnline(false);
    throw err;
  }
  if (!hub) setOnline(res.status < 500 || res.status === 503);
  if (res.status === 304 && cached) return JSON.parse(cached.body) as T;
  const text = await res.text();
  if (!res.ok) {
    let code = 'error';
    try {
      code = (JSON.parse(text) as { error?: string }).error ?? code;
    } catch {
      /* not json */
    }
    if (!hub && res.status === 401 && !path.startsWith('/v1/auth/') && path !== '/v1/me')
      unauthorized.forEach((fn) => fn());
    throw new ApiError(res.status, code);
  }
  if (conditional) {
    const etag = res.headers.get('ETag');
    if (etag) etags.set(url, { etag, body: text });
  }
  return (text ? JSON.parse(text) : undefined) as T;
}
