import type { Host, Me, Pane } from '../api/types';
import { mayWriteOn } from './grants';
import { MAX_TILES } from './tiles';

// The add menu's rows, from the listing the view holds: + pane and
// + session for the focused pane's host, the minimised panes, then every
// other readable pane grouped by host and session in listing order. The
// focused pane and the open tiles are left out. Nothing is asked.

export type Entry = { on: true } | { on: false; why: string };

export interface Group {
  key: string;
  host: string;
  session: string;
  panes: Pane[];
}

export interface AddRows {
  pane: Entry;
  session: Entry;
  minimised: Pane[];
  groups: Group[];
  // Four tiles open: a pick swaps into the focused tile.
  full: boolean;
}

export function addRows(input: {
  panes: Pane[];
  hosts: Host[];
  me: Me | undefined;
  open: string[];
  minimised: string[];
  focused: Pane | undefined;
}): AddRows {
  const { panes, hosts, me, open, minimised, focused } = input;
  const host = focused && hosts.find((h) => h.name === focused.host);
  const pane: Entry = focused?.mode === 'write' ? { on: true } : { on: false, why: 'read only' };
  const session: Entry =
    host?.sessions && mayWriteOn(me?.write ?? [], host.name)
      ? { on: true }
      : { on: false, why: 'no sessions here' };
  const byAddress = new Map(panes.map((p) => [p.address, p]));
  const groups: Group[] = [];
  for (const p of panes) {
    if (open.includes(p.address) || minimised.includes(p.address)) continue;
    const key = `${p.host}/${p.session}`;
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, host: p.host, session: p.session, panes: [] };
      groups.push(g);
    }
    g.panes.push(p);
  }
  return {
    pane,
    session,
    minimised: minimised.map((a) => byAddress.get(a)).filter((p): p is Pane => !!p),
    groups,
    full: open.length >= MAX_TILES,
  };
}
