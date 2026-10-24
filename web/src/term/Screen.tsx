import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fontFor, inner, measureCell } from './measure';
import { classes, parse, type Span } from './sgr';

// Renders a pane's content. Lines that were not there a moment ago burn
// in; the view follows the bottom while the person has not scrolled up.
// With cols and rows given, the font is sized so the pane fills the box.
// With onCell, a click on the pane's screen (its last `height` lines)
// reports the cell under the pointer, 1-based. With onWheel, the wheel
// over the screen's rows reports a notch per row of travel at that cell,
// up to three per event, one request at a time; over the history above
// them, and without onWheel, the box scrolls as any box.
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
  height,
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
  onWheel?: (up: boolean, x: number, y: number) => Promise<void> | void;
  height?: number;
  focused?: boolean;
  testId?: string;
}) {
  const lines = useMemo(() => parse(content), [content]);
  const prev = useRef<Set<string>>(new Set());
  const own = useRef<HTMLDivElement>(null);
  const box = boxRef ?? own;
  const [font, setFont] = useState<number | null>(null);
  const plain = useMemo(() => lines.map((l) => l.map((s) => s.text).join('')), [lines]);
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
  const cellAt = (target: EventTarget | null, clientX: number) => {
    if (!height) return null;
    const ln = (target as HTMLElement | null)?.closest?.('.ln');
    if (!ln || !ln.parentElement) return null;
    const i = Array.prototype.indexOf.call(ln.parentElement.children, ln);
    const y = i - (lines.length - height) + 1;
    if (y < 1) return null;
    const rect = ln.getBoundingClientRect();
    const c = measureCell();
    const x = Math.floor((clientX - rect.left) / (rect.height * (c.w / c.h))) + 1;
    return x >= 1 ? { x, y, row: rect.height } : null;
  };
  const click = (ev: React.MouseEvent<HTMLDivElement>) => {
    onClick?.();
    if (!onCell) return;
    const at = cellAt(ev.target, ev.clientX);
    if (at) onCell(at.x, at.y);
  };
  // Wheel notches queue behind the one in flight; a backlog past a few is
  // dropped rather than sent after the hand has stopped.
  const wheelRef = useRef(onWheel);
  wheelRef.current = onWheel;
  const travel = useRef(0);
  const queue = useRef<{ up: boolean; x: number; y: number }[]>([]);
  const busy = useRef(false);
  const pump = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      for (let n = queue.current.shift(); n; n = queue.current.shift())
        await wheelRef.current?.(n.up, n.x, n.y);
    } finally {
      busy.current = false;
    }
  };
  useEffect(() => {
    const el = box.current;
    if (!el || !onWheel) return;
    const onEvent = (ev: WheelEvent) => {
      const at = cellAt(ev.target, ev.clientX);
      if (!at) return;
      ev.preventDefault();
      const dy =
        ev.deltaMode === 1
          ? ev.deltaY * at.row
          : ev.deltaMode === 2
            ? ev.deltaY * el.clientHeight
            : ev.deltaY;
      travel.current += dy;
      let notches = Math.trunc(travel.current / at.row);
      if (Math.abs(notches) > 3) {
        notches = Math.sign(notches) * 3;
        travel.current = 0;
      } else travel.current -= notches * at.row;
      for (let i = 0; i < Math.abs(notches) && queue.current.length < 3; i++)
        queue.current.push({ up: notches < 0, x: at.x, y: at.y });
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
      tabIndex={0}
      onClick={click}
      onScroll={onScroll}
      style={font ? { fontSize: `${font}px` } : undefined}
    >
      <pre>
        {lines.map((spans, i) => (
          <div key={i} className={fresh.has(i) ? 'ln mx-burn' : 'ln'}>
            {spans.map((s, j) => (
              <SpanView key={j} s={s} />
            ))}
          </div>
        ))}
      </pre>
    </div>
  );
});
