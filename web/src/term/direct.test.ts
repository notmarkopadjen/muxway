import { describe, expect, it } from 'vitest';
import { Backlog, keyToBody, pasteText, type KeyLike } from './direct';

const k = (key: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

describe('keyToBody', () => {
  it('types printable keys as text, shifted or not', () => {
    expect(keyToBody(k('a'))).toEqual({ text: 'a' });
    expect(keyToBody(k('A', { shiftKey: true }))).toEqual({ text: 'A' });
    expect(keyToBody(k(' '))).toEqual({ text: ' ' });
    expect(keyToBody(k('é'))).toEqual({ text: 'é' });
    expect(keyToBody(k(':', { shiftKey: true }))).toEqual({ text: ':' });
  });
  it('names keys with their modifiers in the grammar order', () => {
    expect(keyToBody(k('Enter'))).toEqual({ key: 'Enter' });
    expect(keyToBody(k('Backspace'))).toEqual({ key: 'BSpace' });
    expect(keyToBody(k('Escape'))).toEqual({ key: 'Escape' });
    expect(keyToBody(k('ArrowUp', { ctrlKey: true, altKey: true, shiftKey: true }))).toEqual({
      key: 'C-M-S-Up',
    });
    expect(keyToBody(k('Tab', { shiftKey: true }))).toEqual({ key: 'BTab' });
    expect(keyToBody(k('Tab', { shiftKey: true, ctrlKey: true }))).toEqual({ key: 'C-S-Tab' });
    expect(keyToBody(k('F1'))).toEqual({ key: 'F1' });
    expect(keyToBody(k('F10', { shiftKey: true }))).toEqual({ key: 'S-F10' });
    expect(keyToBody(k('Delete'))).toEqual({ key: 'Delete' });
    expect(keyToBody(k(' ', { ctrlKey: true }))).toEqual({ key: 'C-Space' });
  });
  it('makes chords of Ctrl and Alt with the chars the grammar takes', () => {
    expect(keyToBody(k('c', { ctrlKey: true }))).toEqual({ key: 'C-c' });
    expect(keyToBody(k('x', { altKey: true }))).toEqual({ key: 'M-x' });
    expect(keyToBody(k('a', { ctrlKey: true, altKey: true }))).toEqual({ key: 'C-M-a' });
    expect(keyToBody(k('[', { ctrlKey: true }))).toEqual({ key: 'C-[' });
    expect(keyToBody(k('/', { ctrlKey: true }))).toEqual({ key: 'C-/' });
  });
  it('leaves the browser its keys and drops what the grammar lacks', () => {
    expect(keyToBody(k(';', { ctrlKey: true }))).toBeNull();
    expect(keyToBody(k('é', { ctrlKey: true }))).toBeNull();
    expect(keyToBody(k('C', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(keyToBody(k('V', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(keyToBody(k('v', { ctrlKey: true }))).toBeNull();
    expect(keyToBody(k('Insert', { shiftKey: true }))).toBeNull();
    expect(keyToBody(k('v', { ctrlKey: true, altKey: true }))).toEqual({ key: 'C-M-v' });
    expect(keyToBody(k('Insert', { ctrlKey: true }))).toEqual({ key: 'C-Insert' });
    expect(keyToBody(k('c', { ctrlKey: true }), true)).toBeNull();
    expect(keyToBody(k('c', { ctrlKey: true }), false)).toEqual({ key: 'C-c' });
    expect(keyToBody(k('t', { metaKey: true }))).toBeNull();
    for (const key of ['F5', 'F11', 'F12', 'F13', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock'])
      expect(keyToBody(k(key)), key).toBeNull();
    expect(keyToBody(k('Dead'))).toBeNull();
    expect(keyToBody(k('Process', { isComposing: true }))).toBeNull();
    expect(keyToBody(k('a', { isComposing: true }))).toBeNull();
    expect(keyToBody(k('Unidentified'))).toBeNull();
  });
});

describe('pasteText', () => {
  it('keeps newlines, widens tabs and drops the other control characters', () => {
    expect(pasteText('a\r\nb\rc\td\x07e\x1b[31m')).toBe('a\nb\nc  de[31m');
  });
});

describe('Backlog', () => {
  const sender = () => {
    const sent: unknown[] = [];
    let release: (() => void) | null = null;
    const send = (b: unknown) =>
      new Promise<void>((resolve) => {
        sent.push(b);
        release = resolve;
      });
    return { sent, send, next: () => release?.() };
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  it('sends the first at once and joins what waits', async () => {
    const s = sender();
    const q = new Backlog(s.send, () => true);
    q.push({ text: 'e' });
    expect(s.sent).toEqual([{ text: 'e' }]);
    q.push({ text: 'c' });
    q.push({ text: 'h' });
    q.push({ key: 'Enter' });
    q.push({ key: 'Down' });
    q.push({ key: 'Down' });
    q.push({ key: 'Down', count: 3 });
    q.push({ text: 'x' });
    expect(q.waiting).toBe(4);
    s.next();
    await tick();
    s.next();
    await tick();
    s.next();
    await tick();
    s.next();
    await tick();
    s.next();
    await tick();
    expect(s.sent).toEqual([
      { text: 'e' },
      { text: 'ch' },
      { key: 'Enter' },
      { key: 'Down', count: 5 },
      { text: 'x' },
    ]);
  });
  it('counts to fifty and no further, and not for a host without counts', async () => {
    const s = sender();
    const q = new Backlog(s.send, () => true);
    q.push({ key: 'a' });
    for (let i = 0; i < 60; i++) q.push({ key: 'Down' });
    expect(q.waiting).toBe(2);
    s.next();
    await tick();
    expect(s.sent[1]).toEqual({ key: 'Down', count: 50 });
    s.next();
    await tick();
    expect(s.sent[2]).toEqual({ key: 'Down', count: 10 });
    const t = sender();
    const old = new Backlog(t.send, () => false);
    old.push({ key: 'a' });
    old.push({ key: 'Down' });
    old.push({ key: 'Down' });
    expect(old.waiting).toBe(2);
  });
  it('keeps text under the limit and drops only a refused body', async () => {
    const s = sender();
    const q = new Backlog(s.send, () => true);
    q.push({ text: 'x' });
    q.push({ text: 'a'.repeat(4000) });
    q.push({ text: 'b'.repeat(100) });
    expect(q.waiting).toBe(2);
    const sent: unknown[] = [];
    const r = new Backlog(
      (b) => {
        sent.push(b);
        return 'key' in b ? Promise.reject(new Error('refused')) : Promise.resolve();
      },
      () => true,
    );
    r.push({ key: 'Enter' });
    r.push({ text: 'after' });
    await tick();
    expect(sent).toEqual([{ key: 'Enter' }, { text: 'after' }]);
  });
});
