import type { SizedBy } from '../api/types';

// Who holds a pane's window, as a tile reads it from the listing's
// sized_by against this client's own token (mine) and label. Another
// principal's fit, or the same principal from another client (two phones
// on one token), is another's: the header names it and an interaction
// here sends this client's fit again. Nobody (never fitted, released, an
// older agent) or this very client: the header says held alone, and
// nothing is sent.
export type Holder =
  { kind: 'none' } | { kind: 'self' } | { kind: 'other'; token: string; client: string };

export function holderOf(sized: SizedBy | undefined, label: string): Holder {
  if (!sized) return { kind: 'none' };
  if (sized.mine && sized.client === label) return { kind: 'self' };
  return { kind: 'other', token: sized.token, client: sized.client };
}

// The header's words for a size the host kept against this tile's ask.
export function heldWords(h: Holder): string {
  if (h.kind !== 'other') return 'held';
  return h.client ? `held by ${h.token} · ${h.client}` : `held by ${h.token}`;
}

export const REFIT_GAP_MS = 2000;

// Whether an interaction with the pane sends this client's fit again:
// only while another holds the window, and two seconds after the last.
export function refitOnTouch(h: Holder, lastAt: number, now: number): boolean {
  return h.kind === 'other' && now - lastAt >= REFIT_GAP_MS;
}
