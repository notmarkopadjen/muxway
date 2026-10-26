import { describe, expect, it } from 'vitest';
import { languageOf, lines, tokenize } from './code';

const kinds = (lang: string, src: string) => tokenize(lang, src).map((r) => `${r.kind}:${r.text}`);

describe('tokenize', () => {
  it('tells comments, strings, numbers, keywords and names apart in JSON', () => {
    expect(kinds('json', '{"a": 1, "b": "x", "c": [true, null]}')).toEqual([
      'punct:{',
      'name:"a"',
      'punct::',
      'text: ',
      'number:1',
      'punct:,',
      'text: ',
      'name:"b"',
      'punct::',
      'text: ',
      'string:"x"',
      'punct:,',
      'text: ',
      'name:"c"',
      'punct::',
      'text: ',
      'punct:[',
      'keyword:true',
      'punct:,',
      'text: ',
      'keyword:null',
      'punct:]}',
    ]);
  });
  it('knows JavaScript, C#, Go and shell', () => {
    expect(kinds('js', 'const x = "a\\"b"; // note\nreturn 2.5')).toEqual([
      'keyword:const',
      'text: x ',
      'punct:=',
      'text: ',
      'string:"a\\"b"',
      'punct:;',
      'text: ',
      'comment:// note',
      'text:\n',
      'keyword:return',
      'text: ',
      'number:2.5',
    ]);
    expect(kinds('cs', 'public class A { /* c */ int n = 0; }')).toContain('comment:/* c */');
    expect(kinds('cs', 'public class A { }').slice(0, 3)).toEqual([
      'keyword:public',
      'text: ',
      'keyword:class',
    ]);
    expect(kinds('go', 'func main() { x := `raw`\n}')).toContain('string:`raw`');
    expect(kinds('sh', 'if [ -f "$HOME/x" ]; then echo $PATH # done\nfi')).toEqual(
      expect.arrayContaining([
        'keyword:if',
        'string:"$HOME/x"',
        'name:$PATH',
        'comment:# done',
        'keyword:fi',
      ]),
    );
  });
  it('colours tags and attributes in HTML and keys in YAML', () => {
    expect(kinds('html', '<a href="x">hi</a><!-- c -->')).toEqual([
      'punct:<',
      'keyword:a',
      'text: ',
      'name:href',
      'punct:=',
      'string:"x"',
      'punct:>',
      'text:hi',
      'punct:</',
      'keyword:a',
      'punct:>',
      'comment:<!-- c -->',
    ]);
    expect(kinds('yaml', 'name: muxway # the app\nports:\n  - 7600')).toEqual(
      expect.arrayContaining(['name:name', 'comment:# the app', 'name:ports', 'number:7600']),
    );
  });
  it('shows an unknown language plain and names scanners by file or fence', () => {
    expect(tokenize('cobol', 'MOVE A TO B')).toEqual([{ kind: 'text', text: 'MOVE A TO B' }]);
    expect(languageOf('x.ts')).toBe('ts');
    expect(languageOf('Program.cs')).toBe('cs');
    expect(languageOf('typescript')).toBe('ts');
    expect(languageOf('x.yml')).toBe('yaml');
    expect(languageOf('x.md')).toBeUndefined();
    expect(languageOf('cobol')).toBeUndefined();
  });
  it('cuts runs into lines', () => {
    expect(
      lines([
        { kind: 'comment', text: '/* a\nb */' },
        { kind: 'text', text: '\nx' },
      ]),
    ).toEqual([
      [{ kind: 'comment', text: '/* a' }],
      [{ kind: 'comment', text: 'b */' }],
      [{ kind: 'text', text: 'x' }],
    ]);
  });
});
