import type { Entry } from '../api/types';

// Names of the pane's directory, as the host listed them, found on the
// screen so a click can act on them: a directory is entered, a file
// opened the way the person set. Only a name the host listed is ever a
// link, so what a program prints cannot invent one; a name whose entry
// is neither a directory nor a file stays text.

export type NameKind = 'dir' | 'file';
export type NameMark = [start: number, end: number, name: string, kind: NameKind];

// Where a name may begin and end on a row: the row's edge, blank space,
// a bar, a quote or a bracket, as a listing, a tree, a git status or
// prose set them off; after it also the mark `ls -F` adds and the
// punctuation of a sentence.
const BEFORE = new Set([' ', '\t', '│', '┃', '|', "'", '"', '`', '(', '[', '{', '<']);
const AFTER = new Set([' ', '\t', '│', '┃', '|', "'", '"', '`', ')', ']', '}', '>']);
const AFTER_PUNCT = new Set([',', ';', ':', '.', '!', '?']);
const CLASSIFIER = new Set(['/', '*', '@', '=']);

export interface NameIndex {
  kinds: Map<string, NameKind>;
  // Names a split at the boundaries would cut, longest first.
  odd: string[];
}

// The index of a listing: the names that are directories or files, and
// among them the ones with a boundary character inside.
export function nameIndex(entries: Entry[]): NameIndex {
  const kinds = new Map<string, NameKind>();
  const odd: string[] = [];
  for (const e of entries) {
    if (e.kind !== 'dir' && e.kind !== 'file') continue;
    if (!e.name || e.name === '.' || e.name === '..' || kinds.has(e.name)) continue;
    kinds.set(e.name, e.kind);
    if ([...e.name].some((c) => BEFORE.has(c) || AFTER.has(c))) odd.push(e.name);
  }
  odd.sort((a, b) => b.length - a.length);
  return { kinds, odd };
}

function endsWell(line: string, end: number): boolean {
  if (end >= line.length) return true;
  const c = line[end];
  if (AFTER.has(c) || AFTER_PUNCT.has(c)) return true;
  if (CLASSIFIER.has(c)) {
    const d = line[end + 1];
    return d === undefined || AFTER.has(d) || AFTER_PUNCT.has(d);
  }
  return false;
}

function startsWell(line: string, start: number): boolean {
  return start === 0 || BEFORE.has(line[start - 1]);
}

// The names found on one row, in order, none overlapping another.
export function findNames(line: string, index: NameIndex): NameMark[] {
  if (!index.kinds.size) return [];
  const out: NameMark[] = [];
  const free = (start: number, end: number) => !out.some((m) => m[0] < end && start < m[1]);
  // The odd names first, by their own scan.
  for (const name of index.odd) {
    const kind = index.kinds.get(name)!;
    for (let at = line.indexOf(name); at >= 0; at = line.indexOf(name, at + 1)) {
      const end = at + name.length;
      if (startsWell(line, at) && endsWell(line, end) && free(at, end))
        out.push([at, end, name, kind]);
    }
  }
  // Then every run between boundaries, with a classifier or the
  // sentence's punctuation after it taken off.
  let at = 0;
  while (at < line.length) {
    if (BEFORE.has(line[at]) || AFTER.has(line[at])) {
      at++;
      continue;
    }
    let end = at;
    while (end < line.length && !BEFORE.has(line[end]) && !AFTER.has(line[end])) end++;
    let stop = end;
    while (stop > at && AFTER_PUNCT.has(line[stop - 1])) stop--;
    if (stop > at && CLASSIFIER.has(line[stop - 1]) && stop - 1 > at) {
      const name = line.slice(at, stop - 1);
      if (index.kinds.has(name)) stop--;
    }
    const name = line.slice(at, stop);
    const kind = index.kinds.get(name);
    if (kind && free(at, stop)) out.push([at, stop, name, kind]);
    at = end;
  }
  return out.sort((a, b) => a[0] - b[0]);
}

// A name as a shell takes it whole, whatever is in it.
export function shellQuote(name: string): string {
  return "'" + name.replaceAll("'", "'\\''") + "'";
}

// How a file opens on a click: the preview window, cat, or the person's
// own command with {} standing for the quoted name.
export type OpenMode = 'preview' | 'cat' | 'command';
export interface OpenWith {
  mode: OpenMode;
  command: string;
}

// The line a click types, or null when the window opens the file instead.
export function lineFor(kind: NameKind, name: string, open: OpenWith): string | null {
  const q = shellQuote(name);
  if (kind === 'dir') return `cd -- ${q}`;
  if (open.mode === 'cat') return `cat -- ${q}`;
  if (open.mode === 'command') {
    const c = open.command.trim();
    if (!c) return null;
    return c.includes('{}') ? c.replaceAll('{}', q) : `${c} ${q}`;
  }
  return null;
}

// What the link's title says a click does.
export function titleFor(kind: NameKind, name: string, open: OpenWith): string {
  if (kind === 'dir') return `cd ${name}`;
  if (open.mode === 'cat') return `cat ${name}`;
  if (open.mode === 'command' && open.command.trim())
    return lineFor(kind, name, open)?.replaceAll(shellQuote(name), name) ?? name;
  return `preview ${name}`;
}
