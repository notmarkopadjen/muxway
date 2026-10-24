import { useEffect, useRef, useState } from 'react';
import type { Pane } from '../api/types';
import { describe } from '../term/describe';
import { tabName, useLens } from '../term/lens';
import { LensMark } from './Lens';
import { ClaudeMark } from './PaneTitle';

// The strip: one tab per pane, painted with its state. Open tabs are
// bordered, the focused one thick and bold, a hidden one dimmed.
export function Tabs({
  panes,
  open,
  focused,
  hidden = [],
  addable = false,
  onTab,
}: {
  panes: Pane[];
  open: string[];
  focused: string | null;
  hidden?: string[];
  addable?: boolean;
  onTab: (address: string, add: boolean) => void;
}) {
  const lens = useLens();
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    strip.current
      ?.querySelector('[data-focused]')
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [focused, panes.length]);
  // The strip hides its scrollbar: the wheel moves it sideways, and ‹ ›
  // appear at its ends while there is more than fits. Keys: ] and [ with one tile.
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const check = () => setMore(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    for (const c of el.children) ro.observe(c);
    return () => ro.disconnect();
  }, [panes, open]);
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      ev.preventDefault();
      el.scrollLeft += ev.deltaX + ev.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const page = (dir: number) => {
    const el = strip.current;
    if (el) el.scrollBy({ left: (dir * el.clientWidth) / 2, behavior: 'smooth' });
  };
  const rows: { address: string; pane?: Pane }[] = panes.map((p) => ({
    address: p.address,
    pane: p,
  }));
  for (const a of open) if (!rows.some((r) => r.address === a)) rows.push({ address: a });
  return (
    <div className="mx-strip">
      {more && (
        <button
          type="button"
          className="mx-strip-end"
          onClick={() => page(-1)}
          title="earlier tabs ([ shows the previous pane in a single tile)"
          data-testid="tabs-prev"
        >
          ‹
        </button>
      )}
      <div className="mx-tabs" ref={strip} data-testid="tabs">
        {rows.map(({ address, pane }) => {
          const st = pane ? lens.status(pane) : 'quiet';
          const isOpen = open.includes(address);
          const isHidden = hidden.includes(address);
          return (
            <button
              key={address}
              type="button"
              className="mx-tab mx-painted"
              data-testid="tab"
              data-address={address}
              data-open={isOpen ? '' : undefined}
              data-focused={address === focused ? '' : undefined}
              data-hidden={isHidden ? '' : undefined}
              data-state={st === 'quiet' ? undefined : st}
              onClick={(e) => onTab(address, e.shiftKey)}
              title={
                isHidden
                  ? `${address} · hidden here, click brings it back`
                  : addable && !isOpen
                    ? `${address} · Shift+click opens it beside`
                    : address
              }
            >
              {pane && describe(pane).agent === 'claude' && <ClaudeMark />}
              {st !== 'quiet' && <LensMark status={st} attention={pane?.attention} />}
              <span className="mx-tab-name">
                {pane ? tabName(pane) : address.split('/').slice(1).join('/')}
              </span>
            </button>
          );
        })}
      </div>
      {more && (
        <button
          type="button"
          className="mx-strip-end"
          onClick={() => page(1)}
          title="later tabs (] shows the next pane in a single tile)"
          data-testid="tabs-next"
        >
          ›
        </button>
      )}
    </div>
  );
}
