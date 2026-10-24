import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fontFor, inner } from './measure';
import { classes, parse, type Span } from './sgr';

// Renders a pane's content. Lines that were not there a moment ago burn
// in; the view follows the bottom while the person has not scrolled up.
// With cols and rows given, the font is sized so the pane fills the box.
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
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [content, box]);
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
  return (
    <div
      className={`mx-screen${focused ? ' mx-focused' : ''}`}
      ref={box}
      data-testid={testId}
      data-font={font ? font.toFixed(1) : undefined}
      tabIndex={0}
      onClick={onClick}
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
