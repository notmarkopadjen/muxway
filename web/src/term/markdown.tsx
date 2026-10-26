import { Fragment, type ReactNode } from 'react';
import { languageOf, lines, tokenize } from './code';
import { findFiles, findLinks, findPaths } from './links';

// Markdown rendered to elements, never to HTML: headings, paragraphs,
// lists, quotes, fenced and indented code with its colours, tables,
// rules; inline code, emphasis, strong, strike, web links and the host's
// file paths. Anything else is the text it is. No tag in a file reaches
// the page.

export interface Links {
  onFile?: (name: string) => void;
  onPath?: (path: string) => void;
}

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'list'; ordered: boolean; items: Block[][] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'rule' };

const FENCE = /^(\s{0,3})(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

export function parse(src: string): Block[] {
  const ls = src.replace(/\r\n?/g, '\n').split('\n');
  return blocks(ls);
}

function blocks(ls: string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < ls.length) {
    const line = ls[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const f = FENCE.exec(line);
    if (f) {
      const fence = f[2];
      const body: string[] = [];
      let j = i + 1;
      while (j < ls.length && !ls[j].trim().startsWith(fence)) body.push(ls[j++]);
      out.push({ kind: 'code', lang: f[3].toLowerCase(), text: body.join('\n') });
      i = j + 1;
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      out.push({ kind: 'heading', level: h[1].length, text: h[2] });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      out.push({ kind: 'rule' });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < ls.length && QUOTE.test(ls[i])) inner.push(QUOTE.exec(ls[i++])![1]);
      out.push({ kind: 'quote', blocks: blocks(inner) });
      continue;
    }
    const it = ITEM.exec(line);
    if (it) {
      const indent = it[1].length;
      const ordered = /\d/.test(it[2]);
      const items: Block[][] = [];
      while (i < ls.length) {
        const m = ITEM.exec(ls[i]);
        if (!m || m[1].length !== indent || /\d/.test(m[2]) !== ordered) break;
        const own: string[] = [m[3]];
        i++;
        // The rows indented under the item belong to it, a nested list among them.
        while (i < ls.length) {
          const row = ls[i];
          if (!row.trim()) {
            const next = ls[i + 1];
            if (next !== undefined && next.trim() && leading(next) > indent) {
              own.push('');
              i++;
              continue;
            }
            break;
          }
          if (leading(row) <= indent) break;
          own.push(row.slice(Math.min(leading(row), indent + 2)));
          i++;
        }
        items.push(blocks(own));
      }
      out.push({ kind: 'list', ordered, items });
      continue;
    }
    if (line.includes('|') && i + 1 < ls.length && TABLE_SEP.test(ls[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < ls.length && ls[j].includes('|') && ls[j].trim()) rows.push(cells(ls[j++]));
      out.push({ kind: 'table', head, rows });
      i = j;
      continue;
    }
    if (/^ {4}|^\t/.test(line) && (out.length === 0 || out[out.length - 1].kind !== 'para')) {
      const body: string[] = [];
      while (i < ls.length && (/^ {4}|^\t/.test(ls[i]) || !ls[i].trim()))
        body.push(ls[i++].replace(/^ {4}|^\t/, ''));
      while (body.length && !body[body.length - 1].trim()) body.pop();
      out.push({ kind: 'code', lang: '', text: body.join('\n') });
      continue;
    }
    const para: string[] = [];
    while (
      i < ls.length &&
      ls[i].trim() &&
      !FENCE.test(ls[i]) &&
      !HEADING.test(ls[i]) &&
      !RULE.test(ls[i]) &&
      !QUOTE.test(ls[i]) &&
      !ITEM.test(ls[i])
    )
      para.push(ls[i++].trim());
    out.push({ kind: 'para', text: para.join('\n') });
  }
  return out;
}

const leading = (s: string) => s.length - s.trimStart().length;
const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

// Inline: code spans first, so nothing inside them is marked up; then
// strong, emphasis, strike, links; then the plain runs get their links.
const INLINE =
  /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*(?=\S)(.+?)(?<=\S)\*|_(?=\S)([^_]+?)(?<=\S)_|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function inline(text: string, links: Links, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  let k = key;
  for (const m of text.matchAll(INLINE)) {
    const start = m.index;
    if (start > at) out.push(...plain(text.slice(at, start), links, k++));
    if (m[2] !== undefined) out.push(<code key={k++}>{m[2].replace(/^ (.*) $/, '$1')}</code>);
    else if (m[3] !== undefined || m[4] !== undefined)
      out.push(<strong key={k++}>{inline(m[3] ?? m[4], links, k * 100)}</strong>);
    else if (m[5] !== undefined) out.push(<s key={k++}>{inline(m[5], links, k * 100)}</s>);
    else if (m[6] !== undefined || m[7] !== undefined)
      out.push(<em key={k++}>{inline(m[6] ?? m[7], links, k * 100)}</em>);
    else if (m[8] !== undefined) {
      const href = m[9];
      if (/^https?:\/\//i.test(href))
        out.push(
          <a key={k++} className="mx-link" href={href} target="_blank" rel="noopener noreferrer">
            {inline(m[8], links, k * 100)}
          </a>,
        );
      else out.push(<Fragment key={k++}>{inline(m[8], links, k * 100)}</Fragment>);
    }
    at = start + m[0].length;
  }
  if (at < text.length) out.push(...plain(text.slice(at), links, k++));
  return out;
}

// Plain text with the web addresses and the host's paths it holds as links.
function plain(text: string, links: Links, key: number): ReactNode[] {
  const marks: { start: number; end: number; node: (s: string) => ReactNode }[] = [];
  for (const [start, end, href] of findLinks(text))
    marks.push({
      start,
      end,
      node: (s) => (
        <a className="mx-link" href={href} target="_blank" rel="noopener noreferrer">
          {s}
        </a>
      ),
    });
  const free = (start: number, end: number) => !marks.some((m) => m.start < end && start < m.end);
  if (links.onFile)
    for (const [start, end, name] of findFiles(text))
      if (free(start, end))
        marks.push({
          start,
          end,
          node: (s) => (
            <a
              className="mx-link mx-file-link"
              href="#"
              onClick={(ev) => {
                ev.preventDefault();
                links.onFile?.(name);
              }}
            >
              {s}
            </a>
          ),
        });
  if (links.onPath)
    for (const [start, end, path] of findPaths(text))
      if (free(start, end))
        marks.push({
          start,
          end,
          node: (s) => (
            <a
              className="mx-link mx-path-link"
              href="#"
              onClick={(ev) => {
                ev.preventDefault();
                links.onPath?.(path);
              }}
            >
              {s}
            </a>
          ),
        });
  marks.sort((a, b) => a.start - b.start);
  const out: ReactNode[] = [];
  let at = 0;
  marks.forEach((m, j) => {
    if (m.start > at) out.push(text.slice(at, m.start));
    out.push(<Fragment key={`${key}-${j}`}>{m.node(text.slice(m.start, m.end))}</Fragment>);
    at = m.end;
  });
  if (at < text.length) out.push(text.slice(at));
  return out;
}

// Code with its colours, one element per run, lines kept.
export function Code({ lang, text }: { lang: string; text: string }) {
  const l = lang ? languageOf(lang) : undefined;
  const rows = lines(l ? tokenize(l, text) : [{ kind: 'text', text }]);
  return (
    <pre className="mx-code" data-lang={l}>
      {rows.map((row, i) => (
        <div key={i} className="ln">
          {row.map((r, j) =>
            r.kind === 'text' ? (
              r.text
            ) : (
              <span key={j} className={`k-${r.kind}`}>
                {r.text}
              </span>
            ),
          )}
        </div>
      ))}
    </pre>
  );
}

export function render(src: string, links: Links = {}): ReactNode {
  return <>{parse(src).map((b, i) => block(b, i, links))}</>;
}

function block(b: Block, i: number, links: Links): ReactNode {
  switch (b.kind) {
    case 'heading': {
      const H = `h${Math.min(6, b.level)}` as 'h1';
      return <H key={i}>{inline(b.text, links)}</H>;
    }
    case 'para':
      return <p key={i}>{inline(b.text, links)}</p>;
    case 'code':
      return <Code key={i} lang={b.lang} text={b.text} />;
    case 'quote':
      return <blockquote key={i}>{b.blocks.map((c, j) => block(c, j, links))}</blockquote>;
    case 'list': {
      const L = b.ordered ? 'ol' : 'ul';
      return (
        <L key={i}>
          {b.items.map((item, j) => (
            <li key={j}>
              {item.map((c, k) =>
                c.kind === 'para' ? (
                  <Fragment key={k}>{inline(c.text, links)}</Fragment>
                ) : (
                  block(c, k, links)
                ),
              )}
            </li>
          ))}
        </L>
      );
    }
    case 'table':
      return (
        <table key={i}>
          <thead>
            <tr>
              {b.head.map((c, j) => (
                <th key={j}>{inline(c, links)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r, j) => (
              <tr key={j}>
                {r.map((c, k) => (
                  <td key={k}>{inline(c, links)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case 'rule':
      return <hr key={i} />;
  }
}
