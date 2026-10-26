import { describe, expect, it } from 'vitest';
import { blockAt, blocks } from './blocks';

const FRAME = [
  '❯ Take a note in memory that ADO tickets are links',
  '',
  '● Noted and indexed. The rule is saved as a feedback memory',
  '  and listed at the top of the index.',
  '',
  '  Applied right away:',
  '',
  '  - AB#2174 daily statistics freeze',
  '  - AB#2175 binds page hides outages',
  '',
  '  │ The memory records the link formats',
  '  │ for work items and pull requests.',
  '  │',
  '  │ Apply it in replies.',
  '',
  '  ⎿  Ran 2 shell commands',
  '     wrote 1 memory',
  '',
  '✻ Cooked for 21s · done 5:04 PM',
  '',
  '> quoted',
  '> rows',
  'plain text after',
];

describe('blocks', () => {
  it('finds bullets with their indented rows, bars, results and quotes', () => {
    const all = blocks(FRAME);
    expect(all.map((b) => [b.start, b.end])).toEqual([
      [0, 0],
      [2, 8],
      [10, 13],
      [15, 16],
      [18, 18],
      [20, 21],
    ]);
    expect(all[0].text).toBe('Take a note in memory that ADO tickets are links');
    expect(all[1].text).toBe(
      [
        'Noted and indexed. The rule is saved as a feedback memory',
        'and listed at the top of the index.',
        '',
        'Applied right away:',
        '',
        '- AB#2174 daily statistics freeze',
        '- AB#2175 binds page hides outages',
      ].join('\n'),
    );
    expect(all[2].text).toBe(
      'The memory records the link formats\nfor work items and pull requests.\n\nApply it in replies.',
    );
    expect(all[3].text).toBe('Ran 2 shell commands\nwrote 1 memory');
    expect(all[5].text).toBe('quoted\nrows');
  });
  it('leaves plain rows, empty markers and a bar with nothing after it alone', () => {
    expect(blocks(['plain', '', '●', '│', '  just indented'])).toEqual([]);
  });
  it('tells which block a row is in', () => {
    const all = blocks(FRAME);
    expect(blockAt(all, 5)?.start).toBe(2);
    expect(blockAt(all, 12)?.start).toBe(10);
    expect(blockAt(all, 22)).toBeUndefined();
  });
});
