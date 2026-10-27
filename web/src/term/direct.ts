// Direct typing: a key pressed on the page goes to the pane as a terminal
// would send it. The mapper turns the browser's key event into one body
// of the input request, or nothing for a key the pane cannot take or the
// browser keeps; the backlog queues bodies per pane and coalesces them
// while one request is in flight, so a held key is a few counted requests
// rather than a storm.

export type Body = { text: string } | { key: string; count?: number };

// What the browser calls a key, and what the grammar calls it.
const NAMED: Record<string, string> = {
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'BSpace',
  Escape: 'Escape',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Home: 'Home',
  End: 'End',
  Insert: 'Insert',
  Delete: 'Delete',
};
// The function keys the browser keeps: reload, full screen, the tools.
const BROWSER_F = new Set(['F5', 'F11', 'F12']);
// A char the grammar takes with Ctrl or Alt.
const CHAR = /^[a-z0-9`\-=[\]\\',./]$/;

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
}

// The text's size as the hub measures it.
export const bytesOf = (s: string) => new TextEncoder().encode(s).length;
export const MAX_TEXT = 4096;
export const MAX_COUNT = 50;

// The body a key press becomes, or null when it is the browser's, a
// modifier alone, a key under composition, or one the grammar has no name
// for. `selected` says text is selected on the page: Ctrl+C then copies.
export function keyToBody(ev: KeyLike, selected = false): Body | null {
  if (ev.isComposing || ev.metaKey) return null;
  const C = ev.ctrlKey;
  const M = ev.altKey;
  const S = ev.shiftKey;
  if (ev.key.length === 1) {
    if (!C && !M) return { text: ev.key };
    if (ev.key === ' ') return { key: `${C ? 'C-' : ''}${M ? 'M-' : ''}${S ? 'S-' : ''}Space` };
    // Ctrl+Shift with a letter is the browser's: copy, paste, the tools.
    if (C && S) return null;
    const ch = ev.key.toLowerCase();
    if (!CHAR.test(ch)) return null;
    if (C && ch === 'c' && selected) return null;
    return { key: `${C ? 'C-' : ''}${M ? 'M-' : ''}${ch}` };
  }
  let name = NAMED[ev.key];
  if (!name && /^F([1-9]|1[0-2])$/.test(ev.key) && !BROWSER_F.has(ev.key)) name = ev.key;
  if (!name) return null;
  if (name === 'Tab' && S && !C && !M) return { key: 'BTab' };
  return { key: `${C ? 'C-' : ''}${M ? 'M-' : ''}${S ? 'S-' : ''}${name}` };
}

// Pasted text as the pane takes it: newlines as they are, a tab as two
// spaces, any other control character dropped.
export function pasteText(s: string): string {
  const out: string[] = [];
  for (const c of s.replace(/\r\n?/g, '\n').replace(/\t/g, '  ')) {
    const n = c.codePointAt(0) ?? 0;
    if ((n < 0x20 && n !== 0x0a) || n === 0x7f || (n >= 0x80 && n <= 0x9f)) continue;
    out.push(c);
  }
  return out.join('');
}

// The backlog of one pane: bodies sent one at a time, in order; what
// arrives while one is in flight waits, and a wait coalesces: text joins
// the text before it, a key equal to the key before it counts, where the
// host takes a count. A refused body is dropped and the next goes.
export class Backlog {
  private items: Body[] = [];
  private busy = false;
  constructor(
    private send: (b: Body) => Promise<unknown>,
    private repeats: () => boolean,
  ) {}
  push(b: Body) {
    const last = this.items[this.items.length - 1];
    if (last && 'text' in last && 'text' in b && bytesOf(last.text + b.text) <= MAX_TEXT)
      last.text += b.text;
    else if (
      last &&
      'key' in last &&
      'key' in b &&
      last.key === b.key &&
      this.repeats() &&
      (last.count ?? 1) + (b.count ?? 1) <= MAX_COUNT
    )
      last.count = (last.count ?? 1) + (b.count ?? 1);
    else this.items.push({ ...b });
    void this.pump();
  }
  get waiting() {
    return this.items.length;
  }
  private async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let b = this.items.shift(); b; b = this.items.shift()) {
        try {
          await this.send(b);
        } catch {
          // refused: the next goes
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
