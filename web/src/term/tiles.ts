import { checksum, fractions, parseLayout, type Node } from './layout';

// Tiles: one to four panes on one screen in the arrangements the Android
// client has. The arrangement is the browser's own and never reaches the
// host. Addresses travel in the route, comma separated.

export const MAX_TILES = 4;

export const ADDRESS = /^[A-Za-z0-9][A-Za-z0-9_-]*(\/[A-Za-z0-9._@-]+){2,3}$/;

// What a board kept in this browser held, for a bookmark of one: its
// panes, up to four, as tiles. The board itself is gone with this read.
export function boardPanes(name: string): string[] {
  const key = `mx-board:${name}`;
  let out: string[] = [];
  try {
    const walk = (n: unknown): string[] => {
      if (!n || typeof n !== 'object') return [];
      const o = n as { id?: unknown; children?: unknown };
      if (typeof o.id === 'string') return [o.id];
      return Array.isArray(o.children) ? o.children.flatMap(walk) : [];
    };
    const raw = localStorage.getItem(key);
    const ids = raw ? walk((JSON.parse(raw) as { layout?: unknown }).layout) : [];
    out = [...new Set(ids)].filter((a) => ADDRESS.test(a) && !a.includes('..')).slice(0, MAX_TILES);
    localStorage.removeItem(key);
  } catch {
    /* storage off */
  }
  return out;
}

export type Arrangement = 'row' | 'column' | 'grid' | 'main-left' | 'main-top';
// What the tiles are laid out by: a preset, or a tree the person made by
// dropping a header onto a tile's edge.
export type Layout = Arrangement | 'custom';

// Two panes split one way or the other; three and four add a main pane
// and, for four, a grid.
export function options(n: number): Arrangement[] {
  if (n <= 2) return ['row', 'column'];
  if (n === 3) return ['row', 'column', 'main-left', 'main-top'];
  return ['row', 'column', 'grid', 'main-left', 'main-top'];
}

export function next(a: Layout, n: number): Arrangement {
  const all = options(n);
  if (a === 'custom') return all[0];
  return all[(all.indexOf(a) + 1) % all.length] ?? all[0];
}

export function defaultFor(wide: boolean): Arrangement {
  return wide ? 'row' : 'column';
}

// The tree of splits for an arrangement; leaves are tile indexes. Each
// split has a key its weights are kept under.
export type TileNode = number | { kind: 'h' | 'v'; key: string; children: TileNode[] };

export function tree(n: number, a: Arrangement): TileNode {
  const all = Array.from({ length: n }, (_, i) => i);
  if (n === 1) return 0;
  switch (a) {
    case 'row':
      return { kind: 'h', key: 'main', children: all };
    case 'column':
      return { kind: 'v', key: 'main', children: all };
    case 'main-left':
      return {
        kind: 'h',
        key: 'main',
        children: [0, { kind: 'v', key: 'rest', children: all.slice(1) }],
      };
    case 'main-top':
      return {
        kind: 'v',
        key: 'main',
        children: [0, { kind: 'h', key: 'rest', children: all.slice(1) }],
      };
    case 'grid': {
      const half = Math.ceil(n / 2);
      return {
        kind: 'v',
        key: 'main',
        children: [
          { kind: 'h', key: 'top', children: all.slice(0, half) },
          { kind: 'h', key: 'rest', children: all.slice(half) },
        ],
      };
    }
  }
}

export type Weights = Record<string, number[]>;

export type Zone = 'swap' | 'top' | 'bottom' | 'left' | 'right';

// Where on a tile a dragged header lands: its middle swaps the two, a part
// near an edge splits the tile's place that way.
export function zoneAt(x: number, y: number): Zone {
  if (x > 1 / 3 && x < 2 / 3 && y > 1 / 3 && y < 2 / 3) return 'swap';
  const edges: [Zone, number][] = [
    ['top', y],
    ['bottom', 1 - y],
    ['left', x],
    ['right', 1 - x],
  ];
  return edges.reduce((a, b) => (b[1] < a[1] ? b : a))[0];
}

// Keys by place in the tree, so a made tree's weights have names.
function relabel(node: TileNode, key = 'r'): TileNode {
  if (typeof node === 'number') return node;
  return { ...node, key, children: node.children.map((c, i) => relabel(c, `${key}.${i}`)) };
}

// Takes leaf `at` out; a split left with one child gives way to it, and one
// that runs the same way as its parent joins it.
function without(node: TileNode, at: number): TileNode | null {
  if (typeof node === 'number') return node === at ? null : node;
  const kept = node.children.map((c) => without(c, at)).filter((c): c is TileNode => c !== null);
  if (!kept.length) return null;
  if (kept.length === 1) return kept[0];
  const flat = kept.flatMap((c) =>
    typeof c !== 'number' && c.kind === node.kind ? c.children : [c],
  );
  return { ...node, children: flat };
}

// Drops tile `from` onto an edge of tile `to`: `to`'s place splits, the
// dragged tile on the side of that edge; its old place closes up.
export function dropOn(
  node: TileNode,
  from: number,
  to: number,
  zone: Exclude<Zone, 'swap'>,
): TileNode {
  if (from === to) return node;
  const rest = without(node, from) ?? to;
  const kind = zone === 'top' || zone === 'bottom' ? 'v' : 'h';
  const first = zone === 'top' || zone === 'left';
  const put = (n: TileNode): TileNode => {
    if (typeof n === 'number')
      return n === to ? { kind, key: '', children: first ? [from, to] : [to, from] } : n;
    return { ...n, children: n.children.map(put) };
  };
  return relabel(flatten(put(rest)));
}

