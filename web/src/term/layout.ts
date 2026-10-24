// tmux's window layout string, parsed into a tree. A layout looks like
// "b25d,100x30,0,0{50x30,0,0,3,49x30,51,0,4}": a checksum, then a cell
// "WxH,X,Y" that is either a pane (",id") or a split with children in
// {...} (side by side) or [...] (stacked).

export interface Leaf {
  kind: 'pane';
  id: string; // "%3"
  w: number;
  h: number;
  x: number;
  y: number;
}
export interface Split {
  kind: 'h' | 'v'; // h: children left to right; v: top to bottom
  w: number;
  h: number;
  x: number;
  y: number;
  children: Node[];
}
export type Node = Leaf | Split;

class Parser {
  i = 0;
  constructor(private s: string) {}
  peek() {
    return this.s[this.i];
  }
  take(c: string) {
    if (this.s[this.i] !== c) throw new Error(`expected ${c} at ${this.i}`);
    this.i++;
  }
  number() {
    const m = /^\d+/.exec(this.s.slice(this.i));
    if (!m) throw new Error(`expected a number at ${this.i}`);
    this.i += m[0].length;
    return Number(m[0]);
  }
  cell(): Node {
    const w = this.number();
    this.take('x');
    const h = this.number();
    this.take(',');
    const x = this.number();
    this.take(',');
    const y = this.number();
    const c = this.peek();
    if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']';
      this.i++;
      const children: Node[] = [this.cell()];
      while (this.peek() === ',') {
        this.i++;
        children.push(this.cell());
      }
      this.take(close);
      return { kind: c === '{' ? 'h' : 'v', w, h, x, y, children };
    }
    this.take(',');
    return { kind: 'pane', id: '%' + this.number(), w, h, x, y };
  }
}

export function parseLayout(layout: string): Node {
  const comma = layout.indexOf(',');
  if (comma < 0) throw new Error('no checksum');
  const p = new Parser(layout.slice(comma + 1));
  const root = p.cell();
  if (p.i !== layout.length - comma - 1) throw new Error('trailing characters');
  return root;
}

export function leaves(n: Node): Leaf[] {
  return n.kind === 'pane' ? [n] : n.children.flatMap(leaves);
}

// Fractions of a split's children along its axis, from the host's sizes.
export function fractions(s: Split): number[] {
  const sizes = s.children.map((c) => (s.kind === 'h' ? c.w : c.h));
  const total = sizes.reduce((a, b) => a + b, 0) || 1;
  return sizes.map((v) => v / total);
}

// A browser-side arrangement: fractions per split (by path) and hidden panes.
export interface Arrangement {
  layout: string; // the host layout it was made for
  fractions: Record<string, number[]>; // split path "0.1" -> fractions
  hidden: string[];
  scale: Record<string, number>; // pane id -> font multiplier
}

export function fresh(layout: string): Arrangement {
  return { layout, fractions: {}, hidden: [], scale: {} };
}
