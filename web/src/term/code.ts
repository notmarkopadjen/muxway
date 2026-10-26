// Colours for code: a small scanner per language that tells comments,
// strings, numbers, keywords and names apart, nothing more. A language it
// does not know is shown plain. The fence's language in Markdown and a
// file's extension pick the scanner.

export type Kind = 'comment' | 'string' | 'number' | 'keyword' | 'name' | 'punct' | 'text';
export interface Run {
  kind: Kind;
  text: string;
}

interface Lang {
  keywords: Set<string>;
  line: string[]; // line comment starters
  block: [string, string][]; // block comment pairs
  quotes: string[]; // string delimiters
  // Words before a colon are keys (json, yaml); # starts a comment (sh, py, yaml, toml).
  keys?: boolean;
  tags?: boolean; // html: tags and attributes
}

const words = (s: string) => new Set(s.split(' '));
const C_LINE = ['//'];
const C_BLOCK: [string, string][] = [['/*', '*/']];

const LANGS: Record<string, Lang> = {
  js: {
    keywords: words(
      'async await break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while with yield',
    ),
    line: C_LINE,
    block: C_BLOCK,
    quotes: ['"', "'", '`'],
  },
  ts: {
    keywords: words(
      'abstract any as async await boolean break case catch class const continue declare default delete do else enum export extends false finally for from function if implements import in infer instanceof interface is keyof let namespace never new null number object of override private protected public readonly return satisfies static string super switch symbol this throw true try type typeof undefined unique unknown var void while with yield',
    ),
    line: C_LINE,
    block: C_BLOCK,
    quotes: ['"', "'", '`'],
  },
  cs: {
    keywords: words(
      'abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach get goto if implicit in init int interface internal is lock long namespace new null object operator out override params private protected public readonly record ref return sbyte sealed set short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile where while yield',
    ),
    line: C_LINE,
    block: C_BLOCK,
    quotes: ['"', "'"],
  },
  go: {
    keywords: words(
      'break case chan const continue default defer else fallthrough false for func go goto if import interface iota map nil package range return select struct switch true type var',
    ),
    line: C_LINE,
    block: C_BLOCK,
    quotes: ['"', '`', "'"],
  },
  py: {
    keywords: words(
      'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield self',
    ),
    line: ['#'],
    block: [
      ['"""', '"""'],
      ["'''", "'''"],
    ],
    quotes: ['"', "'"],
  },
  sh: {
    keywords: words(
      'if then else elif fi for while until do done case esac in function select return exit export local readonly set unset shift break continue true false',
    ),
    line: ['#'],
    block: [],
    quotes: ['"', "'"],
  },
  json: { keywords: words('true false null'), line: [], block: [], quotes: ['"'], keys: true },
  yaml: {
    keywords: words('true false null yes no on off'),
    line: ['#'],
    block: [],
    quotes: ['"', "'"],
    keys: true,
  },
  toml: { keywords: words('true false'), line: ['#'], block: [], quotes: ['"', "'"], keys: true },
  sql: {
    keywords: words(
      'select from where and or not in is null as join left right inner outer on group by order having limit offset insert into values update set delete create table drop alter index primary key unique default distinct union all case when then else end exists between like asc desc'.toUpperCase() +
        ' ' +
        'select from where and or not in is null as join left right inner outer on group by order having limit offset insert into values update set delete create table drop alter index primary key unique default distinct union all case when then else end exists between like asc desc',
    ),
    line: ['--'],
    block: C_BLOCK,
    quotes: ["'", '"'],
  },
  css: { keywords: words('important'), line: [], block: C_BLOCK, quotes: ['"', "'"], keys: true },
  rs: {
    keywords: words(
      'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
    ),
    line: C_LINE,
    block: C_BLOCK,
    quotes: ['"'],
  },
  java: {
    keywords: words(
      'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new null package private protected public return short static strictfp super switch synchronized this throw throws transient true false try void volatile while var record',
    ),
    line: C_LINE,
    block: C_BLOCK,
    quotes: ['"', "'"],
  },
  kt: {
    keywords: words(
      'abstract as break by catch class companion const constructor continue data do else enum false final finally for fun if import in infix init inline interface internal is lateinit null object open operator out override package private protected public return sealed super suspend this throw true try typealias val var vararg when while',
    ),
    line: C_LINE,
    block: C_BLOCK,
    quotes: ['"', "'"],
  },
  c: {
    keywords: words(
      'auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false nullptr class namespace new delete public private protected template this throw try catch using virtual',
    ),
    line: C_LINE,
    block: C_BLOCK,
    quotes: ['"', "'"],
  },
  html: { keywords: new Set(), line: [], block: [['<!--', '-->']], quotes: ['"', "'"], tags: true },
};

