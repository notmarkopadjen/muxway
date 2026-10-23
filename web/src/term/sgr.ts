// Just enough SGR to show a pane: colours, bold, dim, underline, inverse.
// Every other escape sequence is dropped. Output is text with attributes,
// never markup.

export interface Span {
  text: string;
  fg?: number | string; // 0-15 for a class, a css colour for 256/truecolor
  bg?: number | string;
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

interface State {
  fg?: number | string;
  bg?: number | string;
  bold: boolean;
  dim: boolean;
  underline: boolean;
  inverse: boolean;
}

const fresh = (): State => ({ bold: false, dim: false, underline: false, inverse: false });

function colour256(n: number): number | string {
  if (n < 16) return n;
  if (n < 232) {
    const i = n - 16;
    const step = (v: number) => (v === 0 ? 0 : 55 + v * 40);
    return `rgb(${step(Math.floor(i / 36))},${step(Math.floor(i / 6) % 6)},${step(i % 6)})`;
  }
  const g = 8 + (n - 232) * 10;
  return `rgb(${g},${g},${g})`;
}

function apply(state: State, params: number[]): void {
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    if (p === 0) Object.assign(state, fresh(), { fg: undefined, bg: undefined });
    else if (p === 1) state.bold = true;
    else if (p === 2) state.dim = true;
    else if (p === 4) state.underline = true;
    else if (p === 7) state.inverse = true;
    else if (p === 22) state.bold = state.dim = false;
    else if (p === 24) state.underline = false;
    else if (p === 27) state.inverse = false;
    else if (p >= 30 && p <= 37) state.fg = p - 30;
    else if (p === 39) state.fg = undefined;
    else if (p >= 40 && p <= 47) state.bg = p - 40;
    else if (p === 49) state.bg = undefined;
    else if (p >= 90 && p <= 97) state.fg = p - 90 + 8;
    else if (p >= 100 && p <= 107) state.bg = p - 100 + 8;
    else if (p === 38 || p === 48) {
      const mode = params[i + 1];
      let c: number | string | undefined;
      if (mode === 5 && params.length > i + 2) {
        c = colour256(Math.min(255, Math.max(0, params[i + 2])));
        i += 2;
      } else if (mode === 2 && params.length > i + 4) {
        const [r, g, b] = params.slice(i + 2, i + 5).map((v) => Math.min(255, Math.max(0, v)));
        c = `rgb(${r},${g},${b})`;
        i += 4;
      } else break;
      if (p === 38) state.fg = c;
      else state.bg = c;
    }
  }
}

// Matches CSI ... final byte, OSC ... BEL/ST, charset designations and lone two-byte escapes.
const escape =
  /\x1b(?:\[([0-9;?]*)([ -/]*[@-~])|\][^\x07\x1b]*(?:\x07|\x1b\\)|[ -/][0-~]|[@-Z\\-_])/g;

export function parseLine(line: string, start: State = fresh()): { spans: Span[]; state: State } {
  const spans: Span[] = [];
  const state: State = { ...start };
  let last = 0;
  const push = (text: string) => {
    if (!text) return;
    spans.push({
      text,
      fg: state.fg,
      bg: state.bg,
      bold: state.bold,
      dim: state.dim,
      underline: state.underline,
      inverse: state.inverse,
    });
  };
  for (const m of line.matchAll(escape)) {
    push(line.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[2] === 'm')
      apply(
        state,
        (m[1] || '0')
          .split(';')
          .map((s) => (s === '' ? 0 : Number(s)))
          .filter((n) => Number.isFinite(n)),
      );
  }
  push(line.slice(last));
  // Other control characters never reach the page.
  const control = /[\x00-\x08\x0b-\x1f\x7f]/g;
  for (const s of spans) s.text = s.text.replace(control, '');
  return { spans, state };
}

export function parse(content: string): Span[][] {
  let state = fresh();
  return content.split('\n').map((line) => {
    const r = parseLine(line, state);
    state = r.state;
    return r.spans;
  });
}

export function classes(s: Span): string {
  const c: string[] = [];
  if (typeof s.fg === 'number') c.push(`fg${s.fg}`);
  if (typeof s.bg === 'number') c.push(`bg${s.bg}`);
  if (s.bold) c.push('sgr-b');
  if (s.dim) c.push('sgr-d');
  if (s.underline) c.push('sgr-u');
  if (s.inverse) c.push('sgr-i');
  return c.join(' ');
}
