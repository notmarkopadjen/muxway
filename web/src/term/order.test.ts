import { describe, expect, it } from 'vitest';
import { parseOrder } from '../settings';
import { inOrder, move, ORDER_MAX, step } from './order';

const p = (address: string) => ({ address });
const A = 'alice-laptop/work/0.0';
const B = 'alice-laptop/work/0.1';
const C = 'alice-laptop/work/1.0';
const D = 'bob-desktop/work/0.0';

describe('parseOrder', () => {
  it('takes only an array of short strings and treats anything else as empty', () => {
    expect(parseOrder(null)).toEqual([]);
    expect(parseOrder('')).toEqual([]);
    expect(parseOrder('{"x":')).toEqual([]);
    expect(parseOrder('42')).toEqual([]);
    expect(parseOrder('{"a":1}')).toEqual([]);
    expect(parseOrder('[{"address":"x"}]')).toEqual([]);
    expect(parseOrder('["a",1]')).toEqual([]);
    expect(parseOrder(JSON.stringify(['a', 'x'.repeat(257)]))).toEqual([]);
    expect(parseOrder('x'.repeat(70_000))).toEqual([]);
    expect(parseOrder(JSON.stringify([A, B]))).toEqual([A, B]);
  });
  it('drops repeats and keeps at most the cap', () => {
    expect(parseOrder(JSON.stringify([A, B, A]))).toEqual([A, B]);
    const many = Array.from({ length: 1000 }, (_, i) => `h/s/${i}`);
    expect(parseOrder(JSON.stringify(many))).toHaveLength(ORDER_MAX);
  });
});

describe('inOrder', () => {
  it('puts the stored panes first in stored order, the rest in listing order', () => {
    const panes = [A, B, C, D].map(p);
    expect(inOrder(panes, []).map((x) => x.address)).toEqual([A, B, C, D]);
    expect(inOrder(panes, [C, A]).map((x) => x.address)).toEqual([C, A, B, D]);
  });
  it('draws nothing for a stored address the listing lacks', () => {
    expect(inOrder([A, B].map(p), ['gone/x/0.0', B]).map((x) => x.address)).toEqual([B, A]);
  });
});

describe('move', () => {
  it('writes the whole strip in its new order, the dragged tab before the target', () => {
    expect(move([], [A, B, C], C, A)).toEqual([C, A, B]);
    expect(move([], [A, B, C], A, C)).toEqual([B, A, C]);
    expect(move([], [A, B, C], A, null)).toEqual([B, C, A]);
  });
  it('keeps the stored addresses the strip does not show, after the strip', () => {
    expect(move(['gone/x/0.0', A], [A, B], B, A)).toEqual([B, A, 'gone/x/0.0']);
  });
  it('changes nothing for a tab dropped on itself or an unknown target', () => {
    expect(move([A], [A, B], A, A)).toEqual([A]);
    expect(move([A], [A, B], 'nope', A)).toEqual([A]);
    expect(move([A], [A, B], A, 'nope')).toEqual([A]);
  });
  it('drops the away addresses first at the cap', () => {
    const away = Array.from({ length: ORDER_MAX }, (_, i) => `h/s/${i}`);
    const out = move(away, [A, B], B, A);
    expect(out).toHaveLength(ORDER_MAX);
    expect(out.slice(0, 2)).toEqual([B, A]);
  });
});

describe('step', () => {
  it('moves one place and stops at either end', () => {
    expect(step([], [A, B, C], A, 1)).toEqual([B, A, C]);
    expect(step([], [A, B, C], C, 1)).toEqual([]);
    expect(step([], [A, B, C], C, -1)).toEqual([A, C, B]);
    expect(step([], [A, B, C], A, -1)).toEqual([]);
    expect(step([], [A, B, C], B, 1)).toEqual([A, C, B]);
  });
});
