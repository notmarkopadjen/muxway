import { describe, expect, it } from 'vitest';
import { classes, parse, parseLine } from './sgr';

describe('sgr', () => {
  it('splits colours into spans', () => {
    const [line] = parse('a\x1b[31mred\x1b[0m b');
    expect(line.map((s) => [s.text, s.fg])).toEqual([
      ['a', undefined],
      ['red', 1],
      [' b', undefined],
    ]);
  });
  it('carries state across lines and resets', () => {
    const lines = parse('\x1b[1;32mone\ntwo\x1b[0m\nthree');
    expect(lines[1][0]).toMatchObject({ text: 'two', bold: true, fg: 2 });
    expect(lines[2][0]).toMatchObject({ text: 'three', bold: false, fg: undefined });
  });
  it('maps bright, 256 and truecolor', () => {
    const [l] = parse('\x1b[91ma\x1b[38;5;196mb\x1b[48;2;1;2;3mc');
    expect(l[0].fg).toBe(9);
    expect(l[1].fg).toBe('rgb(255,0,0)');
    expect(l[2].bg).toBe('rgb(1,2,3)');
  });
  it('drops other sequences and control characters', () => {
    const [l] = parse('x\x1b[2Jy\x1b]0;title\x07z\x1b(B\x07w');
    expect(l.map((s) => s.text).join('')).toBe('xyzw');
  });
  it('survives a split sequence', () => {
    const { spans } = parseLine('ok\x1b[3');
    expect(spans.map((s) => s.text).join('')).toBe('ok[3');
  });
  it('never emits markup', () => {
    const [l] = parse('<script>alert(1)</script>\x1b[7m<img onerror=x>');
    expect(l.map((s) => s.text).join('')).toBe('<script>alert(1)</script><img onerror=x>');
    expect(classes(l[1])).toBe('sgr-i');
  });
});
