import { describe, expect, it } from 'vitest';
import { buildTree, countOf, nameOf, summary, viewsOf } from './changes';
import type { Change } from '../api/types';

const entries: Change[] = [
  { path: 'src/b.go', kind: 'modified' },
  { path: 'src/a.go', kind: 'modified', staged: true },
  { path: 'notes.txt', kind: 'untracked' },
  { path: 'docs/plans/x.md', kind: 'added', staged: true },
  { path: 'src/gone.go', kind: 'deleted' },
  { path: 'src/moved.go', from: 'src/old.go', kind: 'renamed', staged: true },
  { path: 'a/b/c/deep.txt', kind: 'conflict' },
];

describe('buildTree', () => {
  it('lays the paths out by directory, directories first, sorted, with counts', () => {
    const t = buildTree(entries);
    expect(t.count).toBe(7);
    expect(t.dirs.map((d) => d.name)).toEqual(['a', 'docs', 'src']);
    expect(t.files.map((f) => f.path)).toEqual(['notes.txt']);
    const src = t.dirs[2];
    expect(src.path).toBe('src');
    expect(src.count).toBe(4);
    expect(src.files.map((f) => f.path)).toEqual([
      'src/a.go',
      'src/b.go',
      'src/gone.go',
      'src/moved.go',
    ]);
    expect(t.dirs[0].dirs[0].dirs[0].path).toBe('a/b/c');
    expect(t.dirs[0].count).toBe(1);
    expect(t.dirs[1].dirs[0].files[0].path).toBe('docs/plans/x.md');
  });
  it('is empty for no entries', () => {
    expect(buildTree([])).toEqual({ name: '', path: '', dirs: [], files: [], count: 0 });
  });
});

describe('countOf and summary', () => {
  it('counts added with untracked, renamed with modified, and leaves zeros out', () => {
    const c = countOf(entries);
    expect(c).toEqual({ added: 2, changed: 3, deleted: 1, conflict: 1 });
    expect(summary(c)).toBe('+2 ~3 −1 !1');
    expect(summary(countOf([]))).toBe('');
    expect(summary(countOf([{ path: 'x', kind: 'deleted' }]))).toBe('−1');
  });
});

describe('viewsOf and nameOf', () => {
  it('knows which views a change has', () => {
    expect(viewsOf('untracked')).toEqual(['file']);
    expect(viewsOf('deleted')).toEqual(['diff']);
    expect(viewsOf('modified')).toEqual(['diff', 'file']);
    expect(viewsOf('added')).toEqual(['diff', 'file']);
    expect(nameOf({ path: 'src/a.go', kind: 'modified' })).toBe('a.go');
    expect(nameOf({ path: 'top', kind: 'added' })).toBe('top');
  });
});
