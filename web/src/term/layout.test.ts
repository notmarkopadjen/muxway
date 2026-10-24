import { describe, expect, it } from 'vitest';
import { checksum, fractions, layoutFor, leaves, parseLayout, sameShape } from './layout';

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

describe('layoutFor', () => {
  it('writes the host tree with the browser fractions and a checksum tmux accepts', () => {
    const n = parseLayout('b25d,100x30,0,0[100x15,0,0,1,100x14,0,16,2]');
    const s = layoutFor(n, { layout: '', fractions: { '0': [0.75, 0.25] }, hidden: [], scale: {} });
    expect(s).toMatch(/^[0-9a-f]{4},1000x1000,0,0\[1000x750,0,0,1,1000x250,0,0,2\]$/);
    // The checksum is tmux's own: these are strings tmux wrote.
    expect(checksum('100x30,0,0,0')).toBe('a87d');
    expect(checksum('200x50,0,0{100x50,0,0[100x25,0,0,1,100x24,0,26,3],99x50,101,0,2}')).toBe(
      'dddb',
    );
  });
  it('tells a change of sizes from a change of shape', () => {
    const a = parseLayout('b25d,100x30,0,0[100x15,0,0,1,100x14,0,16,2]');
    const b = parseLayout('b25d,100x40,0,0[100x30,0,0,1,100x9,0,31,2]');
    const c = parseLayout('b25d,100x40,0,0{50x40,0,0,1,49x40,51,0,2}');
    const d = parseLayout('b25d,100x40,0,0[100x30,0,0,1,100x9,0,31,3]');
    expect(sameShape(a, b)).toBe(true);
    expect(sameShape(a, c)).toBe(false);
    expect(sameShape(a, d)).toBe(false);
  });
});
