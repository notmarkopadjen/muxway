import { useEffect, useRef, useState } from 'react';
import type { Pane } from '../api/types';
import { describe } from '../term/describe';
import { tabName, useLens } from '../term/lens';
import { LensMark } from './Lens';
import { AgentMark } from './PaneTitle';
import { ChainMark } from './TalkMark';

// The strip: one tab per pane, painted with its state. Open tabs are
// bordered, the focused one thick and bold, a hidden one dimmed. With
// `reorder` a tab can be dragged along the strip: a mark shows on the
// nearer edge of the tab under the pointer, and the drop puts it there.
export function Tabs({
  panes,
  open,
  focused,
  hidden = [],
  addable = false,
  onTab,
  onZoom,
  reorder,
}: {
  panes: Pane[];
  open: string[];
  focused: string | null;
  hidden?: string[];
  addable?: boolean;
  onTab: (address: string, add: boolean) => void;
  onZoom?: (address: string) => void;
  reorder?: (dragged: string, before: string | null) => void;
}) {
  const lens = useLens();
  const strip = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [mark, setMark] = useState<{ address: string; side: 'before' | 'after' } | null>(null);
  const endDrag = () => {
    setDragging(null);
    setMark(null);
  };
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
  const after = (address: string) =>
    rows[rows.findIndex((r) => r.address === address) + 1]?.address ?? null;
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
      <div
        className="mx-tabs"
        ref={strip}
        data-testid="tabs"
        onDragOver={
          reorder && dragging
            ? (e) => {
                // The space after the last tab: the drop goes last.
                if (e.target !== e.currentTarget) return;
                e.preventDefault();
                setMark({ address: rows[rows.length - 1].address, side: 'after' });
              }
            : undefined
        }
        onDrop={
          reorder && dragging
            ? (e) => {
                e.preventDefault();
                if (mark)
                  reorder(dragging, mark.side === 'before' ? mark.address : after(mark.address));
                endDrag();
              }
            : undefined
        }
        onDragLeave={(e) => {
          if (!strip.current?.contains(e.relatedTarget as Node | null)) setMark(null);
        }}
      >
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
              data-dragging={dragging === address ? '' : undefined}
              data-drop={mark?.address === address ? mark.side : undefined}
              draggable={!!reorder}
              onDragStart={
                reorder &&
                ((e) => {
                  e.dataTransfer.setData('text/plain', '');
                  e.dataTransfer.effectAllowed = 'move';
                  setDragging(address);
                })
              }
              onDragEnd={reorder && endDrag}
              onDragOver={
                reorder && dragging
                  ? (e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      const r = e.currentTarget.getBoundingClientRect();
                      const side = e.clientX < r.left + r.width / 2 ? 'before' : 'after';
                      if (mark?.address !== address || mark.side !== side)
                        setMark({ address, side });
                    }
                  : undefined
              }
              onClick={(e) => onTab(address, e.shiftKey)}
              onDoubleClick={onZoom && (() => onZoom(address))}
              title={
                (isHidden
                  ? `${address} · hidden here, click brings it back`
                  : addable && !isOpen
                    ? `${address} · Shift+click opens it beside`
                    : address) + (reorder ? ' · drag along the strip to reorder' : '')
              }
            >
              {pane && <AgentMark agent={describe(pane).agent} />}
              {pane?.talk?.length ? <ChainMark /> : null}
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
