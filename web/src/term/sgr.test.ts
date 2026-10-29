import { describe, expect, it } from 'vitest';
import { classes, linkTarget, parse, parseLine } from './sgr';

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

const OSC = (uri: string, label: string, end = '\x1b\\') =>
  `\x1b]8;;${uri}${end}${label}\x1b]8;;${end}`;

describe('osc 8', () => {
  it('puts the address on the label, with BEL or ST, with or without params', () => {
    const [a] = parse(`see ${OSC('https://example.com/x', 'docs')} now`);
    expect(a.map((s) => [s.text, s.href])).toEqual([
      ['see ', undefined],
      ['docs', 'https://example.com/x'],
      [' now', undefined],
    ]);
    const [b] = parse(`\x1b]8;id=7;https://example.com/y\x07label\x1b]8;;\x07.`);
    expect(b.map((s) => [s.text, s.href])).toEqual([
      ['label', 'https://example.com/y'],
      ['.', undefined],
    ]);
  });
  it('keeps the colours inside a label and the link across a reset', () => {
    const [l] = parse('\x1b]8;;https://example.com/z\x1b\\la\x1b[31mbel\x1b[0m!\x1b]8;;\x1b\\');
    expect(l.map((s) => [s.text, s.fg, s.href])).toEqual([
      ['la', undefined, 'https://example.com/z'],
      ['bel', 1, 'https://example.com/z'],
      ['!', undefined, 'https://example.com/z'],
    ]);
  });
  it('carries a link onto the next row and two links in one row apart', () => {
    const lines = parse('\x1b]8;;https://example.com/a\x1b\\one\ntwo\x1b]8;;\x1b\\ three');
    expect(lines[0][0]).toMatchObject({ text: 'one', href: 'https://example.com/a' });
    expect(lines[1][0]).toMatchObject({ text: 'two', href: 'https://example.com/a' });
    expect(lines[1][1]).toMatchObject({ text: ' three', href: undefined });
    const [l] = parse(`${OSC('https://example.com/1', 'x')}-${OSC('https://example.com/2', 'y')}`);
    expect(l.map((s) => [s.text, s.href])).toEqual([
      ['x', 'https://example.com/1'],
      ['-', undefined],
      ['y', 'https://example.com/2'],
    ]);
  });
  it('security: only http and https as the browser parses them', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'vbscript:x',
      ' https://example.com/space',
      'https://example.com/\x01ctl',
      'https://example.com/' + 'a'.repeat(2048),
      '//example.com/relative',
      '/path',
      '',
      'https://',
    ]) {
      expect(linkTarget(bad), bad).toBeUndefined();
      const [l] = parse(`${OSC(bad, 'label')}`);
      expect(l.map((s) => s.text).join('')).toBe('label');
      expect(
        l.every((s) => s.href === undefined),
        bad,
      ).toBe(true);
    }
    expect(linkTarget('https://example.com/ok?a=1#f')).toBe('https://example.com/ok?a=1#f');
    expect(linkTarget('http://example.com')).toBe('http://example.com');
  });
});
