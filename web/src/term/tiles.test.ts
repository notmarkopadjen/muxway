import { describe, expect, it } from 'vitest';
import { close, drag, next, options, parseRoute, replace, routeFor, swap, tree } from './tiles';

const A = 'alice-laptop/work/0.0';
const B = 'alice-laptop/work/0.1';
const C = 'bob-desktop/work/0.0';

describe('tiles', () => {
  it('offers the arrangements that make sense for the count and cycles them', () => {
    expect(options(1)).toEqual(['row', 'column']);
    expect(options(3)).toEqual(['row', 'column', 'main-left', 'main-top']);
    expect(options(4)).toContain('grid');
    expect(next('row', 2)).toBe('column');
    expect(next('column', 2)).toBe('row');
    expect(next('main-top', 3)).toBe('row');
    expect(next('grid', 2)).toBe('row');
  });

  it('builds the trees', () => {
    expect(tree(1, 'grid')).toBe(0);
    expect(tree(3, 'main-left')).toEqual({
      kind: 'h',
      key: 'main',
      children: [0, { kind: 'v', key: 'rest', children: [1, 2] }],
    });
    expect(tree(4, 'grid')).toEqual({
      kind: 'v',
      key: 'main',
      children: [
        { kind: 'h', key: 'top', children: [0, 1] },
        { kind: 'h', key: 'rest', children: [2, 3] },
      ],
    });
  });

  it('drags a split and stops at the floor', () => {
    expect(drag([0.5, 0.5], 0, 0.1)).toEqual([0.6, 0.4]);
    const [a, b] = drag([0.5, 0.5], 0, 0.9);
    expect(b).toBeCloseTo(0.15);
    expect(a).toBeCloseTo(0.85);
    expect(drag([0.5, 0.5], 1, 0.1)).toEqual([0.5, 0.5]);
  });

  it('swaps, replaces and closes', () => {
    expect(swap([A, B, C], A, C)).toEqual([C, B, A]);
    expect(swap([A, B], A, C)).toEqual([A, B]);
    expect(replace([A, B], 1, C)).toEqual([A, C]);
    expect(replace([A, B], 1, A)).toEqual([A, B]);
    expect(close([A, B], A)).toEqual([B]);
    expect(close([A], A)).toEqual([A]);
  });

  it('reads the route and refuses what is not a pane', () => {
    expect(parseRoute(routeFor([A, B]))).toEqual({ addresses: [A, B] });
    expect(parseRoute('')).toHaveProperty('error');
    expect(parseRoute([A, B, C, A].join(','))).toHaveProperty('error');
    expect(parseRoute([A, B, C, 'c/d/1.0', 'e/f/1.0'].join(','))).toHaveProperty('error');
    expect(parseRoute('../etc/passwd')).toHaveProperty('error');
    expect(parseRoute('<img src=x>/a/1.0')).toHaveProperty('error');
  });
});
