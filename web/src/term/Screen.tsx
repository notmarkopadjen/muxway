import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { blockAt, blocks } from './blocks';
import { findFiles, findLinks, findPaths, isChoice } from './links';
import { fontFor, inner, measureCell } from './measure';
import { classes, parse, type Span } from './sgr';

// Renders a pane's content. Lines that were not there a moment ago burn
// in; the view follows the bottom while the person has not scrolled up.
// With cols and rows given, the font is sized so the pane fills the box.
// With onCell, a click on the pane's screen (its last `height` lines:
// the pane's rows less the blank ones the host left out) reports the
// cell under the pointer, 1-based; `bounds` is the pane's
// size as last listed: a click outside it, on a frame the host has since
// shrunk, reports nothing, and a wheel notch there turns at the nearest
// cell the pane has. With onWheel, the wheel
// over the screen's rows reports a notch per row of travel at that cell,
// up to three per event, one request at a time; over the history above
// them, and without onWheel, the box scrolls as any box. A web address in
// a line is a link that opens in a new tab; its click stays in the browser.
// With onFile, a path of the host's inbox is a link too, and its click
// names the file; with onPath, any path of a file the host previews.
// With onCopy, a block of the screen (a bar's rows, a bullet and its
// rows, a result) shows ⧉ at its first row under the pointer, and a
// click on it copies the block's text; with onPrompt, a click on the
// cursor's row (`cursorRow`, or the last row with text) is a wish to
// type there, after whatever the click did.
function SpanView({ s }: { s: Span }) {
  const style: Record<string, string> = {};
  if (typeof s.fg === 'string') style.color = s.fg;
  if (typeof s.bg === 'string') style.background = s.bg;
  return (
    <span className={classes(s) || undefined} style={Object.keys(style).length ? style : undefined}>
      {s.text}
    </span>
  );
}

// What a run of a line links to: a web address, a file of the inbox, or
// a path the host previews.
interface Mark {
  start: number;
  end: number;
  href?: string;
  file?: string;
  path?: string;
}

// The marks of a line in order: the links a program named (OSC 8) first,
// then the addresses found in the text where no such link is; a file name
// inside a web address is the address's, an inbox path is the inbox's
// before it is a path.
export function marks(spans: Span[], line: string, files: boolean, paths: boolean): Mark[] {
  const out: Mark[] = [];
  let at = 0;
  for (const s of spans) {
    const last = out[out.length - 1];
    if (s.href && last && last.href === s.href && last.end === at) last.end += s.text.length;
    else if (s.href) out.push({ start: at, end: at + s.text.length, href: s.href });
    at += s.text.length;
  }
  const free = (start: number, end: number) => !out.some((m) => m.start < end && start < m.end);
  for (const [start, end, href] of findLinks(line))
    if (free(start, end)) out.push({ start, end, href });
  if (files)
    for (const [start, end, file] of findFiles(line))
      if (free(start, end)) out.push({ start, end, file });
  if (paths)
    for (const [start, end, path] of findPaths(line))
      if (free(start, end)) out.push({ start, end, path });
  return out.sort((a, b) => a.start - b.start);
}

// A line's spans cut at the marks' bounds and grouped: a piece is one link
// or plain text between links, with the spans' colours as they were.
interface Piece {
  href?: string;
  file?: string;
  path?: string;
  spans: Span[];
}

function pieces(spans: Span[], links: Mark[]): Piece[] {
  if (!links.length) return [{ spans }];
  const out: Piece[] = [];
  let at = 0;
  let k = 0;
  for (const s of spans) {
    let text = s.text;
    while (text) {
      while (k < links.length && links[k].end <= at) k++;
      const l = links[k];
      const inside = l !== undefined && l.start <= at;
      const take = Math.min(l ? (inside ? l.end : l.start) - at : text.length, text.length);
      const href = inside ? l.href : undefined;
      const file = inside ? l.file : undefined;
      const path = inside ? l.path : undefined;
      const last = out[out.length - 1];
      const piece = { ...s, text: text.slice(0, take) };
      if (last && last.href === href && last.file === file && last.path === path)
        last.spans.push(piece);
      else out.push({ href, file, path, spans: [piece] });
      text = text.slice(take);
      at += take;
    }
  }
  return out;
}

// Whether a cell is one the pane has, when its size is known.
export function within(x: number, y: number, bounds?: { cols: number; rows: number }): boolean {
  return !bounds || (x <= bounds.cols && y <= bounds.rows);
}

// The nearest cell the pane has.
export function nearest(
  x: number,
  y: number,
  bounds?: { cols: number; rows: number },
): { x: number; y: number } {
  return bounds ? { x: Math.min(x, bounds.cols), y: Math.min(y, bounds.rows) } : { x, y };
}

