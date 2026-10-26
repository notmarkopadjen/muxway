// Finds the web addresses in a line of plain text so the screen can make
// them links. Only http and https: whatever else a pane prints is text.

export type Link = [start: number, end: number, href: string];

// A run stops at blank space and at the quotes and brackets that wrap an
// address in prose; punctuation at its end belongs to the sentence, except
// a closing bracket that an opening one inside the address accounts for.
const run = /https?:\/\/[^\s<>"'`]+/gi;
const trailing = '.,;:!?)]}>\'"';
const opens: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

function balanced(s: string, close: string): boolean {
  const open = opens[close];
  let n = 0;
  for (const c of s) {
    if (c === open) n++;
    else if (c === close) n--;
  }
  return n >= 0;
}

export function findLinks(line: string): Link[] {
  const out: Link[] = [];
  for (const m of line.matchAll(run)) {
    const start = m.index;
    const body = start + m[0].indexOf('://') + 3;
    let end = start + m[0].length;
    while (end > body) {
      const c = line[end - 1];
      if (!trailing.includes(c)) break;
      if (c in opens && balanced(line.slice(start, end), c)) break;
      end--;
    }
    if (end > body) out.push([start, end, line.slice(start, end)]);
  }
  return out;
}

// A file of a host's inbox, as the agent names one, at the end of a path:
// a click shows it from the host. The name is the whole of what travels;
// a longer extension, a dot or a word glued to it means something else.
const file =
  /\/(?:\S*?\/)?(\d{8}-\d{6}-[a-z0-9]{6}\.(?:png|jpg|gif|webp|pdf|txt|md|json))(?!\.?[A-Za-z0-9_])/g;

export type FileLink = [start: number, end: number, name: string];

export function findFiles(line: string): FileLink[] {
  const out: FileLink[] = [];
  for (const m of line.matchAll(file)) out.push([m.index, m.index + m[0].length, m[1]]);
  return out;
}

// Images open in a window over the page; the rest in a tab of their own.
export function isImage(name: string): boolean {
  return /\.(png|jpg|gif|webp)$/.test(name);
}

// A numbered choice as Claude Code and similar menus print them, with or
// without the pointer: "❯ 1. Yes", "  2. No". In a pane that takes the
// mouse, a click on one picks it, so it shows the hand.
const CHOICE = /^\s*(?:[❯›>▶→]\s*)?\d{1,2}[.)]\s+\S/;

export function isChoice(line: string): boolean {
  return CHOICE.test(line);
}
