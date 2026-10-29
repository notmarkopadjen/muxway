import { describe, expect, it } from 'vitest';
import { marks } from './Screen';
import { parse } from './sgr';

const line = (s: string) => {
  const [spans] = parse(s);
  return { spans, text: spans.map((x) => x.text).join('') };
};

describe('marks', () => {
  it('makes one mark of a named link, across its spans, before the text is searched', () => {
    const { spans, text } = line(
      'a \x1b]8;;https://example.com/n\x1b\\la\x1b[1mbel\x1b[0m\x1b]8;;\x1b\\ https://example.com/t',
    );
    expect(marks(spans, text, false, false)).toEqual([
      { start: 2, end: 7, href: 'https://example.com/n' },
      { start: 8, end: 29, href: 'https://example.com/t' },
    ]);
  });
  it('lets a named link win over an address inside its label', () => {
    const { spans, text } = line(
      '\x1b]8;;https://example.com/real\x1b\\https://example.com/shown\x1b]8;;\x1b\\',
    );
    expect(marks(spans, text, false, false)).toEqual([
      { start: 0, end: 25, href: 'https://example.com/real' },
    ]);
  });
  it('keeps two named links apart', () => {
    const { spans, text } = line(
      '\x1b]8;;https://example.com/1\x1b\\x\x1b]8;;\x1b\\\x1b]8;;https://example.com/2\x1b\\y\x1b]8;;\x1b\\',
    );
    expect(marks(spans, text, false, false)).toEqual([
      { start: 0, end: 1, href: 'https://example.com/1' },
      { start: 1, end: 2, href: 'https://example.com/2' },
    ]);
  });
});
