import { api, ApiError, target } from './client';
import type { Share, SharedPane, Showing, ShowingKind, ShowingView } from './types';

// Sharing a pane read-only: the sharer's calls go through the session as
// every other; the observer's go to /v1/share/{id}/ with that share's own
// cookie, which the browser sends there and nowhere else.

export async function createShare(
  address: string,
  opts: { ttl?: number; password?: string },
): Promise<Share> {
  const t = target(address);
  const out = await api<{ share: Share }>(`/v1/panes/${t.address}/shares`, {
    method: 'POST',
    body: JSON.stringify(opts),
    hub: t.hub,
  });
  return out.share;
}

export async function listShares(hub?: string): Promise<Share[]> {
  const out = await api<{ shares: Share[] }>('/v1/shares', { hub });
  return out.shares;
}

export function revokeShare(id: string, hub?: string): Promise<void> {
  return api<void>(`/v1/shares/${id}`, { method: 'DELETE', hub });
}

// The sharer's page tells the hub what it shows: the meta always, the
// bytes when they changed.
export function putShowing(
  id: string,
  meta: { kind: ShowingKind; path: string; view: ShowingView },
  file?: Blob,
  hub?: string,
): Promise<void> {
  const body = new FormData();
  body.append('meta', JSON.stringify(meta));
  if (file) body.append('file', file, 'file');
  return api<void>(`/v1/share/${id}/showing`, { method: 'PUT', body, hub });
}

export function clearShowing(id: string, hub?: string): Promise<void> {
  return api<void>(`/v1/share/${id}/showing`, { method: 'DELETE', hub });
}

// --- the observer -----------------------------------------------------------

export function probeShare(id: string): Promise<{ share: { expires: number } }> {
  return api<{ share: { expires: number } }>(`/v1/share/${id}`);
}

export function openShare(id: string, password: string): Promise<void> {
  return api<void>(`/v1/share/${id}/open`, { method: 'POST', body: JSON.stringify({ password }) });
}

export function closeShare(id: string): Promise<void> {
  return api<void>(`/v1/share/${id}/close`, { method: 'POST' });
}

export function readSharedPane(id: string): Promise<SharedPane> {
  return api<SharedPane>(`/v1/share/${id}/pane?ansi=1&lines=200`, { conditional: true });
}

export function pollShowing(
  id: string,
  after: number,
  signal: AbortSignal,
): Promise<{ rev: number; showing: Showing | null }> {
  return api<{ rev: number; showing: Showing | null }>(
    `/v1/share/${id}/showing?after=${after}&wait=25`,
    { signal },
  );
}

export async function showingFile(id: string): Promise<Blob> {
  const res = await fetch(`/v1/share/${id}/showing/file`, {
    headers: { 'X-Muxway-Client': 'web' },
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!res.ok) throw new ApiError(res.status, 'not_found');
  return res.blob();
}
