import type { Pane } from '../api/types';
import { joinAddress, splitAddress } from '../hubs';

// Groups: panes that talked to each other in the last ten minutes, the
// partners of partners too, from the listing's `talk` alone. A group is
// numbered by its first member in the panes' order, so numbers are
// stable while the order is.

export type Groups = Map<string, number>;

export function groupsOf(panes: Pane[]): Groups {
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    let r = a;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const p of panes)
    for (const tp of p.talk ?? [])
      union(p.address, joinAddress(splitAddress(p.address).hub, tp.address));
  const groups: Groups = new Map();
  const numbers = new Map<string, number>();
  for (const p of panes) {
    if (!parent.has(p.address)) continue;
    const root = find(p.address);
    // A pane whose partners are all out of the listing forms no group.
    const members = panes.filter((q) => parent.has(q.address) && find(q.address) === root);
    if (members.length < 2) continue;
    let n = numbers.get(root);
    if (n === undefined) {
      n = numbers.size + 1;
      numbers.set(root, n);
    }
    groups.set(p.address, n);
  }
  return groups;
}

// pullTogether puts the members of a group side by side, after the
// group's first member in the rows' order; everything else keeps its
// place. A loose address (one the owner dragged away) is left alone.
export function pullTogether<T extends { address: string }>(
  rows: T[],
  groups: Groups,
  loose: Set<string> = new Set(),
): T[] {
  const out: T[] = [];
  const done = new Set<string>();
  for (const r of rows) {
    if (done.has(r.address)) continue;
    out.push(r);
    done.add(r.address);
    const g = groups.get(r.address);
    if (g === undefined || loose.has(r.address)) continue;
    for (const s of rows)
      if (!done.has(s.address) && groups.get(s.address) === g && !loose.has(s.address)) {
        out.push(s);
        done.add(s.address);
      }
  }
  return out;
}

// runs cuts the rows into stretches that share a group, for one frame
// per stretch; rows outside any group are stretches of their own.
export function runs<T extends { address: string }>(
  rows: T[],
  groups: Groups,
): { group?: number; rows: T[] }[] {
  const out: { group?: number; rows: T[] }[] = [];
  for (const r of rows) {
    const g = groups.get(r.address);
    const last = out[out.length - 1];
    if (last && g !== undefined && last.group === g) last.rows.push(r);
    else out.push({ group: g, rows: [r] });
  }
  return out;
}
