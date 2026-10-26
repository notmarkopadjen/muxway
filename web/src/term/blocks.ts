// The blocks of a screen, as Claude Code and its kind print them: a run
// of rows down one bar (│ ┃ | >), a ● or ❯ row with the rows indented
// under it, a ⎿ result with its rows. A block is what a click on its mark
// copies: the text without the bar, the marker and the indent, the rows
// inside kept as they are.

export interface Block {
  start: number; // first row, inclusive
  end: number; // last row, inclusive
  text: string;
}

const BAR = /^(\s*)([│┃|>])( ?)(.*)$/;
const BULLET = /^(\s*)([●❯⏺✻✶✽✢·⎿])( +)(.*)$/;

function bar(line: string): RegExpExecArray | null {
  return BAR.exec(line);
}

export function blocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const b = bar(lines[i]);
    if (b && b[4].trim()) {
      // Every following row down the same bar at the same indent.
      let j = i;
      const rows: string[] = [];
      while (j < lines.length) {
        const m = bar(lines[j]);
        if (!m || m[1] !== b[1] || m[2] !== b[2]) break;
        rows.push(m[4]);
        j++;
      }
      out.push({ start: i, end: j - 1, text: trimEnd(rows) });
      i = j;
      continue;
    }
    const m = BULLET.exec(lines[i]);
    if (m && m[4].trim()) {
      const indent = m[1].length + m[2].length + m[3].length;
      const rows = [m[4]];
      let j = i + 1;
      // The rows indented under the marker belong to it, up to a blank row
      // or the next marker; a blank row inside is kept when more follows.
      while (j < lines.length) {
        const row = lines[j];
        if (row.trim() === '') {
          const next = lines[j + 1];
          if (next !== undefined && under(next, indent) && !BULLET.test(next) && !bar(next)) {
            rows.push('');
            j++;
            continue;
          }
          break;
        }
        if (!under(row, indent) || BULLET.test(row) || bar(row)) break;
        rows.push(row.slice(indent));
        j++;
      }
      out.push({ start: i, end: j - 1, text: trimEnd(rows) });
      i = j;
      continue;
    }
    i++;
  }
  return out;
}

function under(row: string, indent: number): boolean {
  return row.length > indent && /^\s+$/.test(row.slice(0, indent));
}

function trimEnd(rows: string[]): string {
  while (rows.length && rows[rows.length - 1].trim() === '') rows.pop();
  return rows.map((r) => r.replace(/\s+$/, '')).join('\n');
}

// The block a row belongs to, if any.
export function blockAt(all: Block[], row: number): Block | undefined {
  return all.find((b) => b.start <= row && row <= b.end);
}
