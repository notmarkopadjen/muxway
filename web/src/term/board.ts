// A board: the person's own arrangement of panes from anywhere, kept in
// this browser only. A tree of splits whose leaves are pane addresses;
// each split carries its children's shares, so moving panes around keeps
// the sizes the person set.

export type BoardNode =
  { kind: 'pane'; id: string } | { kind: 'h' | 'v'; children: BoardNode[]; shares: number[] };

export interface Board {
  layout: BoardNode | null;
  scale: Record<string, number>; // address -> font multiplier
  fit: Record<string, boolean>; // address -> fit on
  zoom?: string; // address shown alone
}

export const BOARD_NAME = /^[a-z0-9-]{1,32}$/;
export const ADDRESS = /^[A-Za-z0-9][A-Za-z0-9_-]*(\/[A-Za-z0-9._@-]+){2,3}$/;

export function emptyBoard(): Board {
  return { layout: null, scale: {}, fit: {} };
}

export function panesOf(n: BoardNode | null): string[] {
  if (!n) return [];
  return n.kind === 'pane' ? [n.id] : n.children.flatMap(panesOf);
}

const equal = (n: number) => Array(n).fill(1 / n) as number[];

function normalise(shares: number[]): number[] {
  const total = shares.reduce((a, b) => a + b, 0);
  return total > 0 ? shares.map((s) => s / total) : equal(shares.length);
}

// Puts a new pane beside (dir 'h') or below (dir 'v') the pane `at`; with
// no `at`, or one not on the board, beside the last pane. When the pane's
// own split already runs that way the newcomer joins it with an equal
// share; otherwise the pane becomes a split of the two.
export function addPane(b: Board, id: string, at: string | null, dir: 'h' | 'v'): Board {
  if (panesOf(b.layout).includes(id)) return b;
  if (!b.layout) return { ...b, layout: { kind: 'pane', id } };
  const all = panesOf(b.layout);
  const target = at && all.includes(at) ? at : all[all.length - 1];
  const insert = (n: BoardNode): BoardNode => {
    if (n.kind === 'pane') {
      if (n.id !== target) return n;
      return { kind: dir, children: [n, { kind: 'pane', id }], shares: equal(2) };
    }
    const i = n.children.findIndex((c) => c.kind === 'pane' && c.id === target);
    if (i >= 0 && n.kind === dir) {
      const children = [...n.children];
      children.splice(i + 1, 0, { kind: 'pane', id });
      const share = 1 / children.length;
      const shares = n.shares.map((s) => s * (1 - share));
      shares.splice(i + 1, 0, share);
      return { kind: n.kind, children, shares: normalise(shares) };
    }
    return { kind: n.kind, children: n.children.map(insert), shares: n.shares };
  };
  return { ...b, layout: insert(b.layout) };
}

// Takes a pane off the board; a split left with one child collapses.
export function removePane(b: Board, id: string): Board {
  const prune = (n: BoardNode): BoardNode | null => {
    if (n.kind === 'pane') return n.id === id ? null : n;
    const kept: BoardNode[] = [];
    const shares: number[] = [];
    n.children.forEach((c, i) => {
      const p = prune(c);
      if (p) {
        kept.push(p);
        shares.push(n.shares[i] ?? 1);
      }
    });
    if (kept.length === 0) return null;
    if (kept.length === 1) return kept[0];
    return { kind: n.kind, children: kept, shares: normalise(shares) };
  };
  const { [id]: _s, ...scale } = b.scale;
  const { [id]: _f, ...fit } = b.fit;
  void _s;
  void _f;
  return {
    layout: prune(b.layout ?? { kind: 'pane', id: '' }),
    scale,
    fit,
    zoom: b.zoom === id ? undefined : b.zoom,
  };
}

export function swapPanes(b: Board, a: string, c: string): Board {
  if (a === c) return b;
  const swap = (n: BoardNode): BoardNode =>
    n.kind === 'pane'
      ? n.id === a
        ? { kind: 'pane', id: c }
        : n.id === c
          ? { kind: 'pane', id: a }
          : n
      : { ...n, children: n.children.map(swap) };
  return b.layout ? { ...b, layout: swap(b.layout) } : b;
}

