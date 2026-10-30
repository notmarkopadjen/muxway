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
  dollar?: boolean; // sh, make, php: $name is a name
}

const words = (s: string) => new Set(s.split(' '));
const both = (s: string) => words(`${s} ${s.toUpperCase()}`);
// Lower, upper and capitalised, for languages that do not care.
const cased = (s: string) =>
  words(`${s} ${s.toUpperCase()} ${s.replace(/\b[a-z]/g, (c) => c.toUpperCase())}`);
const C_LINE = ['//'];
const C_BLOCK: [string, string][] = [['/*', '*/']];
const HASH = ['#'];
const NONE: [string, string][] = [];
const DQ = ['"', "'"];

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
    quotes: DQ,
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
    line: HASH,
    block: [
      ['"""', '"""'],
      ["'''", "'''"],
    ],
    quotes: DQ,
  },
  sh: {
    keywords: words(
      'if then else elif fi for while until do done case esac in function select return exit export local readonly set unset shift break continue true false',
    ),
    line: HASH,
    block: NONE,
    quotes: DQ,
    dollar: true,
  },
  json: { keywords: words('true false null'), line: [], block: NONE, quotes: ['"'], keys: true },
  yaml: {
    keywords: words('true false null yes no on off'),
    line: HASH,
    block: NONE,
    quotes: DQ,
    keys: true,
  },
  toml: { keywords: words('true false'), line: HASH, block: NONE, quotes: DQ, keys: true },
  ini: {
    keywords: words('true false yes no on off'),
    line: ['#', ';'],
    block: NONE,
    quotes: DQ,
    keys: true,
  },
  sql: {
    keywords: both(
      'select from where and or not in is null as join left right inner outer on group by order having limit offset insert into values update set delete create table drop alter index primary key unique default distinct union all case when then else end exists between like asc desc',
    ),
    line: ['--'],
    block: C_BLOCK,
    quotes: ["'", '"'],
  },
  css: { keywords: words('important'), line: [], block: C_BLOCK, quotes: DQ, keys: true },
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
    quotes: DQ,
  },
  kt: {
    keywords: words(
      'abstract as break by catch class companion const constructor continue data do else enum false final finally for fun if import in infix init inline interface internal is lateinit null object open operator out override package private protected public return sealed super suspend this throw true try typealias val var vararg when while',
    ),
    line: C_LINE,
    block: C_BLOCK,
    quotes: DQ,
  },
  c: {
    keywords: words(
      'auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false nullptr class namespace new delete public private protected template this throw try catch using virtual',
    ),
    line: C_LINE,
    block: C_BLOCK,
    quotes: DQ,
  },
  html: { keywords: new Set(), line: [], block: [['<!--', '-->']], quotes: DQ, tags: true },
  rb: {
    keywords: words(
      'alias and begin break case class def defined? do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield require attr_accessor attr_reader private public protected',
    ),
    line: HASH,
    block: [['=begin', '=end']],
    quotes: DQ,
  },
  php: {
    keywords: words(
      'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile extends final finally fn for foreach function global if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield true false null',
    ),
    line: ['//', '#'],
    block: C_BLOCK,
    quotes: DQ,
    dollar: true,
  },
  lua: {
    keywords: words(
      'and break do else elseif end false for function goto if in local nil not or repeat return then true until while',
    ),
    line: ['--'],
    block: [['--[[', ']]']],
    quotes: DQ,
  },
  pl: {
    keywords: words(
      'my our local sub if elsif else unless while until for foreach do last next redo return package use require no print printf die eq ne lt gt le ge and or not shift push pop splice',
    ),
    line: HASH,
    block: NONE,
    quotes: DQ,
    dollar: true,
  },
  r: {
    keywords: words(
      'if else repeat while function for in next break TRUE FALSE NULL Inf NaN NA library require return',
    ),
    line: HASH,
    block: NONE,
    quotes: DQ,
  },
  jl: {
    keywords: words(
      'abstract baremodule begin break catch const continue do else elseif end export false finally for function global if import in let local macro module mutable primitive quote return struct true try type using while',
    ),
    line: HASH,
    block: [['#=', '=#']],
    quotes: ['"'],
  },
  swift: {
    keywords: words(
      'associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private precedencegroup protocol public rethrows static struct subscript typealias var break case catch continue default defer do else fallthrough for guard if in repeat return throw switch where while as any await false is nil self Self super throws true try some',
    ),
    line: C_LINE,
    block: C_BLOCK,
    quotes: ['"'],
  },
  dart: {
    keywords: words(
      'abstract as assert async await break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for Function get hide if implements import in interface is late library mixin new null on operator part required rethrow return set show static super switch sync this throw true try typedef var void while with yield',
    ),
    line: C_LINE,
    block: C_BLOCK,
    quotes: DQ,
  },
  scala: {
    keywords: words(
      'abstract case catch class def do else extends false final finally for forSome if implicit import lazy match new null object override package private protected return sealed super this throw trait true try type val var while with yield given using enum then',
    ),
    line: C_LINE,
    block: C_BLOCK,
    quotes: ['"'],
  },
  groovy: {
    keywords: words(
      'abstract as assert boolean break byte case catch char class const continue def default do double else enum extends false final finally float for goto if implements import in instanceof int interface long native new null package private protected public return short static super switch synchronized this threadsafe throw throws transient true try void volatile while apply plugins dependencies implementation testImplementation android',
    ),
    line: C_LINE,
    block: C_BLOCK,
    quotes: DQ,
    dollar: true,
  },
  hs: {
    keywords: words(
      'case class data default deriving do else foreign if import in infix infixl infixr instance let module newtype of then type where forall qualified as hiding',
    ),
    line: ['--'],
    block: [['{-', '-}']],
    quotes: ['"'],
  },
  ex: {
    keywords: words(
      'after and case catch cond def defimpl defmacro defmodule defp defprotocol defstruct do else end false fn for if import in nil not or quote raise receive require rescue true try unless unquote use when with',
    ),
    line: HASH,
    block: NONE,
    quotes: DQ,
  },
  erl: {
    keywords: words(
      'after and andalso band begin bnot bor bsl bsr bxor case catch cond div end fun if let not of or orelse receive rem try when xor module export import record',
    ),
    line: ['%'],
    block: NONE,
    quotes: DQ,
  },
  ml: {
    keywords: words(
      'and as assert begin class constraint do done downto else end exception external false for fun function functor if in include inherit initializer lazy let match method module mutable new object of open or private rec sig struct then to true try type val virtual when while with abstract base default delegate elif extern finally global inline interface internal lazy member namespace null override return static use yield',
    ),
    line: C_LINE,
    block: [['(*', '*)']],
    quotes: ['"'],
  },
  vb: {
    keywords: cased(
      'addhandler addressof alias and andalso as boolean byref byte byval call case catch cbool cbyte cchar cdate cdbl cdec char cint class clng cobj const continue csbyte cshort csng cstr ctype cuint culng cushort date decimal declare default delegate dim directcast do double each else elseif end enum erase error event exit false finally for friend function get gettype getxmlnamespace global gosub goto handles if implements imports in inherits integer interface is isnot let lib like long loop me mod module mustinherit mustoverride mybase myclass namespace narrowing new next not nothing notinheritable notoverridable object of on operator option optional or orelse overloads overridable overrides paramarray partial private property protected public raiseevent readonly redim rem removehandler resume return sbyte select set shadows shared short single static step stop string structure sub synclock then throw to true try trycast typeof uinteger ulong ushort using variant wend when while widening with withevents writeonly xor',
    ),
    line: ["'"],
    block: NONE,
    quotes: ['"'],
  },
  ps1: {
    keywords: both(
      'begin break catch class continue data define do dynamicparam else elseif end enum exit filter finally for foreach from function hidden if in param process return static switch throw trap try until using var while true false null -eq -ne -gt -ge -lt -le -like -notlike -match -notmatch -and -or -not',
    ),
    line: HASH,
    block: [['<#', '#>']],
    quotes: DQ,
    dollar: true,
  },
  bat: {
    keywords: both(
      'echo set if else exist not errorlevel goto call exit for in do pause start setlocal endlocal shift cd copy del dir move md rd ren type off on',
    ),
    line: ['REM ', 'rem ', '::'],
    block: NONE,
    quotes: ['"'],
  },
  zig: {
    keywords: words(
      'align allowzero and anyframe anytype asm async await break catch comptime const continue defer else enum errdefer error export extern false fn for if inline noalias null or orelse packed pub resume return linksection struct suspend switch test threadlocal true try undefined union unreachable usingnamespace var volatile while',
    ),
    line: C_LINE,
    block: NONE,
    quotes: ['"'],
  },
  nim: {
    keywords: words(
      'addr and as asm bind block break case cast concept const continue converter defer discard distinct div do elif else end enum except export finally for from func if import in include interface is isnot iterator let macro method mixin mod nil not notin object of or out proc ptr raise ref return shl shr static template try tuple type using var when while xor yield true false',
    ),
    line: HASH,
    block: [['#[', ']#']],
    quotes: ['"'],
  },
  d: {
    keywords: words(
      'abstract alias align asm assert auto body bool break byte case cast catch char class const continue dchar debug default delegate delete deprecated do double else enum export extern false final finally float for foreach function goto if immutable import in inout int interface invariant is lazy long mixin module new nothrow null out override package pragma private protected public pure real ref return scope shared short static struct super switch synchronized template this throw true try typeof ubyte uint ulong union unittest ushort version void while with',
    ),
    line: C_LINE,
    block: C_BLOCK,
    quotes: DQ,
  },
  lisp: {
    keywords: words(
      'defn defn- def defmacro let let* fn if when cond do loop recur ns require import lambda define defun defvar defparameter setq progn case else true false nil',
    ),
    line: [';'],
    block: [['#|', '|#']],
    quotes: ['"'],
  },
  tex: {
    keywords: words(
      'begin end section subsection subsubsection chapter documentclass usepackage item',
    ),
    line: ['%'],
    block: NONE,
    quotes: [],
  },
  fortran: {
    keywords: cased(
      'program end subroutine function module use implicit none integer real double precision character logical complex dimension allocatable allocate deallocate do if then else elseif endif enddo call return contains type intent in out inout parameter print write read open close stop continue select case while',
    ),
    line: ['!'],
    block: NONE,
    quotes: DQ,
  },
  asm: {
    keywords: words(
      'section global extern db dw dd dq mov push pop call ret jmp je jne cmp add sub lea xor and or',
    ),
    line: [';', '#'],
    block: NONE,
    quotes: DQ,
  },
  make: {
    keywords: words(
      'ifeq ifneq ifdef ifndef else endif include define endef export unexport override vpath',
    ),
    line: HASH,
    block: NONE,
    quotes: DQ,
    keys: true,
    dollar: true,
  },
  dockerfile: {
    keywords: both(
      'from run cmd label maintainer expose env add copy entrypoint volume user workdir arg onbuild stopsignal healthcheck shell as',
    ),
    line: HASH,
    block: NONE,
    quotes: DQ,
    dollar: true,
  },
  cmake: {
    keywords: words(
      'cmake_minimum_required project add_executable add_library target_link_libraries target_include_directories include set option if else elseif endif foreach endforeach function endfunction macro endmacro message find_package install add_subdirectory ON OFF TRUE FALSE',
    ),
    line: HASH,
    block: NONE,
    quotes: ['"'],
    dollar: true,
  },
  proto: {
    keywords: words(
      'syntax package import option message enum service rpc returns repeated optional required oneof map reserved stream extend extensions true false double float int32 int64 uint32 uint64 sint32 sint64 fixed32 fixed64 sfixed32 sfixed64 bool string bytes',
    ),
    line: C_LINE,
    block: C_BLOCK,
    quotes: DQ,
  },
  graphql: {
    keywords: words(
      'query mutation subscription fragment on type interface union enum input scalar schema extend implements directive repeatable true false null',
    ),
    line: HASH,
    block: NONE,
    quotes: ['"'],
  },
  hcl: {
    keywords: words(
      'resource variable output module provider data locals terraform true false null for in if else each count depends_on',
    ),
    line: ['#', '//'],
    block: C_BLOCK,
    quotes: ['"'],
    keys: true,
  },
  nix: {
    keywords: words('let in rec with inherit if then else assert import true false null or'),
    line: HASH,
    block: C_BLOCK,
    quotes: ['"'],
    keys: true,
  },
  http: {
    keywords: words('GET POST PUT PATCH DELETE HEAD OPTIONS TRACE CONNECT HTTP'),
    line: ['#', '//'],
    block: NONE,
    quotes: ['"'],
    keys: true,
  },
};

