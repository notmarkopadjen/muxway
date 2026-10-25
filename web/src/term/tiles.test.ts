import { describe, expect, it } from 'vitest';
import {
  close,
  dropOn,
  prune,
  zoneAt,
  drag,
  next,
  options,
  parseRoute,
  replace,
  routeFor,
  swap,
  tilesLayout,
  tree,
} from './tiles';

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

describe('tilesLayout', () => {
  it('writes the arrangement as a tmux layout of the panes, in the weights', () => {
    const ids = ['%3', '%4', '%5'];
    expect(tilesLayout(tree(2, 'row'), {}, ids)).toMatch(
      /^[0-9a-f]{4},1000x1000,0,0\{500x1000,0,0,3,500x1000,0,0,4\}$/,
    );
    expect(tilesLayout(tree(2, 'column'), { main: [0.25, 0.75] }, ids)).toMatch(
      /^[0-9a-f]{4},1000x1000,0,0\[1000x250,0,0,3,1000x750,0,0,4\]$/,
    );
    expect(tilesLayout(tree(3, 'main-left'), {}, ids)).toMatch(
      /^[0-9a-f]{4},1000x1000,0,0\{500x1000,0,0,3,500x1000,0,0\[500x500,0,0,4,500x500,0,0,5\]\}$/,
    );
  });
});

describe('dropping a header on a tile', () => {
  const row = tree(3, 'row');
  it('knows the middle from the edges', () => {
    expect(zoneAt(0.5, 0.5)).toBe('swap');
    expect(zoneAt(0.5, 0.9)).toBe('bottom');
    expect(zoneAt(0.5, 0.05)).toBe('top');
    expect(zoneAt(0.1, 0.5)).toBe('left');
    expect(zoneAt(0.95, 0.6)).toBe('right');
  });
  it('splits the target down, the dragged pane below, and closes its old place', () => {
    expect(dropOn(row, 2, 0, 'bottom')).toEqual({
      kind: 'h',
      key: 'r',
      children: [{ kind: 'v', key: 'r.0', children: [0, 2] }, 1],
    });
    expect(dropOn(row, 2, 0, 'top')).toEqual({
      kind: 'h',
      key: 'r',
      children: [{ kind: 'v', key: 'r.0', children: [2, 0] }, 1],
    });
  });
  it('splits across, and a split left with one child gives way', () => {
    const t = dropOn(row, 2, 0, 'bottom');
    expect(dropOn(t, 2, 1, 'right')).toEqual({ kind: 'h', key: 'r', children: [0, 1, 2] });
  });
  it('prunes a closed tile and renumbers the rest', () => {
    const t = dropOn(row, 2, 0, 'bottom');
    expect(prune(t, 0)).toEqual({ kind: 'h', key: 'r', children: [1, 0] });
  });
  it('lays out a made tree for the window as well', () => {
    const t = dropOn(tree(2, 'row'), 1, 0, 'bottom');
    expect(tilesLayout(t, {}, ['%1', '%2'])).toMatch(
      /1000x1000,0,0\[1000x500,0,0,1,1000x500,0,0,2\]$/,
    );
  });
});
