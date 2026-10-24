import { describe, expect, it } from 'vitest';
import { fractions, leaves, parseLayout } from './layout';

describe('layout', () => {
  it('parses a single pane', () => {
    const n = parseLayout('b25d,100x30,0,0,1');
    expect(n).toEqual({ kind: 'pane', id: '%1', w: 100, h: 30, x: 0, y: 0 });
  });
  it('parses side by side and stacked splits', () => {
    const n = parseLayout('c1a2,100x30,0,0{50x30,0,0,3,49x30,51,0[49x15,51,0,4,49x14,51,16,5]}');
    expect(n.kind).toBe('h');
    if (n.kind !== 'h') return;
    expect(n.children).toHaveLength(2);
    expect(fractions(n)).toEqual([50 / 99, 49 / 99]);
    const right = n.children[1];
    expect(right.kind).toBe('v');
    expect(leaves(n).map((l) => l.id)).toEqual(['%3', '%4', '%5']);
  });
  it('refuses malformed strings', () => {
    for (const bad of [
      '',
      'abcd',
      'abcd,100x30',
      'abcd,100x30,0,0',
      'abcd,100x30,0,0{50x30,0,0,3',
      'abcd,100x30,0,0,1,junk',
    ])
      expect(() => parseLayout(bad)).toThrow();
  });
});