const ALIASES: Record<string, string> = {
  javascript: 'js',
  jsx: 'js',
  mjs: 'js',
  cjs: 'js',
  coffee: 'js',
  sol: 'js',
  typescript: 'ts',
  tsx: 'ts',
  csharp: 'cs',
  csx: 'cs',
  golang: 'go',
  python: 'py',
  pyi: 'py',
  pyx: 'py',
  pxd: 'py',
  pxi: 'py',
  bash: 'sh',
  zsh: 'sh',
  shell: 'sh',
  fish: 'sh',
  awk: 'sh',
  yml: 'yaml',
  ics: 'yaml',
  rust: 'rs',
  kotlin: 'kt',
  kts: 'kt',
  cpp: 'c',
  cc: 'c',
  cxx: 'c',
  h: 'c',
  hpp: 'c',
  hh: 'c',
  hxx: 'c',
  inl: 'c',
  cu: 'c',
  cuh: 'c',
  m: 'c',
  mm: 'c',
  glsl: 'c',
  hlsl: 'c',
  vert: 'c',
  frag: 'c',
  htm: 'html',
  xhtml: 'html',
  xml: 'html',
  svg: 'html',
  xsd: 'html',
  xsl: 'html',
  xslt: 'html',
  dtd: 'html',
  plist: 'html',
  cshtml: 'html',
  razor: 'html',
  vue: 'html',
  svelte: 'html',
  astro: 'html',
  xaml: 'html',
  axaml: 'html',
  csproj: 'html',
  vbproj: 'html',
  fsproj: 'html',
  targets: 'html',
  props: 'html',
  nuspec: 'html',
  pubxml: 'html',
  resx: 'html',
  config: 'html',
  tpl: 'html',
  tmpl: 'html',
  mako: 'html',
  jinja: 'html',
  jinja2: 'html',
  j2: 'html',
  hbs: 'html',
  mustache: 'html',
  ejs: 'html',
  njk: 'html',
  liquid: 'html',
  scss: 'css',
  sass: 'css',
  less: 'css',
  styl: 'css',
  cfg: 'ini',
  conf: 'ini',
  properties: 'ini',
  service: 'ini',
  timer: 'ini',
  socket: 'ini',
  mount: 'ini',
  sln: 'ini',
  lock: 'toml',
  jsonl: 'json',
  ndjson: 'json',
  json5: 'json',
  jsonc: 'json',
  geojson: 'json',
  ipynb: 'json',
  map: 'json',
  webmanifest: 'json',
  ruby: 'rb',
  erb: 'rb',
  rake: 'rb',
  gemspec: 'rb',
  gemfile: 'rb',
  rakefile: 'rb',
  brewfile: 'rb',
  vagrantfile: 'rb',
  perl: 'pl',
  pm: 'pl',
  rmd: 'r',
  julia: 'jl',
  gradle: 'groovy',
  jenkinsfile: 'groovy',
  sbt: 'scala',
  haskell: 'hs',
  lhs: 'hs',
  elixir: 'ex',
  exs: 'ex',
  erlang: 'erl',
  hrl: 'erl',
  ocaml: 'ml',
  mli: 'ml',
  fs: 'ml',
  fsx: 'ml',
  fsi: 'ml',
  fsharp: 'ml',
  powershell: 'ps1',
  psm1: 'ps1',
  psd1: 'ps1',
  cmd: 'bat',
  batch: 'bat',
  cr: 'rb',
  v: 'go',
  elm: 'hs',
  clj: 'lisp',
  cljs: 'lisp',
  cljc: 'lisp',
  edn: 'lisp',
  el: 'lisp',
  scm: 'lisp',
  rkt: 'lisp',
  clojure: 'lisp',
  wat: 'lisp',
  latex: 'tex',
  bib: 'tex',
  f: 'fortran',
  f90: 'fortran',
  f95: 'fortran',
  f03: 'fortran',
  for: 'fortran',
  s: 'asm',
  mk: 'make',
  makefile: 'make',
  gnumakefile: 'make',
  docker: 'dockerfile',
  containerfile: 'dockerfile',
  tf: 'hcl',
  tfvars: 'hcl',
  terraform: 'hcl',
  gql: 'graphql',
  rest: 'http',
  protobuf: 'proto',
};

// The scanner for a language name or a file name, if there is one.
export function languageOf(name: string): string | undefined {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : base;
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
    if (lc && !(lc === '#' && l.dollar && i > 0 && text[i - 1] === '$')) {
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
    if (l.dollar && c === '$' && (text[i + 1] === '{' || text[i + 1] === '(')) {
      const close = text[i + 1] === '{' ? '}' : ')';
      const end = text.indexOf(close, i);
      const stop = end < 0 ? n : end + 1;
      push('name', text.slice(i, stop));
      i = stop;
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
      else if (l.dollar && c === '$') push('name', word);
      else push('text', word);
      i = j;
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
