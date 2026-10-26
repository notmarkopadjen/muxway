import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parse, render } from './markdown';

const html = (src: string) => renderToStaticMarkup(<>{render(src)}</>);

describe('markdown', () => {
  it('parses every construct into blocks', () => {
    const src = [
      '# Title',
      '',
      'A paragraph with `code`, **strong**, *em* and ~~gone~~.',
      'Second row of it.',
      '',
      '- one',
      '- two',
      '  - nested',
      '',
      '1. first',
      '2. second',
      '',
      '> quoted',
      '> rows',
      '',
      '```js',
      'const x = 1;',
      '```',
      '',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '---',
      '',
      '    indented code',
    ].join('\n');
    expect(parse(src).map((b) => b.kind)).toEqual([
      'heading',
      'para',
      'list',
      'list',
      'quote',
      'code',
      'table',
      'rule',
      'code',
    ]);
    const h = html(src);
    expect(h).toContain('<h1>Title</h1>');
    expect(h).toContain('<code>code</code>');
    expect(h).toContain('<strong>strong</strong>');
    expect(h).toContain('<em>em</em>');
    expect(h).toContain('<s>gone</s>');
    expect(h).toContain('<ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul>');
    expect(h).toContain('<ol><li>first</li><li>second</li></ol>');
    expect(h).toContain('<blockquote><p>quoted\nrows</p></blockquote>');
    expect(h).toContain('<span class="k-keyword">const</span>');
    expect(h).toContain('<th>a</th>');
    expect(h).toContain('<hr/>');
    expect(h).toContain('indented code');
  });
  it('never passes HTML through, and links only the web', () => {
    const h = html(
      '<script>alert(1)</script> <img src=x onerror=alert(1)> [x](javascript:alert(1)) [ok](https://example.com/a) https://example.com/b',
    );
    expect(h).not.toContain('<script');
    expect(h).not.toContain('<img');
    expect(h).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(h).not.toContain('javascript:');
    expect(h).toContain('href="https://example.com/a"');
    expect(h).toContain('href="https://example.com/b"');
    expect(h).toContain('rel="noopener noreferrer"');
  });
  it('links the host files and paths it is given', () => {
    const h = renderToStaticMarkup(
      <>
        {render('see docs/plans/a.md and /tmp/20261025-102235-56fwge.png', {
          onFile: () => {},
          onPath: () => {},
        })}
      </>,
    );
    expect(h).toContain('class="mx-link mx-path-link"');
    expect(h).toContain('class="mx-link mx-file-link"');
    const none = renderToStaticMarkup(<>{render('see docs/plans/a.md')}</>);
    expect(none).not.toContain('mx-path-link');
  });
});
