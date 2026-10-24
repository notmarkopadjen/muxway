import { ADDRESS } from './board';
import { checksum } from './layout';

// Tiles: one to four panes on one screen in the arrangements the Android
// client has. The arrangement is the browser's own and never reaches the
// host. Addresses travel in the route, comma separated.

export const MAX_TILES = 4;

export type Arrangement = 'row' | 'column' | 'grid' | 'main-left' | 'main-top';

// Two panes split one way or the other; three and four add a main pane
// and, for four, a grid.
export function options(n: number): Arrangement[] {
  if (n <= 2) return ['row', 'column'];
  if (n === 3) return ['row', 'column', 'main-left', 'main-top'];
  return ['row', 'column', 'grid', 'main-left', 'main-top'];
}

export function next(a: Arrangement, n: number): Arrangement {
  const all = options(n);
  return all[(all.indexOf(a) + 1) % all.length] ?? all[0];
}

export function defaultFor(wide: boolean): Arrangement {
  return wide ? 'row' : 'column';
}

// The tree of splits for an arrangement; leaves are tile indexes. Each
// split has a key its weights are kept under.
export type TileNode =
  number | { kind: 'h' | 'v'; key: 'main' | 'rest' | 'top'; children: TileNode[] };

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

export type Weights = Partial<Record<'main' | 'rest' | 'top', number[]>>;

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
