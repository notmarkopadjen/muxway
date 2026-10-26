import { describe as group, expect, it } from 'vitest';
import { CLAUDE_COMMANDS } from './commands';
import {
  CLAUDE_SLASH,
  complete,
  completions,
  firstWord,
  MAX_COMPLETIONS,
  screenWords,
  wordAt,
} from './complete';

const texts = (p: Parameters<typeof completions>[0], t: string, c: number, r: string[] = []) =>
  completions(p, t, c, r).map((o) => o.text);

const claude = { command: 'node', title: '✳ building' };
const shell = { command: 'bash', title: 'bash' };

group('completions', () => {
  it('matches the first word by prefix, the row commands first, at most eight', () => {
    expect(texts(claude, '/co', 3, [])).toEqual(['/compact', '/context', '/cost', '/config']);
    const all = texts(claude, '/', 1, []);
    expect(all).toHaveLength(MAX_COMPLETIONS);
    expect(all).toEqual(CLAUDE_COMMANDS.slice(0, MAX_COMPLETIONS).map((c) => c.text.trim()));
    expect(new Set(CLAUDE_SLASH).size).toBe(CLAUDE_SLASH.length);
    expect(texts(claude, '/nothing', 8, [])).toEqual([]);
  });

  it('gives a shell its starters and the recent lines, without repeats', () => {
    expect(texts(shell, 'ma', 2, ['make', 'make lint'])).toEqual([
      'make',
      'make test',
      'make lint',
    ]);
    expect(texts(shell, 'cl', 2, [])).toEqual(['claude', 'claude -c', 'claude --resume', 'clear']);
  });

  it('offers nothing for a second word, an empty line, or an unknown program', () => {
    expect(texts(claude, '/compact now', 12, [])).toEqual([]);
    expect(texts(claude, 'fix /co', 7, [])).toEqual([]);
    expect(texts(claude, '', 0, [])).toEqual([]);
    expect(texts(claude, '  ', 2, [])).toEqual([]);
    expect(texts({ command: 'vim', title: 'notes' }, 'e', 1, [])).toEqual([]);
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

  it('offers the words on the screen for any word two letters in, after the commands', () => {
    const words = screenWords(
      'ls\ndocs/plans/a.md  notes.txt  README\n$ cat docs/plans/a.md\n│ quoted │\nhi there, Marko.',
    );
    expect(words.slice(0, 4)).toEqual(['Marko', 'there', 'quoted', 'docs/plans/a.md']);
    expect(words).not.toContain('ls');
    expect(words).not.toContain('│');
    expect(completions(shell, 'cat do', 6, [], words)).toEqual([
      { text: 'docs/plans/a.md', kind: 'word' },
    ]);
    expect(completions(shell, 'd', 1, [], words).map((o) => o.text)).not.toContain(
      'docs/plans/a.md',
    );
    const first = completions(claude, '/co', 3, [], ['/compact-notes.md']);
    expect(first[0].kind).toBe('command');
    expect(first.map((o) => o.text)).toContain('/compact-notes.md');
    expect(completions(shell, 'cat docs/plans/a.md', 19, [], words)).toEqual([]);
    expect(wordAt('cat do', 6)).toEqual({ word: 'do', start: 4, first: false });
    expect(wordAt('cat do', 5)).toBeNull();
    expect(complete('cat do', 6, 'docs/plans/a.md')).toEqual({
      text: 'cat docs/plans/a.md ',
      caret: 20,
    });
  });
});