export function equalise(b: Board): Board {
  const eq = (n: BoardNode): BoardNode =>
    n.kind === 'pane'
      ? n
      : { kind: n.kind, children: n.children.map(eq), shares: equal(n.children.length) };
  return b.layout ? { ...b, layout: eq(b.layout) } : b;
}

// Moves `delta` of the whole between children k and k+1 of the split at
// `path` (indexes from the root), keeping each at least 5 %.
export function dragShare(b: Board, path: number[], k: number, delta: number): Board {
  const walk = (n: BoardNode, depth: number): BoardNode => {
    if (n.kind === 'pane') return n;
    if (depth === path.length) {
      const shares = [...n.shares];
      const move = Math.max(-shares[k] + 0.05, Math.min(shares[k + 1] - 0.05, delta));
      shares[k] += move;
      shares[k + 1] -= move;
      return { ...n, shares };
    }
    const i = path[depth];
    return { ...n, children: n.children.map((c, j) => (j === i ? walk(c, depth + 1) : c)) };
  };
  return b.layout ? { ...b, layout: walk(b.layout, 0) } : b;
}

// A stored board is data from this browser, still checked on the way in.
export function validate(raw: unknown): Board | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const node = (n: unknown, depth: number): BoardNode | null => {
    if (!n || typeof n !== 'object' || depth > 16) return null;
    const o = n as Record<string, unknown>;
    if (o.kind === 'pane') {
      return typeof o.id === 'string' && ADDRESS.test(o.id) && !o.id.includes('..')
        ? { kind: 'pane', id: o.id }
        : null;
    }
    if ((o.kind !== 'h' && o.kind !== 'v') || !Array.isArray(o.children)) return null;
    if (o.children.length < 2 || o.children.length > 32) return null;
    const children: BoardNode[] = [];
    for (const c of o.children) {
      const p = node(c, depth + 1);
      if (!p) return null;
      children.push(p);
    }
    const shares = Array.isArray(o.shares) ? (o.shares as unknown[]) : [];
    const ok =
      shares.length === children.length &&
      shares.every((s) => typeof s === 'number' && s > 0 && s <= 1);
    return {
      kind: o.kind,
      children,
      shares: ok ? normalise(shares as number[]) : equal(children.length),
    };
  };
  const layout = r.layout === null || r.layout === undefined ? null : node(r.layout, 0);
  if (r.layout && !layout) return null;
  const ids = new Set(panesOf(layout));
  if (ids.size !== panesOf(layout).length) return null;
  const scale: Record<string, number> = {};
  if (r.scale && typeof r.scale === 'object') {
    for (const [k, v] of Object.entries(r.scale as Record<string, unknown>))
      if (ids.has(k) && typeof v === 'number' && v >= 0.4 && v <= 3) scale[k] = v;
  }
  const fit: Record<string, boolean> = {};
  if (r.fit && typeof r.fit === 'object') {
    for (const [k, v] of Object.entries(r.fit as Record<string, unknown>))
      if (ids.has(k) && v === true) fit[k] = true;
  }
  const zoom = typeof r.zoom === 'string' && ids.has(r.zoom) ? r.zoom : undefined;
  return { layout, scale, fit, zoom };
}

const PREFIX = 'mx-board:';

export function loadBoard(name: string): Board {
  try {
    const raw = localStorage.getItem(PREFIX + name);
    if (raw) return validate(JSON.parse(raw)) ?? emptyBoard();
  } catch {
    /* ignore */
  }
  return emptyBoard();
}

export function saveBoard(name: string, b: Board) {
  try {
    localStorage.setItem(PREFIX + name, JSON.stringify(b));
  } catch {
    /* ignore */
  }
}

export function boardNames(): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? '';
      if (k.startsWith(PREFIX) && BOARD_NAME.test(k.slice(PREFIX.length)))
        out.push(k.slice(PREFIX.length));
    }
  } catch {
    /* ignore */
  }
  return out.sort();
}
