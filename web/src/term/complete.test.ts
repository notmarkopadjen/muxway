import { describe as group, expect, it } from 'vitest';
import { CLAUDE_COMMANDS } from './commands';
import { CLAUDE_SLASH, complete, completions, firstWord, MAX_COMPLETIONS } from './complete';

const claude = { command: 'node', title: '✳ building' };
const shell = { command: 'bash', title: 'bash' };

group('completions', () => {
  it('matches the first word by prefix, the row commands first, at most eight', () => {
    expect(completions(claude, '/co', 3, [])).toEqual(['/compact', '/context', '/cost', '/config']);
    const all = completions(claude, '/', 1, []);
    expect(all).toHaveLength(MAX_COMPLETIONS);
    expect(all).toEqual(CLAUDE_COMMANDS.slice(0, MAX_COMPLETIONS).map((c) => c.text.trim()));
    expect(new Set(CLAUDE_SLASH).size).toBe(CLAUDE_SLASH.length);
    expect(completions(claude, '/nothing', 8, [])).toEqual([]);
  });

  it('gives a shell its starters and the recent lines, without repeats', () => {
    expect(completions(shell, 'ma', 2, ['make', 'make lint'])).toEqual([
      'make',
      'make test',
      'make lint',
    ]);
    expect(completions(shell, 'cl', 2, [])).toEqual([
      'claude',
      'claude -c',
      'claude --resume',
      'clear',
    ]);
  });

  it('offers nothing for a second word, an empty line, or an unknown program', () => {
    expect(completions(claude, '/compact now', 12, [])).toEqual([]);
    expect(completions(claude, 'fix /co', 7, [])).toEqual([]);
    expect(completions(claude, '', 0, [])).toEqual([]);
    expect(completions(claude, '  ', 2, [])).toEqual([]);
    expect(completions({ command: 'vim', title: 'notes' }, 'e', 1, [])).toEqual([]);
    // The caret inside the word, or on a later line, is not at the first word's end.
    expect(firstWord('/compact', 3)).toBeNull();
    expect(firstWord('/co\nmore', 3)).toBe('/co');
    expect(firstWord('/co\nmore', 8)).toBeNull();
    expect(firstWord('  /co', 5)).toBe('/co');
  });

  it('replaces the first word with the pick and a space, keeping the rest', () => {
    expect(complete('/co', 3, '/config')).toEqual({ text: '/config ', caret: 8 });
    expect(complete('  /co the rest', 5, '/compact')).toEqual({
      text: '  /compact the rest',
      caret: 11,
    });
    expect(complete('/co\nline two', 3, '/compact')).toEqual({
      text: '/compact \nline two',
      caret: 9,
    });
  });
});
