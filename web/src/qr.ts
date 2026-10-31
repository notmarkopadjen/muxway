// The connect code the phone app scans, drawn by the page: a QR encoder in
// byte mode at error correction level M, versions 1 to 10 (213 bytes), a
// port of the Android repository's scripts/connect-qr.py. qrModules()
// returns the modules, row by row, or null when the text does not fit.

export type Modules = boolean[][];

export function connectCode(hub: string, token: string): string {
  return `muxway://connect?hub=${encode(hub, ':/')}&token=${encode(token, '')}`;
}

// Percent-encoding as Python's quote: unreserved characters and `keep` pass.
function encode(s: string, keep: string): string {
  let out = '';
  for (const b of new TextEncoder().encode(s)) {
    const c = String.fromCharCode(b);
    out +=
      /[A-Za-z0-9_.~-]/.test(c) || keep.includes(c)
        ? c
        : `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

// version: error correction codewords per block, data codewords of each block
const TABLE: Record<number, [number, number[]]> = {
  1: [10, [16]],
  2: [16, [28]],
  3: [26, [44]],
  4: [18, [32, 32]],
  5: [24, [43, 43]],
  6: [16, [27, 27, 27, 27]],
  7: [18, [31, 31, 31, 31]],
  8: [22, [38, 38, 39, 39]],
  9: [22, [36, 36, 36, 37, 37]],
  10: [26, [43, 43, 43, 43, 44]],
};
const ALIGN: Record<number, number[]> = {
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

// Reed-Solomon over GF(256), polynomial 0x11D
const EXP = new Array<number>(512).fill(0);
const LOG = new Array<number>(256).fill(0);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function generator(n: number): number[] {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const ng = new Array<number>(g.length + 1).fill(0);
    g.forEach((c, j) => {
      ng[j] ^= c;
      ng[j + 1] ^= mul(c, EXP[i]);
    });
    g = ng;
  }
  return g;
}

function remainder(data: number[], gen: number[]): number[] {
  let rem = new Array<number>(gen.length - 1).fill(0);
  for (const b of data) {
    const factor = b ^ rem[0];
    rem = [...rem.slice(1), 0];
    for (let i = 0; i < rem.length; i++) rem[i] ^= mul(gen[i + 1], factor);
  }
  return rem;
}

function codewords(data: Uint8Array, version: number): number[] | null {
  const [ec, blocks] = TABLE[version];
  const capacity = blocks.reduce((a, b) => a + b, 0);
  const bits: number[] = [];
  const put = (value: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  put(0b0100, 4);
  put(data.length, version >= 10 ? 16 : 8);
  for (const b of data) put(b, 8);
  if (bits.length > capacity * 8) return null;
  put(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const words: number[] = [];
  for (let i = 0; i < bits.length; i += 8) words.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let i = 0; words.length < capacity; i++) words.push(i % 2 ? 0x11 : 0xec);
  const gen = generator(ec);
  const chunks: number[][] = [];
  const ecs: number[][] = [];
  let pos = 0;
  for (const size of blocks) {
    const chunk = words.slice(pos, pos + size);
    pos += size;
    chunks.push(chunk);
    ecs.push(remainder(chunk, gen));
  }
  const out: number[] = [];
  for (let i = 0; i < Math.max(...blocks); i++)
    for (const c of chunks) if (i < c.length) out.push(c[i]);
  for (let i = 0; i < ec; i++) for (const e of ecs) out.push(e[i]);
  return out;
}

function bch(value: number, poly: number, shift: number): number {
  let rem = value << shift;
  const top = 31 - Math.clz32(poly);
  for (let i = 31 - Math.clz32(value) + shift; i >= top; i--) {
    if ((rem >> i) & 1) rem ^= poly << (i - top);
  }
  return rem;
}

class Matrix {
  size: number;
  m: Modules;
  fixed: boolean[][];

  constructor(public version: number) {
    this.size = version * 4 + 17;
    this.m = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.fixed = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }

  set(x: number, y: number, dark: boolean) {
    this.m[y][x] = dark;
    this.fixed[y][x] = true;
  }

  functions() {
    const s = this.size;
    for (let x = 0; x < s; x++) {
      this.set(x, 6, x % 2 === 0);
      this.set(6, x, x % 2 === 0);
    }
    for (const [cx, cy] of [
      [3, 3],
      [s - 4, 3],
      [3, s - 4],
    ]) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || x >= s || y < 0 || y >= s) continue;
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          this.set(x, y, d !== 2 && d !== 4);
        }
      }
    }
    const align = ALIGN[this.version] ?? [];
    for (const c of align) {
      for (const r of align) {
        if ((c === 6 && r === 6) || (c === 6 && r === s - 7) || (c === s - 7 && r === 6)) continue;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++)
            this.set(c + dx, r + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
    this.formatBits(0);
    if (this.version >= 7) {
      const bits = (this.version << 12) | bch(this.version, 0x1f25, 12);
      for (let i = 0; i < 18; i++) {
        const bit = ((bits >> i) & 1) === 1;
        const a = s - 11 + (i % 3);
        const b = Math.floor(i / 3);
        this.set(a, b, bit);
        this.set(b, a, bit);
      }
    }
  }

  formatBits(mask: number) {
    const data = (0b00 << 3) | mask; // level M is 00
    const bits = ((data << 10) | bch(data, 0x537, 10)) ^ 0x5412;
    const s = this.size;
    const bit = (i: number) => ((bits >> i) & 1) === 1;
    for (let i = 0; i < 6; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.set(s - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, s - 15 + i, bit(i));
    this.set(8, s - 8, true);
  }

  place(words: number[]) {
    const s = this.size;
    const total = words.length * 8;
    let i = 0;
    for (let right = s - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < s; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? s - 1 - vert : vert;
          if (!this.fixed[y][x] && i < total) {
            this.m[y][x] = ((words[i >> 3] >> (7 - (i & 7))) & 1) === 1;
            i++;
          }
        }
      }
    }
  }

  masked(mask: number): Modules {
    const rules: ((x: number, y: number) => boolean)[] = [
      (x, y) => (x + y) % 2 === 0,
      (_x, y) => y % 2 === 0,
      (x) => x % 3 === 0,
      (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
      (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
      (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
    ];
    const rule = rules[mask];
    const out = this.m.map((row) => [...row]);
    for (let y = 0; y < this.size; y++)
      for (let x = 0; x < this.size; x++)
        if (!this.fixed[y][x] && rule(x, y)) out[y][x] = !out[y][x];
    const saved = this.m;
    this.m = out;
    this.formatBits(mask);
    this.m = saved;
    return out;
  }
}

function penalty(m: Modules): number {
  const s = m.length;
  let score = 0;
  const columns = m[0].map((_, x) => m.map((row) => row[x]));
  for (const lines of [m, columns]) {
    for (const line of lines) {
      let run = 0;
      let prev: boolean | null = null;
      for (const v of [...line, null]) {
        if (v === prev) run++;
        else {
          if (run >= 5) score += run - 2;
          run = 1;
          prev = v;
        }
      }
      const bits = line.map((v) => (v ? '1' : '0')).join('');
      score += 40 * (count(bits, '10111010000') + count(bits, '00001011101'));
    }
  }
  for (let y = 0; y < s - 1; y++)
    for (let x = 0; x < s - 1; x++)
      if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1])
        score += 3;
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  score += 10 * Math.floor(Math.abs(dark * 20 - s * s * 10) / (s * s));
  return score;
}

// Non-overlapping occurrences, as Python's str.count.
function count(s: string, sub: string): number {
  let n = 0;
  for (let i = s.indexOf(sub); i !== -1; i = s.indexOf(sub, i + sub.length)) n++;
  return n;
}

export function qrModules(text: string): Modules | null {
  const data = new TextEncoder().encode(text);
  for (let version = 1; version <= 10; version++) {
    const words = codewords(data, version);
    if (!words) continue;
    const mx = new Matrix(version);
    mx.functions();
    mx.place(words);
    let best: Modules | null = null;
    let bestScore = Infinity;
    for (let k = 0; k < 8; k++) {
      const out = mx.masked(k);
      const score = penalty(out);
      if (score < bestScore) {
        best = out;
        bestScore = score;
      }
    }
    return best;
  }
  return null;
}
