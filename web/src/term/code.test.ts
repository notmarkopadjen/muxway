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
    expect(languageOf('src/Makefile')).toBe('make');
    expect(languageOf('Dockerfile')).toBe('dockerfile');
    expect(languageOf('Views/Index.cshtml')).toBe('html');
    expect(languageOf('main.tf')).toBe('hcl');
    expect(languageOf('run.ps1')).toBe('ps1');
    expect(languageOf('a.ipynb')).toBe('json');
    expect(languageOf('x.csv')).toBeUndefined();
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

  it('knows the languages a project adds: ruby, powershell, make, dockerfile, ini, batch, vb', () => {
    expect(kinds('rb', "def go # run\n  puts 'hi'\nend")).toEqual([
      'keyword:def',
      'text: go ',
      'comment:# run',
      'text:\n  puts ',
      "string:'hi'",
      'text:\n',
      'keyword:end',
    ]);
    expect(kinds('ps1', '$x = Get-Item "a" # c')).toEqual([
      'name:$x',
      'text: ',
      'punct:=',
      'text: Get',
      'punct:-',
      'text:Item ',
      'string:"a"',
      'text: ',
      'comment:# c',
    ]);
    expect(kinds('make', 'all: $(SRC)\n\t@echo ${X} # done')).toEqual([
      'name:all',
      'punct::',
      'text: ',
      'name:$(SRC)',
      'text:\n\t@echo ',
      'name:${X}',
      'text: ',
      'comment:# done',
    ]);
    expect(kinds('dockerfile', 'FROM alpine\nRUN echo $HOME')).toEqual([
      'keyword:FROM',
      'text: alpine\n',
      'keyword:RUN',
      'text: echo ',
      'name:$HOME',
    ]);
    expect(kinds('ini', '; c\n[unit]\nkey = 1')).toEqual([
      'comment:; c',
      'text:\n',
      'punct:[',
      'text:unit',
      'punct:]',
      'text:\n',
      'name:key',
      'text: ',
      'punct:=',
      'text: ',
      'number:1',
    ]);
    expect(kinds('bat', 'REM note\necho off')).toEqual([
      'comment:REM note',
      'text:\n',
      'keyword:echo',
      'text: ',
      'keyword:off',
    ]);
    expect(kinds('vb', '\' c\nDim s = "x"')).toEqual([
      "comment:' c",
      'text:\n',
      'keyword:Dim',
      'text: s ',
      'punct:=',
      'text: ',
      'string:"x"',
    ]);
  });
});
