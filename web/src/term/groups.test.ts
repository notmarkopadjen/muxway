import { describe, expect, it } from 'vitest';
import type { Pane, TalkPartner } from '../api/types';
import { groupsOf, pullTogether, runs } from './groups';

function pane(address: string, talk?: [string, string][]): Pane {
  const partners: TalkPartner[] | undefined = talk?.map(([a, id]) => ({
    address: a,
    pane_id: id,
    at: 1,
    way: 'both',
  }));
  return { address, host: address.split('/')[0], pane_id: '%0', talk: partners } as Pane;
}

describe('groups', () => {
  const a = pane('h/work/0.0', [['h/work/0.1', '%1']]);
  const b = pane('h/work/0.1', [
    ['h/work/0.0', '%0'],
    ['h/work/0.2', '%2'],
  ]);
  const c = pane('h/work/0.2', [['h/work/0.1', '%1']]);
  const d = pane('h/work/1.0');
  const e = pane('h/work/1.1', [['h/work/1.2', '%5']]);
  const f = pane('h/work/1.2', [['h/work/1.1', '%4']]);

  it('joins partners of partners into one group and keeps threads apart', () => {
    const g = groupsOf([a, d, b, e, c, f]);
    expect(g.get(a.address)).toBe(1);
    expect(g.get(b.address)).toBe(1);
    expect(g.get(c.address)).toBe(1);
    expect(g.get(d.address)).toBeUndefined();
    expect(g.get(e.address)).toBe(2);
    expect(g.get(f.address)).toBe(2);
  });

  it('forms no group for a pane whose partner is not listed', () => {
    const lonely = pane('h/work/2.0', [['h/work/9.9', '%9']]);
    expect(groupsOf([lonely, d]).size).toBe(0);
  });

  it('names a peer hub partner as the page does', () => {
    const p = { ...pane('hub~h/work/0.0', [['h/work/0.1', '%1']]), hub: 'hub' };
    const q = { ...pane('hub~h/work/0.1', [['h/work/0.0', '%0']]), hub: 'hub' };
    expect(groupsOf([p, q]).get(q.address)).toBe(1);
  });

  it('pulls a group together after its first member, leaving the rest in place', () => {
    const rows = [a, d, e, b, f, c];
    const g = groupsOf(rows);
    expect(pullTogether(rows, g).map((r) => r.address)).toEqual([
      a.address,
      b.address,
      c.address,
      d.address,
      e.address,
      f.address,
    ]);
    // A loose tab is left where the owner put it.
    expect(pullTogether(rows, g, new Set([c.address])).map((r) => r.address)).toEqual([
      a.address,
      b.address,
      d.address,
      e.address,
      f.address,
      c.address,
    ]);
  });

  it('cuts rows into framed runs', () => {
    const rows = [a, b, c, d, e, f];
    const g = groupsOf(rows);
    expect(runs(rows, g).map((r) => [r.group, r.rows.length])).toEqual([
      [1, 3],
      [undefined, 1],
      [2, 2],
    ]);
    // Two frames for one group torn apart by a loose tab.
    expect(runs([a, d, b], g).map((r) => [r.group, r.rows.length])).toEqual([
      [1, 1],
      [undefined, 1],
      [1, 1],
    ]);
  });
});
