import { describe, expect, it } from 'vitest';
import { findLinks } from './links';

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