// The browser opens the tab; the pane hears nothing, mouse mode or not.
const keep = (ev: React.MouseEvent) => ev.stopPropagation();

function LineView({
  pieces,
  onFile,
  onPath,
}: {
  pieces: Piece[];
  onFile?: (name: string) => void;
  onPath?: (path: string) => void;
}) {
  return pieces.map((p, j) =>
    p.file || p.path ? (
      <a
        key={j}
        className={`mx-link ${p.file ? 'mx-file-link' : 'mx-path-link'}`}
        href="#"
        data-file={p.file}
        data-path={p.path}
        onClick={(ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (p.file) onFile?.(p.file);
          else if (p.path) onPath?.(p.path);
        }}
      >
        {p.spans.map((s, k) => (
          <SpanView key={k} s={s} />
        ))}
      </a>
    ) : p.href ? (
      <a
        key={j}
        className="mx-link"
        href={p.href}
        title={p.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={keep}
      >
        {p.spans.map((s, k) => (
          <SpanView key={k} s={s} />
        ))}
      </a>
    ) : (
      <Fragment key={j}>
        {p.spans.map((s, k) => (
          <SpanView key={k} s={s} />
        ))}
      </Fragment>
    ),
  );
}

export const Screen = memo(function Screen({
  content,
  burn,
  cols,
  rows,
  scale = 1,
  boxRef,
  onClick,
  onCell,
  onWheel,
  onFile,
  onPath,
  onCopy,
  onPrompt,
  cursorRow,
  cursor,
  height,
  bounds,
  focused,
  testId = 'screen',
}: {
  content: string;
  burn: boolean;
  cols?: number;
  rows?: number;
  scale?: number;
  boxRef?: React.RefObject<HTMLDivElement | null>;
  onClick?: () => void;
  onCell?: (x: number, y: number) => void;
  onWheel?: (up: boolean, x: number, y: number, count: number) => Promise<void> | void;
  onFile?: (name: string) => void;
  onPath?: (path: string) => void;
  onCopy?: (rows: number) => void;
  onPrompt?: () => void;
  cursorRow?: number;
  // The cursor's cell, drawn as a block: where direct typing lands. On a
  // blank row below the text, which the host leaves out, it is drawn on
  // the last row shown, as the prompt row is.
  cursor?: { x: number; y: number };
  height?: number;
  bounds?: { cols: number; rows: number };
  focused?: boolean;
  testId?: string;
}) {
  const lines = useMemo(() => parse(content), [content]);
  const prev = useRef<Set<string>>(new Set());
  const own = useRef<HTMLDivElement>(null);
  const box = boxRef ?? own;
  const [font, setFont] = useState<number | null>(null);
  const plain = useMemo(() => lines.map((l) => l.map((s) => s.text).join('')), [lines]);
  const files = !!onFile;
  const paths = !!onPath;
  const linked = useMemo(
    () => lines.map((spans, i) => pieces(spans, marks(spans, plain[i], files, paths))),
    [lines, plain, files, paths],
  );
  // The blocks a click can copy, and the one under the pointer.
  const all = useMemo(() => (onCopy ? blocks(plain) : []), [plain, onCopy]);
  const [hover, setHover] = useState<number | null>(null);
  const rowOf = (target: EventTarget | null) => {
    const ln = (target as HTMLElement | null)?.closest?.('.ln');
    return ln && ln.parentElement
      ? Array.prototype.indexOf.call(ln.parentElement.children, ln)
      : -1;
  };
  const onMove = (ev: React.MouseEvent) => {
    if (!onCopy) return;
    const b = blockAt(all, rowOf(ev.target));
    setHover(b ? b.start : null);
  };
  const copy = (start: number) => {
    const b = blockAt(all, start);
    if (!b) return;
    void navigator.clipboard
      .writeText(b.text)
      .then(() => onCopy?.(b.end - b.start + 1))
      .catch(() => onCopy?.(0));
  };
  // The row the program waits on: the cursor's, or the last with text;
  // a cursor on a blank row below the text, which the host left out,
  // counts as the last row shown.
  const promptRow = (() => {
    if (!height) return undefined;
    if (cursorRow) return Math.min(cursorRow, height);
    for (let y = height; y >= 1; y--) if (plain[lines.length - height + y - 1]?.trim()) return y;
    return undefined;
  })();
  const fresh = new Set<number>();
  if (burn && prev.current.size) {
    plain.forEach((t, i) => {
      if (t.trim() && !prev.current.has(t)) fresh.add(i);
    });
  }
  useEffect(() => {
    prev.current = new Set(plain);
  }, [plain]);
  // The view follows the bottom until the person scrolls up, and again
  // once they scroll back down; new content and a new size keep it there.
  const pinned = useRef(true);
  const follow = () => {
    const el = box.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  };
  const onScroll = () => {
    const el = box.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };
  useLayoutEffect(follow, [content, font, box]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(follow);
    ro.observe(el);
    return () => ro.disconnect();
  });
  // Scale to the box when the pane's size is known.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !cols || !rows) {
      setFont(null);
      return;
    }
    const apply = () => {
      const { w, h } = inner(el);
      setFont(fontFor(cols, rows, w, h, scale));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cols, rows, scale, box]);
  // The cell under a point of the screen, or null above it.
  const cellAt = (target: EventTarget | null, clientX: number, clamp = false) => {
    if (!height) return null;
    const ln = (target as HTMLElement | null)?.closest?.('.ln');
    if (!ln || !ln.parentElement) return null;
    const i = Array.prototype.indexOf.call(ln.parentElement.children, ln);
    const y = i - (lines.length - height) + 1;
    if (y < 1) return null;
    const rect = ln.getBoundingClientRect();
    const c = measureCell();
    const x = Math.floor((clientX - rect.left) / (rect.height * (c.w / c.h))) + 1;
    if (x < 1) return null;
    if (clamp) return { ...nearest(x, y, bounds), row: rect.height };
    if (!within(x, y, bounds)) return null;
    return { x, y, row: rect.height };
  };
  const click = (ev: React.MouseEvent<HTMLDivElement>) => {
    onClick?.();
    if (onCell) {
      const at = cellAt(ev.target, ev.clientX);
      if (at) onCell(at.x, at.y);
    }
    if (onPrompt && promptRow && cellAt(ev.target, ev.clientX, true)?.y === promptRow) onPrompt();
  };
  // Wheel notches gather while one request is in flight and go as the
  // next, counted, so a long scroll is a few requests, not one per row.
  const wheelRef = useRef(onWheel);
  wheelRef.current = onWheel;
  const travel = useRef(0);
  const queue = useRef<{ up: boolean; x: number; y: number; count: number }[]>([]);
  const busy = useRef(false);
  const pump = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      for (let n = queue.current.shift(); n; n = queue.current.shift())
        await wheelRef.current?.(n.up, n.x, n.y, n.count);
    } finally {
      busy.current = false;
    }
  };
  const MAX_NOTCHES = 50;
  useEffect(() => {
    const el = box.current;
    if (!el || !onWheel) return;
    const onEvent = (ev: WheelEvent) => {
      const at = cellAt(ev.target, ev.clientX, true);
      if (!at) return;
      ev.preventDefault();
      const dy =
        ev.deltaMode === 1
          ? ev.deltaY * at.row
          : ev.deltaMode === 2
            ? ev.deltaY * el.clientHeight
            : ev.deltaY;
      travel.current += dy;
      const notches = Math.trunc(travel.current / at.row);
      travel.current -= notches * at.row;
      if (!notches) return;
      const up = notches < 0;
      const last = queue.current[queue.current.length - 1];
      if (last && last.up === up && last.count < MAX_NOTCHES)
        last.count = Math.min(MAX_NOTCHES, last.count + Math.abs(notches));
      else if (queue.current.length < 4)
        queue.current.push({
          up,
          x: at.x,
          y: at.y,
          count: Math.min(MAX_NOTCHES, Math.abs(notches)),
        });
      void pump();
    };
    el.addEventListener('wheel', onEvent, { passive: false });
    return () => el.removeEventListener('wheel', onEvent);
  });
  return (
    <div
      className={`mx-screen${focused ? ' mx-focused' : ''}`}
      ref={box}
      data-testid={testId}
      data-font={font ? font.toFixed(1) : undefined}
      data-rows={height}
      data-prompt={promptRow}
      tabIndex={0}
      onClick={click}
      onMouseMove={onCopy ? onMove : undefined}
      onMouseLeave={onCopy ? () => setHover(null) : undefined}
      onScroll={onScroll}
      style={font ? { fontSize: `${font}px` } : undefined}
    >
      <pre>
        {linked.map((ps, i) => (
          <div
            key={i}
            className={
              'ln' +
              (fresh.has(i) ? ' mx-burn' : '') +
              (onCell && height && i >= lines.length - height && isChoice(plain[i])
                ? ' mx-choice'
                : '')
            }
          >
            {hover === i && (
              <button
                type="button"
                className="mx-copy"
                title="copy this block"
                data-testid="copy-block"
                onClick={(ev) => {
                  ev.stopPropagation();
                  copy(i);
                }}
              >
                ⧉
              </button>
            )}
            <LineView pieces={ps} onFile={onFile} onPath={onPath} />
            {cursor && height && i === lines.length - height + Math.min(cursor.y, height) - 1 && (
              <span
                className="mx-caret"
                data-testid="caret"
                aria-hidden
                style={{ left: `${cursor.x - 1}ch` }}
              />
            )}
          </div>
        ))}
      </pre>
    </div>
  );
});
