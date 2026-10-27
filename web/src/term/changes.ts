import type { Change, ChangeKind } from '../api/types';

// The changes window's tree: the repository's changed paths laid out by
// directory, directories first, each sorted by name; and the marks and
// counts its bar and rows show.

export interface Dir {
  name: string;
  path: string;
  dirs: Dir[];
  files: Change[];
  // How many changes lie below, for a folded directory's row.
  count: number;
}

export function buildTree(entries: Change[]): Dir {
  const root: Dir = { name: '', path: '', dirs: [], files: [], count: 0 };
  for (const e of entries) {
    const parts = e.path.split('/');
    let dir = root;
    dir.count++;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i];
      let next = dir.dirs.find((d) => d.name === name);
      if (!next) {
        next = { name, path: parts.slice(0, i + 1).join('/'), dirs: [], files: [], count: 0 };
        dir.dirs.push(next);
      }
      next.count++;
      dir = next;
    }
    dir.files.push(e);
  }
  sort(root);
  return root;
}

function sort(dir: Dir) {
  dir.dirs.sort((a, b) => a.name.localeCompare(b.name));
  dir.files.sort((a, b) => a.path.localeCompare(b.path));
  for (const d of dir.dirs) sort(d);
}

export const MARKS: Record<ChangeKind, string> = {
  added: '+',
  untracked: '+',
  modified: '~',
  renamed: '→',
  deleted: '−',
  conflict: '!',
};

export interface Counts {
  added: number;
  changed: number;
  deleted: number;
  conflict: number;
}

export function countOf(entries: Change[]): Counts {
  const c: Counts = { added: 0, changed: 0, deleted: 0, conflict: 0 };
  for (const e of entries) {
    if (e.kind === 'added' || e.kind === 'untracked') c.added++;
    else if (e.kind === 'deleted') c.deleted++;
    else if (e.kind === 'conflict') c.conflict++;
    else c.changed++;
  }
  return c;
}

// The bar's summary: the counts that are not zero, in their marks.
export function summary(c: Counts): string {
  const parts: string[] = [];
  if (c.added) parts.push(`+${c.added}`);
  if (c.changed) parts.push(`~${c.changed}`);
  if (c.deleted) parts.push(`−${c.deleted}`);
  if (c.conflict) parts.push(`!${c.conflict}`);
  return parts.join(' ');
}

// What the file window opens for a change: its diff, the file, or both.
export function viewsOf(kind: ChangeKind): ('diff' | 'file')[] {
  switch (kind) {
    case 'untracked':
      return ['file'];
    case 'deleted':
      return ['diff'];
    default:
      return ['diff', 'file'];
  }
}

// The name of a file in the tree: a rename shows where it came from.
export function nameOf(e: Change): string {
  return e.path.split('/').pop() ?? e.path;
}
