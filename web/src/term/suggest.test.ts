import { describe, expect, it } from 'vitest';
import { nameIndex } from './names';
import { firstWord, nextShadow, screenCommands, suggest } from './suggest';

const pool = ['git status', 'git log --oneline -20', 'echo one two', 'make test'];
const names = nameIndex([
  { name: 'docs', kind: 'dir' },
  { name: 'notes.md', kind: 'file' },
  { name: 'a b', kind: 'dir' },
]);

describe('nextShadow', () => {
  it('follows text, Backspace and Space, and starts afresh on Enter and the clearing keys', () => {
    let s: string | null = '';
    s = nextShadow(s, { text: 'git st' });
    expect(s).toBe('git st');
    s = nextShadow(s, { key: 'BSpace' });
    expect(s).toBe('git s');
    s = nextShadow(s, { key: 'BSpace', count: 10 });
    expect(s).toBe('');
    s = nextShadow(s, { text: 'ls' });
    s = nextShadow(s, { key: 'Space' });
    expect(s).toBe('ls ');
    s = nextShadow(s, { key: 'C-l' });
    expect(s).toBe('ls ');
    for (const key of ['Enter', 'C-c', 'C-u']) expect(nextShadow('abc', { key })).toBe('');
  });
  it('is unknown after a key it cannot follow, and known again after Enter', () => {
    for (const key of ['Up', 'Down', 'Tab', 'C-r', 'Left', 'Right', 'Home', 'End', 'Delete', 'C-a'])
      expect(nextShadow('git', { key })).toBeNull();
    expect(nextShadow(null, { text: 'x' })).toBeNull();
    expect(nextShadow(null, { key: 'BSpace' })).toBeNull();
    expect(nextShadow(null, { key: 'Enter' })).toBe('');
    expect(nextShadow('x', { text: 'a\nb' })).toBeNull();
  });
});

describe('screenCommands', () => {
  it('reads the commands typed at prompts, newest first, once each, skipping the cursor row', () => {
    const rows = [
      'alice@box:~/work$ git status',
      'On branch main',
      '$ make test',
      'ok',
      '❯ ls -la',
      '$ make test',
      '❯ 1. Yes',
      '$ ',
    ];
    expect(screenCommands(rows, 7)).toEqual(['make test', 'ls -la', 'git status']);
    expect(screenCommands(['a > b'])).toEqual(['b']);
    expect(screenCommands(['x'.repeat(100) + '$ hidden'])).toEqual([]);
    expect(screenCommands(['$ mysql -u root -p hunter2', '$ curl -u a:b https://x/'])).toEqual([]);
  });
});

describe('suggest', () => {
  it('goes on from the shadow where the row confirms it', () => {
    expect(suggest('$ git st', 9, 'git st', pool)).toBe('atus');
    expect(suggest('alice@box:~$ git st', 20, 'git st', pool)).toBe('atus');
    expect(suggest('$ git status', 13, 'git status', pool)).toBeNull();
    expect(suggest('$ ', 3, '', pool)).toBeNull();
    // The screen has not caught up, or shows something else.
    expect(suggest('$ git s', 8, 'git st', pool)).toBeNull();
    expect(suggest('$ make', 7, 'git st', pool)).toBeNull();
  });
  it('without a shadow takes the longest word-boundary suffix a line starts with', () => {
    expect(suggest('alice@box:~/work$ git st', 25, null, pool)).toBe('atus');
    expect(suggest('$ echo o', 9, null, pool)).toBe('ne two');
    // One character is never enough; a suffix inside a word never counts.
    expect(suggest('$ g', 4, null, pool)).toBeNull();
    expect(suggest('$ xgit st', 10, null, pool)).toBeNull();
    expect(suggest('$ agit', 7, null, pool)).toBeNull();
  });
  it('shows nothing with text right of the cursor, and nothing off the row', () => {
    expect(suggest('$ git st', 3, 'git st', pool)).toBeNull();
    expect(suggest('$ git status', 5, null, pool)).toBeNull();
    expect(suggest('$ git st   ', 9, 'git st', pool)).toBe('atus');
    // A row loses its trailing blanks: the cursor past its end is a blank typed.
    expect(suggest('$ echo one', 12, 'echo one ', pool)).toBe('two');
    expect(suggest('$ echo one', 12, null, pool)).toBe('two');
    expect(suggest('$ git st', 0, 'git st', pool)).toBeNull();
  });
  it('completes a name of the directory after a word, a directory with its slash', () => {
    expect(suggest('$ cd do', 8, 'cd do', pool, names)).toBe('cs/');
    expect(suggest('$ cat no', 9, 'cat no', pool, names)).toBe('tes.md');
    expect(suggest('$ cat a', 8, 'cat a', pool, names)).toBeNull();
    // After a command that takes a file one letter is enough; elsewhere two.
    expect(suggest('$ cd d', 7, 'cd d', pool, names)).toBe('ocs/');
    expect(suggest('$ echo d', 9, 'echo d', pool, names)).toBeNull();
    expect(suggest('$ echo do', 10, 'echo do', pool, names)).toBe('cs/');
    expect(suggest('$ do', 5, 'do', pool, names)).toBeNull();
    expect(suggest('$ cd docs', 10, 'cd docs', pool, names)).toBeNull();
    // A line of the pool comes before a name.
    expect(suggest('$ git st', 9, 'git st', pool, names)).toBe('atus');
  });
});

describe('firstWord', () => {
  it('is the ghost up to and including the next blank', () => {
    expect(firstWord('ne two')).toBe('ne ');
    expect(firstWord(' two three')).toBe(' two ');
    expect(firstWord('atus')).toBe('atus');
    expect(firstWord('')).toBe('');
  });
});
