import { describe, expect, it } from 'vitest';
import { CAPS, fresh, HEIGHT, press, WIDTH, type Act, type BoardState } from './keyboard';

const cap = (label: string) => CAPS.find((c) => c.label === label)!.act;
const pad = (label: string) => CAPS.find((c) => c.label === label && c.act.t === 'kp')!.act;
const run = (acts: Act[], grammar = true, s: BoardState = fresh()) => {
  const sent: unknown[] = [];
  for (const a of acts) {
    const r = press(a, s, grammar);
    if (r.send) sent.push(r.send);
    if (r.refuse) sent.push({ refused: r.refuse });
    s = r.state;
  }
  return { sent, s };
};

describe('press', () => {
  it('types characters, shifted by Shift and letters by Caps', () => {
    expect(
      run([cap('A'), cap('⇧ Shift'), cap('A'), cap('1'), cap('⇧ Shift'), cap('1')]).sent,
    ).toEqual([{ text: 'a' }, { text: 'A' }, { text: '1' }, { text: '!' }]);
    expect(run([cap('Caps'), cap('A'), cap('1')]).sent).toEqual([{ text: 'A' }, { text: '1' }]);
  });
  it('sends chords as names, the modifiers in the grammar order, and lets go after one key', () => {
    expect(
      run([
        cap('Alt'),
        cap('Ctrl'),
        cap('Del'),
        cap('Del'),
        cap('⇧ Shift'),
        cap('↑'),
        cap('Ctrl'),
        cap('A'),
      ]).sent,
    ).toEqual([{ key: 'C-M-Delete' }, { key: 'Delete' }, { key: 'S-Up' }, { key: 'C-a' }]);
  });
  it('keeps a locked modifier', () => {
    const s = fresh();
    s.mods.C = 'lock';
    expect(run([cap('A'), cap('E')], true, s).sent).toEqual([{ key: 'C-a' }, { key: 'C-e' }]);
  });
  it('sends F13 to F24 as Shift+F1 to F12, Shift+Tab as BTab', () => {
    expect(run([cap('F13'), cap('F24'), cap('⇧ Shift'), cap('Tab ⇥')]).sent).toEqual([
      { key: 'S-F1' },
      { key: 'S-F12' },
      { key: 'BTab' },
    ]);
  });
  it('sends the keypad by Num Lock: digits, or the keys under them', () => {
    expect(run([pad('7'), cap('Num'), pad('7'), pad('Ent')]).sent.slice(-3)).toEqual([
      { key: 'KP7' },
      { key: 'Home' },
      { key: 'KPEnter' },
    ]);
  });
  it('refuses Ctrl or Alt with ;, and on an older host the names it would refuse', () => {
    expect(run([cap('Ctrl'), cap(';')]).sent).toEqual([{ refused: expect.stringMatching(/;/) }]);
    expect(run([cap('Ctrl'), cap('C'), cap('Alt'), cap('X'), cap('F13')], false).sent).toEqual([
      { key: 'C-c' },
      { refused: expect.stringMatching(/older/) },
      { refused: expect.stringMatching(/older/) },
    ]);
  });
  it('gives each command key its chord', () => {
    expect(run([cap('Attn'), cap('Back')]).sent).toEqual([{ key: 'C-c' }, { key: 'BTab' }]);
  });
});

describe('the layout', () => {
  it('has no two caps on the same place, and all inside the board', () => {
    const taken = new Set<string>();
    for (const c of CAPS) {
      expect(c.x + c.w).toBeLessThanOrEqual(WIDTH);
      expect(c.y + c.h).toBeLessThanOrEqual(HEIGHT);
      for (let x = c.x; x < c.x + c.w; x += 0.25)
        for (let y = c.y; y < c.y + c.h; y += 0.5) {
          const k = `${x},${y}`;
          expect(taken.has(k), `${c.label} over another cap at ${k}`).toBe(false);
          taken.add(k);
        }
    }
    expect(CAPS.length).toBeGreaterThan(110);
  });
});
