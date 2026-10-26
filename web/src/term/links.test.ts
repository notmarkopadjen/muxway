import { describe, expect, it } from 'vitest';
import { findFiles, findLinks, isChoice, isImage } from './links';

describe('findLinks', () => {
  it('finds http and https runs with their positions', () => {
    expect(findLinks('see https://example.com/a?b=1 and http://example.org/x#y now')).toEqual([
      [4, 29, 'https://example.com/a?b=1'],
      [34, 56, 'http://example.org/x#y'],
    ]);
    expect(findLinks('HTTPS://EXAMPLE.COM/Up')).toEqual([[0, 22, 'HTTPS://EXAMPLE.COM/Up']]);
  });
  it('admits no other scheme', () => {
    for (const s of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'ftp://example.com/f',
      'file:///etc/passwd',
      'mailto:alice@example.com',
      'https:// example.com',
      'https://',
      'https://.',
      'see http:/example.com and https:example.com',
    ])
      expect(findLinks(s), s).toEqual([]);
  });
  it('leaves the sentence its punctuation and its brackets', () => {
    expect(findLinks('(https://example.com/x)')[0][2]).toBe('https://example.com/x');
    expect(findLinks('https://example.com/y.')[0][2]).toBe('https://example.com/y');
    expect(
      findLinks('at https://example.com/z, then https://example.com/w;').map((l) => l[2]),
    ).toEqual(['https://example.com/z', 'https://example.com/w']);
    expect(findLinks('<https://example.com/v>')[0][2]).toBe('https://example.com/v');
    expect(findLinks('"https://example.com/q","https://example.com/r"').map((l) => l[2])).toEqual([
      'https://example.com/q',
      'https://example.com/r',
    ]);
    expect(findLinks('`https://example.com/t`')[0][2]).toBe('https://example.com/t');
    expect(findLinks("'https://example.com/s'.")[0][2]).toBe('https://example.com/s');
    expect(findLinks('https://example.com/?a=1)).')[0][2]).toBe('https://example.com/?a=1');
  });
  it('keeps a bracket the address opened', () => {
    expect(findLinks('https://example.com/a_(b)')[0][2]).toBe('https://example.com/a_(b)');
    expect(findLinks('(https://example.com/a_(b))')[0][2]).toBe('https://example.com/a_(b)');
    expect(findLinks('http://[2001:db8::1]')[0][2]).toBe('http://[2001:db8::1]');
    expect(findLinks('http://[2001:db8::1]/p.')[0][2]).toBe('http://[2001:db8::1]/p');
    expect(findLinks('https://example.com/{x}]')[0][2]).toBe('https://example.com/{x}');
  });
  it('stops a run at blank space only, so a wrapped address is the row it is on', () => {
    expect(findLinks('https://example.com/long/path/that/is/cut')[0][2]).toBe(
      'https://example.com/long/path/that/is/cut',
    );
    expect(findLinks('https://example.com/a\tb')[0][2]).toBe('https://example.com/a');
    expect(findLinks('https://example.com/a b')[0][2]).toBe('https://example.com/a');
  });
});

describe('isChoice', () => {
  it('knows a numbered choice, with or without the pointer', () => {
    for (const s of [
      '❯ 1. Yes',
      '  2. Yes, and don’t ask again',
      '› 3) No',
      '1. first',
      '  10. tenth',
    ])
      expect(isChoice(s), s).toBe(true);
  });
  it('leaves other lines alone', () => {
    for (const s of [
      '',
      'Yes',
      '2026. a year',
      'v1.2.3 released',
      '  1.5 seconds',
      '$ ls',
      '123 apples',
    ])
      expect(isChoice(s), s).toBe(false);
  });
});

describe('findFiles', () => {
  const name = '20261025-102235-56fwge.png';
  it('finds an inbox path and names the file', () => {
    const line = `what is wrong in /home/alice/.config/muxway/agent/inbox/${name} ?`;
    expect(findFiles(line)).toEqual([[17, 17 + 39 + name.length, name]]);
    expect(findFiles(`see /tmp/${name}.`)).toEqual([[4, 9 + name.length, name]]);
    expect(findFiles(`(/tmp/${name})`)).toEqual([[1, 6 + name.length, name]]);
    expect(
      findFiles(`/a/20261025-102235-a1b2c3.json and /b/20261025-102235-d4e5f6.pdf`),
    ).toHaveLength(2);
  });
  it('wants a path and the exact name', () => {
    for (const s of [
      name,
      `/tmp/${name}.exe`,
      `/tmp/${name}x`,
      `/tmp/${name}_old`,
      `/tmp/x${name}`,
      '/tmp/20261025-102235-56fwg.png',
      '/tmp/20261025-102235-56fwge.PNG',
      '/tmp/20261025-102235-56fwge.svg',
      '/tmp/20261025-102235-56fwge',
    ])
      expect(findFiles(s), s).toEqual([]);
  });
  it('knows an image from the rest', () => {
    expect(isImage(name)).toBe(true);
    expect(isImage('20261025-102235-56fwge.pdf')).toBe(false);
    expect(isImage('20261025-102235-56fwge.json')).toBe(false);
  });
});