// A split inside one that runs the same way joins it.
function flatten(node: TileNode): TileNode {
  if (typeof node === 'number') return node;
  const children = node.children
    .map(flatten)
    .flatMap((c) => (typeof c !== 'number' && c.kind === node.kind ? c.children : [c]));
  return { ...node, children };
}

// Takes tile `at` out of a tree for good: the tiles after it move up one.
export function prune(node: TileNode, at: number): TileNode {
  const shift = (n: TileNode): TileNode =>
    typeof n === 'number' ? (n > at ? n - 1 : n) : { ...n, children: n.children.map(shift) };
  return relabel(shift(without(node, at) ?? 0));
}

export const FLOOR = 0.15;

export function equal(n: number): number[] {
  return Array(n).fill(1 / n) as number[];
}

// Moves `delta` of the whole between children k and k+1, keeping each at
// least the floor.
export function drag(weights: number[], k: number, delta: number): number[] {
  const w = [...weights];
  if (k < 0 || k + 1 >= w.length) return w;
  const move = Math.max(-(w[k] - FLOOR), Math.min(w[k + 1] - FLOOR, delta));
  w[k] += move;
  w[k + 1] -= move;
  return w;
}

export function swap(addresses: string[], a: string, b: string): string[] {
  const i = addresses.indexOf(a);
  const j = addresses.indexOf(b);
  if (i < 0 || j < 0 || i === j) return addresses;
  const out = [...addresses];
  out[i] = b;
  out[j] = a;
  return out;
}

export function replace(addresses: string[], at: number, address: string): string[] {
  if (addresses.includes(address)) return addresses;
  return addresses.map((a, i) => (i === at ? address : a));
}

export function close(addresses: string[], address: string): string[] {
  if (addresses.length <= 1) return addresses;
  return addresses.filter((a) => a !== address);
}

// The route's splat: addresses joined with commas, each well formed, at
// most four, none twice.
export function parseRoute(splat: string): { addresses: string[] } | { error: string } {
  const parts = splat.split(',').filter(Boolean);
  if (!parts.length) return { error: 'no pane named' };
  if (parts.length > MAX_TILES) return { error: `up to ${MAX_TILES} panes side by side` };
  for (const p of parts)
    if (!ADDRESS.test(p) || p.includes('..')) return { error: 'not a pane address' };
  if (new Set(parts).size !== parts.length) return { error: 'a pane named twice' };
  return { addresses: parts };
}

export function routeFor(addresses: string[]): string {
  return addresses.join(',');
}

// The tiles' arrangement as a tmux layout for their window, when the open
// tiles are all of its panes: each split hands its children a thousand
// units in the weights' proportions, and the host scales it to the window.
export function tilesLayout(node: TileNode, weights: Weights, ids: string[]): string {
  const cell = (n: TileNode, w: number, h: number): string => {
    if (typeof n === 'number') return `${w}x${h},0,0,${ids[n].replace(/^%/, '')}`;
    const f = weights[n.key] ?? equal(n.children.length);
    const parts = n.children.map((c, i) => {
      const size = Math.max(1, Math.round(f[i] * 1000));
      return n.kind === 'h' ? cell(c, size, h) : cell(c, w, size);
    });
    return `${w}x${h},0,0${n.kind === 'h' ? '{' : '['}${parts.join(',')}${n.kind === 'h' ? '}' : ']'}`;
  };
  const body = cell(node, 1000, 1000);
  return `${checksum(body)},${body}`;
}

// The host's layout of a window as the tiles' tree, when the tiles are
// its panes: `ids` are the tiles' pane ids. Null when it names another pane.
export function fromHost(
  layout: string,
  ids: string[],
): { node: TileNode; weights: Weights } | null {
  let root: Node;
  try {
    root = parseLayout(layout);
  } catch {
    return null;
  }
  const weights: Weights = {};
  const walk = (n: Node, key: string): TileNode | null => {
    if (n.kind === 'pane') {
      const at = ids.indexOf(n.id);
      return at < 0 ? null : at;
    }
    const children = n.children.map((c, i) => walk(c, `${key}.${i}`));
    if (children.some((c) => c === null)) return null;
    weights[key] = fractions(n);
    return { kind: n.kind, key, children: children as TileNode[] };
  };
  const node = walk(root, 'r');
  return node === null ? null : { node, weights };
}

// Same splits with the same tiles in the same places, shares aside.
export function sameTree(a: TileNode, b: TileNode): boolean {
  if (typeof a === 'number' || typeof b === 'number') return a === b;
  return (
    a.kind === b.kind &&
    a.children.length === b.children.length &&
    a.children.every((c, i) => sameTree(c, b.children[i]))
  );
}

// Whether every split of `node` has shares within `by` of the other's.
export function nearWeights(node: TileNode, a: Weights, b: Weights, by: number): boolean {
  if (typeof node === 'number') return true;
  const n = node.children.length;
  const wa = a[node.key] ?? equal(n);
  const wb = b[node.key] ?? equal(n);
  return (
    wa.every((w, i) => Math.abs(w - (wb[i] ?? 0)) <= by) &&
    node.children.every((c) => nearWeights(c, a, b, by))
  );
}
