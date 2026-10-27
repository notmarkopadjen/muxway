import { describe, expect, it } from 'vitest';
import {
  across,
  close,
  fromHost,
  rects,
  nearWeights,
  sameTree,
  dropOn,
  prune,
  zoneAt,
  type TileNode,
  drag,
  next,
  options,
  parseRoute,
  replace,
  routeFor,
  swap,
  bottomLeaves,
  exactLayout,
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

describe('exactLayout', () => {
  const ids = ['%3', '%4', '%5'];
  it('gives each pane the cells its tile holds, a split the sum along it and the least across', () => {
    const r = exactLayout(
      tree(3, 'main-left'),
      [
        { cols: 60, rows: 40 },
        { cols: 60, rows: 19 },
        { cols: 60, rows: 19 },
      ],
      ids,
    );
    expect(r.cols).toBe(121);
    expect(r.rows).toBe(39);
    expect(r.layout).toMatch(
      /^[0-9a-f]{4},121x39,0,0\{60x39,0,0,3,60x39,0,0\[60x19,0,0,4,60x19,0,0,5\]\}$/,
    );
    expect(
      exactLayout(
        tree(2, 'column'),
        [
          { cols: 80, rows: 24 },
          { cols: 70, rows: 20 },
        ],
        ids,
      ).layout,
    ).toMatch(/^[0-9a-f]{4},70x45,0,0\[70x24,0,0,3,70x20,0,0,4\]$/);
  });
  it('scales a stack down to the tile across from it, never up', () => {
    const r = exactLayout(
      tree(3, 'main-left'),
      [
        { cols: 60, rows: 30 },
        { cols: 60, rows: 20 },
        { cols: 60, rows: 20 },
      ],
      ids,
    );
    expect(r.rows).toBe(30);
    expect(r.layout).toMatch(/\[60x15,0,0,4,60x14,0,0,5\]\}$/);
  });
  it('takes a host split within a cell of even as even', () => {
    const h = fromHost('c1a2,100x30,0,0{50x30,0,0,3,49x30,51,0[49x15,51,0,4,49x14,51,16,5]}', ids);
    expect(h?.weights).toEqual({ r: [0.5, 0.5], 'r.1': [0.5, 0.5] });
    const u = fromHost('4e55,100x30,0,0{70x30,0,0,3,29x30,71,0,4}', ids.slice(0, 2));
    expect(u?.weights.r).toEqual([70 / 99, 29 / 99]);
  });
  it('names the tiles along the bottom', () => {
    expect(bottomLeaves(tree(3, 'main-left'))).toEqual([0, 2]);
    expect(bottomLeaves(tree(3, 'main-top'))).toEqual([1, 2]);
    expect(bottomLeaves(tree(2, 'row'))).toEqual([0, 1]);
    expect(bottomLeaves(tree(2, 'column'))).toEqual([1]);
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

describe('fromHost', () => {
  // .1 over .2 on the left, .0 down the right: tiles open as .0, .1, .2.
  const layout = 'abcd,197x41,0,0{98x41,0,0[98x20,0,0,25,98x20,0,21,26],98x41,99,0,14}';
  it('builds the tiles tree from the host, panes by id', () => {
    const h = fromHost(layout, ['%14', '%25', '%26'])!;
    expect(h.node).toEqual({
      kind: 'h',
      key: 'r',
      children: [{ kind: 'v', key: 'r.0', children: [1, 2] }, 0],
    });
    expect(h.weights.r).toEqual([0.5, 0.5]);
  });
  it('is null for a layout naming a pane not open', () => {
    expect(fromHost(layout, ['%14', '%25'])).toBeNull();
    expect(fromHost('junk', ['%14'])).toBeNull();
  });
  it('round-trips through tilesLayout with the ids where the tiles are', () => {
    const ids = ['%14', '%25', '%26'];
    const h = fromHost(layout, ids)!;
    const back = fromHost(tilesLayout(h.node, h.weights, ids), ids)!;
    expect(sameTree(back.node, h.node)).toBe(true);
    expect(nearWeights(h.node, back.weights, h.weights, 0.01)).toBe(true);
  });
  it('tells a moved tile from new shares', () => {
    const h = fromHost(layout, ['%14', '%25', '%26'])!;
    const swapped = fromHost(layout, ['%25', '%14', '%26'])!;
    expect(sameTree(h.node, swapped.node)).toBe(false);
    expect(nearWeights(h.node, h.weights, { r: [0.6, 0.4] }, 0.03)).toBe(false);
  });
});

describe('across', () => {
  // .1 over .2 on the left, .0 down the right.
  const t: TileNode = {
    kind: 'h',
    key: 'r',
    children: [{ kind: 'v', key: 'r.0', children: [1, 2] }, 0],
  };
  it('lays a tile across the whole view, at the bottom or the top', () => {
    expect(across(t, 2, 'r', 'v', false)).toEqual({
      kind: 'v',
      key: 'r',
      children: [{ kind: 'h', key: 'r.0', children: [1, 0] }, 2],
    });
    expect(across(t, 0, 'r', 'v', true)).toEqual({ kind: 'v', key: 'r', children: [0, 1, 2] });
  });
  it('lays a tile across an inner split only', () => {
    expect(across(t, 1, 'r.0', 'h', false)).toEqual({ kind: 'h', key: 'r', children: [2, 1, 0] });
  });
  it('leaves the tree as it is for a key not in it', () => {
    expect(across(t, 0, 'nope', 'v', true)).toBe(t);
  });
});

describe('rects', () => {
  it('places each tile in fractions of the area', () => {
    const t: TileNode = {
      kind: 'h',
      key: 'r',
      children: [{ kind: 'v', key: 'r.0', children: [1, 2] }, 0],
    };
    const r = rects(t, { r: [0.6, 0.4] });
    expect(r.get(0)).toEqual({ x: 0.6, y: 0, w: 0.4, h: 1 });
    expect(r.get(2)).toEqual({ x: 0, y: 0.5, w: 0.6, h: 0.5 });
  });
});
