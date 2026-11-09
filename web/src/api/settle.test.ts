import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Settle } from './settle';

describe('Settle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs the first at once and folds the rest into one after the last', () => {
    const s = new Settle(250);
    const ran: string[] = [];
    s.run('a', () => ran.push('1'));
    expect(ran).toEqual(['1']);
    vi.advanceTimersByTime(50);
    s.run('a', () => ran.push('2'));
    vi.advanceTimersByTime(50);
    s.run('a', () => ran.push('3'));
    expect(ran).toEqual(['1']);
    vi.advanceTimersByTime(149);
    expect(ran).toEqual(['1']);
    vi.advanceTimersByTime(1);
    expect(ran).toEqual(['1', '3']);
  });

  it('opens the window again after a quiet spell', () => {
    const s = new Settle(250);
    const ran: string[] = [];
    s.run('a', () => ran.push('1'));
    vi.advanceTimersByTime(300);
    s.run('a', () => ran.push('2'));
    expect(ran).toEqual(['1', '2']);
    // Right after a trailing run the window is shut again.
    vi.advanceTimersByTime(10);
    s.run('a', () => ran.push('3'));
    expect(ran).toEqual(['1', '2']);
    vi.advanceTimersByTime(250);
    expect(ran).toEqual(['1', '2', '3']);
  });

  it('keeps one slot per key', () => {
    const s = new Settle(250);
    const ran: string[] = [];
    s.run('a', () => ran.push('a1'));
    s.run('b', () => ran.push('b1'));
    s.run('a', () => ran.push('a2'));
    expect(ran).toEqual(['a1', 'b1']);
    vi.advanceTimersByTime(250);
    expect(ran).toEqual(['a1', 'b1', 'a2']);
  });

  it('later runs the trailing one alone, a span after the first call of a burst', () => {
    const s = new Settle(250);
    const ran: string[] = [];
    s.later('a', () => ran.push('1'));
    expect(ran).toEqual([]);
    vi.advanceTimersByTime(100);
    s.later('a', () => ran.push('2'));
    vi.advanceTimersByTime(149);
    expect(ran).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(ran).toEqual(['2']);
    // The window is open again: a later call waits its own span.
    s.later('a', () => ran.push('3'));
    vi.advanceTimersByTime(249);
    expect(ran).toEqual(['2']);
    vi.advanceTimersByTime(1);
    expect(ran).toEqual(['2', '3']);
    // And a run after a later counts the later's run as the last.
    s.run('a', () => ran.push('4'));
    expect(ran).toEqual(['2', '3']);
    vi.advanceTimersByTime(250);
    expect(ran).toEqual(['2', '3', '4']);
  });
});