const ALIASES: Record<string, string> = {
  javascript: 'js',
  jsx: 'js',
  mjs: 'js',
  cjs: 'js',
  typescript: 'ts',
  tsx: 'ts',
  csharp: 'cs',
  golang: 'go',
  python: 'py',
  bash: 'sh',
  zsh: 'sh',
  shell: 'sh',
  fish: 'sh',
  yml: 'yaml',
  rust: 'rs',
  kotlin: 'kt',
  kts: 'kt',
  cpp: 'c',
  cc: 'c',
  h: 'c',
  hpp: 'c',
  htm: 'html',
  xml: 'html',
  svg: 'html',
  scss: 'css',
  less: 'css',
  ini: 'toml',
};

// The scanner for a language name or a file name, if there is one.
export function languageOf(name: string): string | undefined {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name;
  const key = ext.toLowerCase();
  const lang = ALIASES[key] ?? key;
  return lang in LANGS ? lang : undefined;
}

const IDENT_START = /[A-Za-z_$@]/;
const IDENT = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;

export function tokenize(lang: string, text: string): Run[] {
  const l = LANGS[lang];
  if (!l) return [{ kind: 'text', text }];
  const out: Run[] = [];
  const push = (kind: Kind, s: string) => {
    if (!s) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += s;
    else out.push({ kind, text: s });
  };
  let i = 0;
  const n = text.length;
  const startsWith = (s: string) => text.startsWith(s, i);
  // Inside an html tag: names are attributes, the first one the tag.
  let inTag = false;
  while (i < n) {
    const c = text[i];
    const b = l.block.find(([open]) => startsWith(open));
    if (b) {
      const end = text.indexOf(b[1], i + b[0].length);
      const stop = end < 0 ? n : end + b[1].length;
      push('comment', text.slice(i, stop));
      i = stop;
      continue;
    }
    const lc = l.line.find((s) => startsWith(s));
    if (lc && !(lc === '#' && lang === 'sh' && i > 0 && text[i - 1] === '$')) {
      const end = text.indexOf('\n', i);
      const stop = end < 0 ? n : end;
      push('comment', text.slice(i, stop));
      i = stop;
      continue;
    }
    if (
      l.quotes.includes(c) &&
      !(c === "'" && (lang === 'rs' || lang === 'go') && text[i + 2] !== "'")
    ) {
      let j = i + 1;
      while (j < n && text[j] !== c) {
        if (text[j] === '\\') j++;
        if (text[j] === '\n' && c !== '`') break;
        j++;
      }
      const stop = Math.min(n, j + 1);
      const s = text.slice(i, stop);
      // A quoted word before a colon is a key, not a value.
      const rest = text.slice(stop);
      push(l.keys && /^\s*:/.test(rest) ? 'name' : 'string', s);
      i = stop;
      continue;
    }
    if (l.tags) {
      if (c === '<') {
        const close = startsWith('</') || startsWith('<?') || startsWith('<!');
        push('punct', close ? text.slice(i, i + 2) : '<');
        i += close ? 2 : 1;
        let j = i;
        while (j < n && IDENT.test(text[j])) j++;
        push('keyword', text.slice(i, j));
        i = j;
        inTag = true;
        continue;
      }
      if (inTag && (c === '>' || startsWith('/>') || startsWith('?>'))) {
        const len = c === '>' ? 1 : 2;
        push('punct', text.slice(i, i + len));
        i += len;
        inTag = false;
        continue;
      }
      if (!inTag) {
        const next = text.indexOf('<', i);
        const stop = next < 0 ? n : next;
        push('text', text.slice(i, stop));
        i = stop;
        continue;
      }
    }
    if (DIGIT.test(c) || (c === '.' && DIGIT.test(text[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < n && /[0-9A-Za-z_.]/.test(text[j])) j++;
      push('number', text.slice(i, j));
      i = j;
      continue;
    }
    if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < n && (IDENT.test(text[j]) || (lang === 'css' && text[j] === '-'))) j++;
      const word = text.slice(i, j);
      const rest = text.slice(j);
      if (l.tags && inTag) push('name', word);
      else if (l.keywords.has(word)) push('keyword', word);
      else if (l.keys && /^\s*[:=]/.test(rest) && !/^\s*==/.test(rest)) push('name', word);
      else if (lang === 'sh' && c === '$') push('name', word);
      else push('text', word);
      i = j;
      continue;
    }
    if (lang === 'sh' && c === '$' && text[i + 1] === '{') {
      const end = text.indexOf('}', i);
      const stop = end < 0 ? n : end + 1;
      push('name', text.slice(i, stop));
      i = stop;
      continue;
    }
    if (/\s/.test(c)) push('text', c);
    else push('punct', c);
    i++;
  }
  return out;
}

// The runs of one text cut into lines, each line its own runs.
export function lines(runs: Run[]): Run[][] {
  const out: Run[][] = [[]];
  for (const r of runs) {
    const parts = r.text.split('\n');
    parts.forEach((p, k) => {
      if (k > 0) out.push([]);
      if (p) out[out.length - 1].push({ kind: r.kind, text: p });
    });
  }
  return out;
}
