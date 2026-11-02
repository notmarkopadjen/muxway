import { describe, expect, it } from 'vitest';
import { findNames, lineFor, nameIndex, shellQuote, titleFor } from './names';

const index = nameIndex([
  { name: 'docs', kind: 'dir' },
  { name: 'plans', kind: 'dir' },
  { name: 'a b', kind: 'dir' },
  { name: 'notes.md', kind: 'file' },
  { name: "it's.txt", kind: 'file' },
  { name: 'Makefile', kind: 'file' },
  { name: 'sock', kind: 'other' },
  { name: '.', kind: 'dir' },
  { name: '..', kind: 'dir' },
]);

const names = (line: string) =>
  findNames(line, index).map(([s, e, n, k]) => [line.slice(s, e), n, k]);

describe('findNames', () => {
  it('finds the names of a listing in columns and one per row', () => {
    expect(names('docs  notes.md  plans  sock')).toEqual([
      ['docs', 'docs', 'dir'],
      ['notes.md', 'notes.md', 'file'],
      ['plans', 'plans', 'dir'],
    ]);
    expect(names('plans')).toEqual([['plans', 'plans', 'dir']]);
  });
  it('reads ls -l, ls -F and the quoting of ls', () => {
    expect(names('drwxr-xr-x 2 alice alice 4096 Nov  2 10:00 docs')).toEqual([
      ['docs', 'docs', 'dir'],
    ]);
    expect(names('docs/  notes.md  Makefile*')).toEqual([
      ['docs', 'docs', 'dir'],
      ['notes.md', 'notes.md', 'file'],
      ['Makefile', 'Makefile', 'file'],
    ]);
    expect(names("'a b'  \"it's.txt\"  docs")).toEqual([
      ['a b', 'a b', 'dir'],
      ["it's.txt", "it's.txt", 'file'],
      ['docs', 'docs', 'dir'],
    ]);
  });
  it('reads a tree, a git status and prose', () => {
    expect(names('├── docs')).toEqual([['docs', 'docs', 'dir']]);
    expect(names('│   └── notes.md')).toEqual([['notes.md', 'notes.md', 'file']]);
    expect(names('\tmodified:   notes.md')).toEqual([['notes.md', 'notes.md', 'file']]);
    expect(names('see notes.md, then docs.')).toEqual([
      ['notes.md', 'notes.md', 'file'],
      ['docs', 'docs', 'dir'],
    ]);
    expect(names('(docs) [plans] <notes.md>')).toEqual([
      ['docs', 'docs', 'dir'],
      ['plans', 'plans', 'dir'],
      ['notes.md', 'notes.md', 'file'],
    ]);
  });
  it('leaves a name glued to other characters, a part of a path, and the dots', () => {
    expect(names('mydocs docsy docs/plans notes.md.bak x.docs')).toEqual([]);
    expect(names('. .. ./docs ../plans')).toEqual([]);
    expect(names('http://example.com/docs')).toEqual([]);
  });
  it('never links what the host did not list, nor an entry of another kind', () => {
    expect(names('sock other things')).toEqual([]);
    expect(findNames('docs', nameIndex([]))).toEqual([]);
  });
  it('lets no two names overlap', () => {
    const idx = nameIndex([
      { name: 'a b', kind: 'dir' },
      { name: 'b', kind: 'file' },
      { name: 'a', kind: 'file' },
    ]);
    expect(findNames('a b', idx)).toEqual([[0, 3, 'a b', 'dir']]);
    expect(findNames('b a', idx)).toEqual([
      [0, 1, 'b', 'file'],
      [2, 3, 'a', 'file'],
    ]);
  });
});

describe('shellQuote and lineFor', () => {
  it('quotes every name whole', () => {
    expect(shellQuote('docs')).toBe("'docs'");
    expect(shellQuote('a b')).toBe("'a b'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    expect(shellQuote("'; rm -rf ~ #")).toBe("''\\''; rm -rf ~ #'");
    expect(shellQuote('-n')).toBe("'-n'");
    expect(shellQuote('$(x)`y`')).toBe("'$(x)`y`'");
  });
  it('types cd for a directory and the setting for a file', () => {
    const preview = { mode: 'preview', command: '' } as const;
    const cat = { mode: 'cat', command: '' } as const;
    const vim = { mode: 'command', command: 'vim {}' } as const;
    const less = { mode: 'command', command: 'less' } as const;
    const blank = { mode: 'command', command: '  ' } as const;
    expect(lineFor('dir', '-x', preview)).toBe("cd -- '-x'");
    expect(lineFor('dir', 'a b', cat)).toBe("cd -- 'a b'");
    expect(lineFor('file', 'notes.md', preview)).toBeNull();
    expect(lineFor('file', 'notes.md', cat)).toBe("cat -- 'notes.md'");
    expect(lineFor('file', "it's", vim)).toBe("vim 'it'\\''s'");
    expect(lineFor('file', 'notes.md', less)).toBe("less 'notes.md'");
    expect(lineFor('file', 'notes.md', blank)).toBeNull();
    expect(lineFor('file', 'x', { mode: 'command', command: 'diff {} {}' })).toBe("diff 'x' 'x'");
  });
  it('titles say what a click does', () => {
    expect(titleFor('dir', 'docs', { mode: 'cat', command: '' })).toBe('cd docs');
    expect(titleFor('file', 'notes.md', { mode: 'preview', command: '' })).toBe('preview notes.md');
    expect(titleFor('file', 'notes.md', { mode: 'cat', command: '' })).toBe('cat notes.md');
    expect(titleFor('file', 'notes.md', { mode: 'command', command: 'vim {}' })).toBe(
      'vim notes.md',
    );
    expect(titleFor('file', 'notes.md', { mode: 'command', command: '' })).toBe('preview notes.md');
  });
});
