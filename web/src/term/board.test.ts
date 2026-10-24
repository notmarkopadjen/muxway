import { describe, expect, it } from 'vitest';
import {
  addPane,
  dragShare,
  emptyBoard,
  equalise,
  panesOf,
  removePane,
  swapPanes,
  validate,
  type Board,
} from './board';

const shares = (b: Board | null) => (b?.layout && b.layout.kind !== 'pane' ? b.layout.shares : []);
const A = 'alice-laptop/work/0.0';
const B = 'alice-laptop/work/0.1';
const C = 'bob-desktop/work/0.0';

describe('board', () => {
  it('adds beside and below, joining a split that runs the same way', () => {
    let b: Board = addPane(emptyBoard(), A, null, 'h');
    expect(b.layout).toEqual({ kind: 'pane', id: A });
    b = addPane(b, B, A, 'h');
    expect(b.layout).toEqual({
      kind: 'h',
      children: [
        { kind: 'pane', id: A },
        { kind: 'pane', id: B },
      ],
      shares: [0.5, 0.5],
    });
    b = addPane(b, C, A, 'h');
    expect(panesOf(b.layout)).toEqual([A, C, B]);
    expect(b.layout?.kind).toBe('h');
    if (b.layout?.kind === 'h') {
      expect(b.layout.children).toHaveLength(3);
      expect(b.layout.shares.reduce((x, y) => x + y)).toBeCloseTo(1);
    }
    const below = addPane(b, 'bob-desktop/work/0.1', B, 'v');
    const right = below.layout?.kind === 'h' ? below.layout.children[2] : null;
    expect(right?.kind).toBe('v');
    expect(panesOf(below.layout)).toEqual([A, C, B, 'bob-desktop/work/0.1']);
    expect(addPane(below, A, null, 'h')).toBe(below);
  });
  it('removes and collapses, swaps and equalises', () => {
    let b = addPane(addPane(addPane(emptyBoard(), A, null, 'h'), B, A, 'h'), C, B, 'v');
    b = { ...b, scale: { [C]: 2 }, fit: { [C]: true }, zoom: C };
    const without = removePane(b, C);
    expect(panesOf(without.layout)).toEqual([A, B]);
    expect(without.layout?.kind).toBe('h');
    expect(without.scale).toEqual({});
    expect(without.fit).toEqual({});
    expect(without.zoom).toBeUndefined();
    expect(removePane(removePane(without, A), B).layout).toBeNull();
    expect(panesOf(swapPanes(b, A, C).layout)).toEqual([C, B, A]);
    const dragged = dragShare(b, [], 0, 0.2);
    expect(shares(dragged)).toEqual([0.7, 0.3]);
    const far = shares(dragShare(b, [], 0, 0.9));
    expect(far[0]).toBeCloseTo(0.95);
    expect(far[1]).toBeCloseTo(0.05);
    expect(shares(equalise(dragged))).toEqual([0.5, 0.5]);
  });
  it('validates what the browser stored', () => {
    const good = addPane(addPane(emptyBoard(), A, null, 'h'), B, A, 'v');
    expect(validate(JSON.parse(JSON.stringify(good)))).toEqual(good);
    expect(validate(null)).toBeNull();
    expect(validate({ layout: { kind: 'pane', id: '../x' } })).toBeNull();
    expect(validate({ layout: { kind: 'h', children: [{ kind: 'pane', id: A }] } })).toBeNull();
    expect(
      validate({
        layout: {
          kind: 'h',
          children: [
            { kind: 'pane', id: A },
            { kind: 'pane', id: A },
          ],
        },
      }),
    ).toBeNull();
    const fixed = validate({
      layout: {
        kind: 'v',
        children: [
          { kind: 'pane', id: A },
          { kind: 'pane', id: B },
        ],
        shares: [5, 'x'],
      },
      scale: { [A]: 9, [B]: 1.5, [C]: 1 },
      fit: { [A]: 'yes', [B]: true },
      zoom: C,
    });
    expect(shares(fixed)).toEqual([0.5, 0.5]);
    expect(fixed?.scale).toEqual({ [B]: 1.5 });
    expect(fixed?.fit).toEqual({ [B]: true });
    expect(fixed?.zoom).toBeUndefined();
    expect(validate({ layout: null })).toEqual(emptyBoard());
  });
});
