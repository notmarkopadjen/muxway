import { looksSecret } from './commands';
import type { Body } from './direct';
import type { NameIndex } from './names';

// The ghost word: while a shell pane is typed into, the rest of what the
// client thinks is being typed, drawn dim after the cursor and accepted
// with Right. The client does not know where the shell's prompt ends, so
// it keeps a shadow of the line from the keys it sent and shows a ghost
// only where the screen's cursor row confirms it; without a shadow it
// takes the longest word-boundary suffix of the row that some known line
// starts with. Nothing is sent until Right.

// The shadow after one body sent: text appends, Backspace takes a
// character, Enter and the keys that clear the line start it afresh, and
// a key the client cannot follow (history, completion, a move) makes it
// unknown (null) until the next line starts.
export function nextShadow(shadow: string | null, b: Body): string | null {
  if ('text' in b) {
    if (b.text.includes('\n')) return null;
    return shadow === null ? null : shadow + b.text;
  }
  const n = b.count ?? 1;
  switch (b.key) {
    case 'Enter':
    case 'C-c':
    case 'C-u':
      return '';
    case 'C-l':
      return shadow;
    case 'Space':
      return shadow === null ? null : shadow + ' '.repeat(n);
    case 'BSpace':
      return shadow === null ? null : shadow.slice(0, Math.max(0, shadow.length - n));
    default:
      return null;
  }
}

// The commands the screen shows were typed at a prompt, newest first,
// each once: a row that starts with a prompt sign after at most a short
// prompt, with something after it. A numbered choice is no command, and
// a line that looks like it carries a secret is never offered.
const PROMPT = /^.{0,80}?[$#%>❯›]\s+(\S.*?)\s*$/;
const CHOICE = /^\d{1,2}[.)]\s/;
export function screenCommands(rows: string[], skip = -1): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    if (i === skip) continue;
    const m = PROMPT.exec(rows[i]);
    if (!m || CHOICE.test(m[1]) || looksSecret(m[1]) || seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push(m[1]);
  }
  return out;
}

// Commands that take a file: after them one typed character is enough
// for a name; elsewhere a name needs two, so a lone letter stays quiet.
const FILE_COMMANDS = new Set(
  'cd ls cat less more head tail vim vi nvim nano bat open code rm cp mv diff wc'.split(' '),
);

// A line of the pool that goes on from the typed part, or a name of the
// directory that goes on from its last word, after a space; a directory
// gets its slash.
function completion(typed: string, pool: string[], names?: NameIndex): string | null {
  for (const line of pool)
    if (line.startsWith(typed) && line.length > typed.length) return line.slice(typed.length);
  const at = typed.lastIndexOf(' ');
  if (names && at > 0) {
    const word = typed.slice(at + 1);
    const least = FILE_COMMANDS.has(typed.trimStart().split(/\s+/)[0]) ? 1 : 2;
    if (word.length >= least)
      for (const [name, kind] of names.kinds)
        if (name.startsWith(word) && name !== word && !name.includes(' '))
          return name.slice(word.length) + (kind === 'dir' ? '/' : '');
  }
  return null;
}

// The ghost for a cursor row: the text to draw after the cursor, or null.
// `row` is the row's text, `cursorX` the cursor's cell, 1-based.
export function suggest(
  row: string,
  cursorX: number,
  shadow: string | null,
  pool: string[],
  names?: NameIndex,
): string | null {
  if (cursorX < 1) return null;
  // The row comes without its trailing blanks: the cursor may sit past its end.
  const before = row.slice(0, cursorX - 1).padEnd(cursorX - 1, ' ');
  if (row.slice(cursorX - 1).trim()) return null;
  if (shadow !== null) {
    if (!shadow || !before.endsWith(shadow)) return null;
    return completion(shadow, pool, names);
  }
  // Unknown: the longest suffix that starts a word, two characters at least.
  for (let i = 0; i <= before.length - 2; i++) {
    if (i > 0 && before[i - 1] !== ' ') continue;
    if (before[i] === ' ') continue;
    const c = completion(before.slice(i), pool, names);
    if (c !== null) return c;
  }
  return null;
}

// What Ctrl+Right accepts: the ghost up to and including the next blank.
export function firstWord(ghost: string): string {
  return /^\s*\S*\s?/.exec(ghost)?.[0] ?? ghost;
}
