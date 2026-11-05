import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { keys } from './queries';
import { queryClient } from '../query';
import type { Layout, TileNode, Weights } from '../term/tiles';

// The desk: the view the owner's clients share, kept by the hub. A view
// writes it half a second after its last change; a view opens it, and
// follows the other clients' changes to it, through the query below,
// which the desk event invalidates. The last desk known (read, or
// answered to a write) is kept so a view writes nothing the hub already
// has and applies nothing it already shows: two clients then settle
// instead of handing the same desk back and forth.
export interface Desk {
  view: 'panes' | 'window';
  panes?: string[];
  focused?: string;
  arrangement?: Layout;
  tree?: TileNode;
  weights?: Weights;
  minimised?: string[];
  order?: string[];
  window?: string;
  updated?: number;
  by?: string;
}

export const DESK_DEBOUNCE_MS = 500;

export function useDesk(enabled = true) {
  return useQuery({
    queryKey: keys.desk,
    queryFn: () => api<{ desk: Desk }>('/v1/desk', { conditional: true }).then((v) => v.desk),
    enabled,
    refetchInterval: 15_000,
    staleTime: 1_000,
  });
}

// What a desk says, without who and when: equal desks need no write.
export function deskBody(d: Desk): string {
  return JSON.stringify({
    view: d.view,
    panes: d.panes ?? [],
    focused: d.focused ?? '',
    arrangement: d.arrangement ?? '',
    tree: d.tree ?? null,
    weights: d.weights ?? {},
    minimised: d.minimised ?? [],
    order: d.order ?? [],
    window: d.window ?? '',
  });
}
export const sameDesk = (a: Desk | undefined, b: Desk | undefined) =>
  !!a && !!b && deskBody(a) === deskBody(b);

let known: Desk | undefined;
export function knownDesk(): Desk | undefined {
  return known;
}
export function noteDesk(d: Desk | undefined) {
  known = d;
}
export function forgetDesk() {
  known = undefined;
  pending = null;
}

let pending: Desk | null = null;
let timer: number | null = null;
async function flush() {
  const d = pending;
  pending = null;
  timer = null;
  if (!d || sameDesk(d, known)) return;
  known = d;
  try {
    const r = await api<{ desk: Desk }>('/v1/desk', { method: 'PUT', body: JSON.stringify(d) });
    known = r.desk;
    queryClient.setQueryData(keys.desk, r.desk);
  } catch {
    // A refused desk (a pane outside the grants, a hub without desks)
    // is simply not kept; the next change tries again.
    known = undefined;
  }
}

// writeDesk sends the view's desk after a moment of quiet; a desk the
// hub already has is not sent.
export function writeDesk(d: Desk) {
  if (sameDesk(d, known) && !pending) return;
  pending = d;
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => void flush(), DESK_DEBOUNCE_MS);
}

// The desk's focus is the view's on opening only; a running view keeps
// its own, so typing on the phone does not move the web's focus.
export function deskPanes(d: Desk | undefined): string[] {
  return d?.view === 'panes' && d.panes?.length ? d.panes : [];
}
