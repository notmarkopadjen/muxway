// The keyboard: a big terminal board of the old kind, every key a terminal
// can carry, sent one click at a time. Keys are placed on a grid of quarter
// units; a press turns into text or a key name of the protocol's grammar.

export type Mod = 'C' | 'M' | 'S';
export type Latch = 'off' | 'once' | 'lock';

export type Act =
  | { t: 'char'; c: string; up: string }
  | { t: 'named'; name: string; shift?: boolean }
  | { t: 'kp'; kp: string; nav?: string }
  | { t: 'chord'; key: string }
  | { t: 'mod'; m: Mod }
  | { t: 'caps' }
  | { t: 'num' };

export interface Cap {
  id: string;
  label: string;
  // The shifted legend, drawn above.
  up?: string;
  title?: string;
  act: Act;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoardState {
  mods: Record<Mod, Latch>;
  caps: boolean;
  num: boolean;
}

export const fresh = (): BoardState => ({
  mods: { C: 'off', M: 'off', S: 'off' },
  caps: false,
  num: true,
});

// The names an agent took before the grammar; a host without `keys: 2`
// refuses the rest.
const OLD = new Set([
  'Enter',
  'Tab',
  'BTab',
  'BSpace',
  'Escape',
  'Space',
  'Up',
  'Down',
  'Left',
  'Right',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  'Insert',
  'Delete',
  'C-c',
  'C-d',
  'C-z',
  'C-l',
  'C-a',
  'C-e',
  'C-u',
  'C-k',
  'C-w',
  'C-r',
  'C-x',
  'C-n',
  'C-p',
  'C-f',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
]);

export type Body = { text: string } | { key: string };

const on = (l: Latch) => l !== 'off';

// What a press sends, and the board after it: a latched modifier lets go
// after one key, a locked one stays.
export function press(
  a: Act,
  s: BoardState,
  grammar: boolean,
): { send?: Body; refuse?: string; state: BoardState } {
  if (a.t === 'mod') {
    const l = s.mods[a.m];
    return { state: { ...s, mods: { ...s.mods, [a.m]: l === 'off' ? 'once' : 'off' } } };
  }
  if (a.t === 'caps') return { state: { ...s, caps: !s.caps } };
  if (a.t === 'num') return { state: { ...s, num: !s.num } };
  const C = on(s.mods.C);
  const M = on(s.mods.M);
  const S = on(s.mods.S);
  const after: BoardState = {
    ...s,
    mods: {
      C: s.mods.C === 'lock' ? 'lock' : 'off',
      M: s.mods.M === 'lock' ? 'lock' : 'off',
      S: s.mods.S === 'lock' ? 'lock' : 'off',
    },
  };
  const prefix = (shift: boolean) => `${C ? 'C-' : ''}${M ? 'M-' : ''}${shift ? 'S-' : ''}`;
  let send: Body;
  if (a.t === 'char') {
    if (C || M) {
      if (a.c === ';') return { refuse: 'Ctrl or Alt with ; cannot reach a pane', state: after };
      send = { key: prefix(false) + a.c };
    } else {
      const letter = /^[a-z]$/.test(a.c);
      send = { text: (letter ? S !== s.caps : S) ? a.up : a.c };
    }
  } else if (a.t === 'chord') {
    send = { key: a.key };
  } else {
    const name = a.t === 'kp' ? (s.num || !a.nav ? a.kp : a.nav) : a.name;
    const shift = S || (a.t === 'named' && !!a.shift);
    send = { key: name === 'Tab' && shift && !C && !M ? 'BTab' : prefix(shift) + name };
  }
  if (!grammar && 'key' in send && !OLD.has(send.key))
    return { refuse: "this host's agent is older and takes only the key row's keys", state: after };
  return { send, state: after };
}

// Whether a cap needs the grammar, to be dimmed on an older host.
export function needsGrammar(c: Cap): boolean {
  const a = c.act;
  if (a.t === 'mod') return a.m !== 'S';
  if (a.t === 'kp') return true;
  if (a.t === 'named') return !!a.shift;
  return false;
}

// The layout, in units of one key; everything is drawn on quarter units.
function row(y: number, x: number, keys: [string, Act, number?, string?][]): Cap[] {
  const out: Cap[] = [];
  for (const [label, act, w = 1, up] of keys) {
    if (label) out.push({ id: `${label}@${x},${y}`, label, up, act, x, y, w, h: 1 });
    x += w;
  }
  return out;
}

// A letter shows its capital; any other character shows both.
const ch = (c: string, up: string, w = 1): [string, Act, number, string] => [
  /^[a-z]$/.test(c) ? up : c,
  { t: 'char', c, up },
  w,
  /^[a-z]$/.test(c) ? '' : up,
];
const nm = (label: string, name: string, w = 1): [string, Act, number] => [
  label,
  { t: 'named', name },
  w,
];
const gap = (w: number): [string, Act, number] => ['', { t: 'caps' }, w];

// Columns: the command keys (2), a gap, the main block (15), a gap, the
// navigation keys (3), a gap, the keypad (4).
const L = 0;
const MAIN = 2.5;
const NAV = MAIN + 15.5;
const PAD = NAV + 3.5;
export const WIDTH = PAD + 4;
export const HEIGHT = 7.5;

const fkeys = (from: number) =>
  [0, 1, 2].flatMap((g) => [
    ...[0, 1, 2, 3].map((i): [string, Act, number] => {
      const n = from + g * 4 + i;
      return n > 12
        ? [`F${n}`, { t: 'named', name: `F${n - 12}`, shift: true }, 1]
        : nm(`F${n}`, `F${n}`);
    }),
    ...(g < 2 ? [gap(0.5)] : []),
  ]);

const chords: [string, string, string][] = [
  ['Attn', 'C-c', 'interrupt (Ctrl+C)'],
  ['Clr', 'C-l', 'clear the screen (Ctrl+L)'],
  ['EOF', 'C-d', 'end of input (Ctrl+D)'],
  ['Susp', 'C-z', 'suspend (Ctrl+Z)'],
  ['Kill', 'C-u', 'kill the line (Ctrl+U)'],
  ['Word', 'C-w', 'rub out a word (Ctrl+W)'],
  ['Home', 'C-a', 'start of the line (Ctrl+A)'],
  ['End', 'C-e', 'end of the line (Ctrl+E)'],
  ['Rev', 'C-r', 'search the history (Ctrl+R)'],
  ['Back', 'BTab', 'back tab (Shift+Tab)'],
];

const mod = (label: string, m: Mod, w: number): [string, Act, number] => [
  label,
  { t: 'mod', m },
  w,
];

export const CAPS: Cap[] = [
  ...row(0, MAIN + 2, fkeys(13)),
  ...row(1, MAIN, [nm('Esc', 'Escape'), gap(1), ...fkeys(1)]),
  ...chords.map(([label, key, title], i) => ({
    id: `${label}-cmd`,
    label,
    title,
    act: { t: 'chord', key } as Act,
    x: L + (i % 2),
    y: 2.5 + Math.floor(i / 2),
    w: 1,
    h: 1,
  })),
  ...row(2.5, MAIN, [
    ch('`', '~'),
    ch('1', '!'),
    ch('2', '@'),
    ch('3', '#'),
    ch('4', '$'),
    ch('5', '%'),
    ch('6', '^'),
    ch('7', '&'),
    ch('8', '*'),
    ch('9', '('),
    ch('0', ')'),
    ch('-', '_'),
    ch('=', '+'),
    nm('⌫', 'BSpace', 2),
  ]),
  ...row(3.5, MAIN, [
    nm('Tab ⇥', 'Tab', 1.5),
    ...[...'qwertyuiop'].map((c) => ch(c, c.toUpperCase())),
    ch('[', '{'),
    ch(']', '}'),
    ch('\\', '|', 1.5),
  ]),
  ...row(4.5, MAIN, [
    ['Caps', { t: 'caps' }, 1.75],
    ...[...'asdfghjkl'].map((c) => ch(c, c.toUpperCase())),
    ch(';', ':'),
    ch("'", '"'),
    nm('Enter ⏎', 'Enter', 2.25),
  ]),
  ...row(5.5, MAIN, [
    mod('⇧ Shift', 'S', 2.25),
    ...[...'zxcvbnm'].map((c) => ch(c, c.toUpperCase())),
    ch(',', '<'),
    ch('.', '>'),
    ch('/', '?'),
    mod('⇧ Shift', 'S', 2.75),
  ]),
  ...row(6.5, MAIN, [
    mod('Ctrl', 'C', 1.5),
    mod('Alt', 'M', 1.5),
    nm('Space', 'Space', 9),
    mod('Alt', 'M', 1.5),
    mod('Ctrl', 'C', 1.5),
  ]),
  ...row(2.5, NAV, [nm('Ins', 'Insert'), nm('Home', 'Home'), nm('PgUp', 'PageUp')]),
  ...row(3.5, NAV, [nm('Del', 'Delete'), nm('End', 'End'), nm('PgDn', 'PageDown')]),
  ...row(5.5, NAV + 1, [nm('↑', 'Up')]),
  ...row(6.5, NAV, [nm('←', 'Left'), nm('↓', 'Down'), nm('→', 'Right')]),
  ...row(2.5, PAD, [
    ['Num', { t: 'num' }, 1],
    ...(['/', '*', '-'] as const).map((k): [string, Act, number] => [
      k,
      { t: 'kp', kp: `KP${k}` },
      1,
    ]),
  ]),
  ...row(3.5, PAD, [kp('7', 'Home'), kp('8', 'Up'), kp('9', 'PageUp')]),
  ...row(4.5, PAD, [kp('4', 'Left'), kp('5'), kp('6', 'Right')]),
  ...row(5.5, PAD, [kp('1', 'End'), kp('2', 'Down'), kp('3', 'PageDown')]),
  ...row(6.5, PAD, [kp('0', 'Insert', 2), kp('.', 'Delete')]),
  { id: 'kp+', label: '+', act: { t: 'kp', kp: 'KP+' }, x: PAD + 3, y: 3.5, w: 1, h: 2 },
  { id: 'kpenter', label: 'Ent', act: { t: 'kp', kp: 'KPEnter' }, x: PAD + 3, y: 5.5, w: 1, h: 2 },
];

function kp(k: string, nav?: string, w = 1): [string, Act, number] {
  return [k, { t: 'kp', kp: `KP${k}`, nav }, w];
}
