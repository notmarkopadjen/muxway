import { describe, expect, it } from 'vitest';
import type { Pane } from '../api/types';
import { ago, waiting } from './Inbox';

const pane = (address: string, at?: number, kind: 'question' | 'done' = 'done'): Pane =>
  ({ address, host: 'alice-laptop', attention: at ? { kind, at } : undefined }) as unknown as Pane;

describe('inbox', () => {
  it('keeps the waiting panes, oldest first', () => {
    const rows = waiting([
      pane('a/w/0.0'),
      pane('a/w/1.0', 300),
      pane('b/w/0.0', 100),
      pane('a/w/2.0', 200),
    ]);
    expect(rows.map((p) => p.address)).toEqual(['b/w/0.0', 'a/w/2.0', 'a/w/1.0']);
    expect(waiting(undefined)).toEqual([]);
  });

  it('says how long ago in a word', () => {
    const now = 1_000_000 * 1000;
    expect(ago(1_000_000 - 5, now)).toBe('5s');
    expect(ago(1_000_000 - 90, now)).toBe('1m');
    expect(ago(1_000_000 - 7200, now)).toBe('2h');
    expect(ago(1_000_000 - 90_000, now)).toBe('1d');
    expect(ago(1_000_000 + 5, now)).toBe('0s');
  });
});
