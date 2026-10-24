import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAllPanes, useInput, usePane, usePaneCached } from '../api/queries';
import type { Key, Mouse, Pane, PaneContent } from '../api/types';
import { Divider } from '../components/Divider';
import { InputPanel } from '../components/InputPanel';
import { LensMark } from '../components/Lens';
import { PaneTitle } from '../components/PaneTitle';
import { Tabs } from '../components/Tabs';
import { useToast } from '../components/Toast';
import { noteChange, noteOwn, useLens } from '../term/lens';
import { Screen } from '../term/Screen';
import {
  close,
  defaultFor,
  drag,
  equal,
  MAX_TILES,
  next,
  options,
  parseRoute,
  replace,
  routeFor,
  swap,
  tree,
  type Arrangement,
  type TileNode,
  type Weights,
} from '../term/tiles';
import { releaseKept, useFit } from '../term/useFit';
import { setHeading } from '../shell/heading';

// How long a tile shows its last frame while the host catches up with a fit.
const HOLD_FRAME_MS = 3000;

// The last settled frame of each pane, shown again when the pane comes
// back into a tile while the host catches up.
const frames = new Map<string, PaneContent>();

// Pane views open; the last one gone releases the panes kept fitted.
let views = 0;

// The pane view, as the Android client has it: a strip of every pane the
// token may read, painted with its state; one to four of them open as
// tiles in an arrangement of the browser's own; one input line and one
// key bar for the focused tile.

// A click or a wheel notch lands in the pane under the pointer, focused or not.
async function click(address: string, mouse: Mouse, refused: (why: string) => void) {
  try {
    noteOwn(address);
    await api<void>(`/v1/panes/${address}/input`, {
      method: 'POST',
      body: JSON.stringify({ mouse }),
    });
  } catch (err) {
    refused(err instanceof ApiError ? err.code : 'hub unreachable');
  }
}

interface TileProps {
  address: string;
  index: number;
  focused: boolean;
  several: boolean;
  fit: boolean | undefined;
  // Another tile of the same window carries the fit for it.
  held: boolean;
  // Alone in the view: the window is sized and the pane zoomed in it,
  // when it has siblings to be zoomed over.
  alone: boolean;
  zoomable: boolean;
  refitTick: number;
  dragging: string | null;
  onFocus: () => void;
  onClose: () => void;
  onFit: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onZoom: (p: Pane) => void;
  refused: (why: string) => void;
}

function Tile(props: TileProps) {
  const { address, focused, several, refitTick, dragging, alone, zoomable } = props;
  const pane = usePane(address, focused ? 1_000 : 2_000);
  const box = useRef<HTMLDivElement>(null);
  const p = pane.data?.pane;
  const writable = p?.mode === 'write';
  // Every writable tile opens with fit on, as a single pane does.
  const fit = props.fit ?? writable;
  const fitting = fit && writable && !props.held;
  const { size: fitted, refit } = useFit(
    address,
    fitting,
    box,
    alone ? 'window' : 'pane',
    undefined,
    alone && zoomable,
    {
      keep: true,
      inset: false,
      known: () => p && { cols: p.width, rows: p.height, zoomed: p.zoomed },
    },
  );
  // While a fit is in flight the host still answers at its old size; the
  // tile keeps showing the last frame it had rather than that one, for a
  // moment at most, so switching panes does not flash a smaller screen.
  const held = useRef<PaneContent | null>(frames.get(address) ?? null);
  const [, bump] = useState(0);
  const since = useRef(Date.now());
  useEffect(() => {
    since.current = Date.now();
    held.current = frames.get(address) ?? null;
    const t = window.setTimeout(() => bump((n) => n + 1), HOLD_FRAME_MS + 50);
    return () => window.clearTimeout(t);
  }, [address]);
  let shown = pane.data;
  if (fitting && shown) {
    const settled =
      !!fitted && shown.pane.width === fitted.cols && shown.pane.height === fitted.rows;
    if (settled || Date.now() - since.current > HOLD_FRAME_MS) {
      held.current = shown;
      if (settled) frames.set(address, shown);
    } else if (held.current) shown = held.current;
  }
  const sp = shown?.pane;
  useEffect(() => {
    if (refitTick) refit();
  }, [refitTick, refit]);
  // A change of content while the tile reads the pane counts as working,
  // unless it is the first read or the pane was just resized: that is the
  // reflow, not the program.
  const content = pane.data?.content;
  const size = p ? `${p.width}x${p.height}` : '';
  const seen = useRef<{ content: string; size: string } | null>(null);
  useEffect(() => {
    if (content === undefined) return;
    const prev = seen.current;
    if (prev && content !== prev.content && size === prev.size) noteChange(address);
    seen.current = { content, size };
  }, [content, size, address]);
  const lens = useLens();
  const st = p ? lens.status(p) : 'quiet';
  const [over, setOver] = useState(false);

  if (pane.isError) {
    const err = pane.error;
    const msg =
      err instanceof ApiError && err.status === 404
        ? 'no such pane, or not yours to see'
        : err instanceof ApiError && err.status === 503
          ? 'this host is offline'
          : 'the hub could not be reached';
    return (
      <div
        className="mx-tile mx-cell-gap"
        data-testid={several ? 'gap' : 'pane-error'}
        data-pane={address}
        data-several={several ? '' : undefined}
        onClick={props.onFocus}
      >
        <span className="mx-faint">
          {address}: {msg}
        </span>
        {several && (
          <button type="button" onClick={props.onClose} title="close this tile (x)">
            close
          </button>
        )}
      </div>
    );
  }
  return (
    <div
      className={`mx-tile${over ? ' mx-drop' : ''}`}
      data-testid="tile"
      data-pane={address}
      data-several={several ? '' : undefined}
      data-focused={focused ? '' : undefined}
      data-fit={writable ? (fit ? '1' : '0') : undefined}
      data-held={props.held ? '' : undefined}
      onDragOver={(e) => {
        if (dragging && dragging !== address) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        props.onDrop();
      }}
      onDoubleClick={() => p && props.onZoom(p)}
    >
      <div
        className="mx-tile-head mx-painted"
        data-state={st === 'quiet' ? undefined : st}
        onClick={props.onFocus}
        draggable={several}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', '');
          e.dataTransfer.effectAllowed = 'move';
          props.onDragStart();
        }}
        onDragEnd={props.onDragEnd}
        title={several ? 'drag onto another tile to swap' : undefined}
      >
        {p ? <PaneTitle pane={p} /> : <span>{address}</span>}
        {p && (
          <>
            <span className="mx-dim">
              {address} ·{' '}
              <span data-testid={focused ? 'pane-size' : undefined}>
                {p.width}×{p.height}
              </span>
            </span>
            <span className={`mx-mode ${p.mode}`}>{p.mode}</span>
            {props.held && writable && fit && (
              <span
                className="mx-warn"
                title="another tile of this window carries the fit"
                data-testid="held"
              >
                held
              </span>
            )}
            {st !== 'quiet' && (
              <span
                className={st === 'waiting' ? 'mx-attention' : 'mx-dim'}
                data-testid={st === 'waiting' && focused ? 'pane-attention' : undefined}
              >
                <LensMark status={st} attention={p.attention} withWord />
                {p.attention?.text ? `: ${p.attention.text}` : ''}
              </span>
            )}
          </>
        )}
        <span className="mx-spacer" />
        {several && (
          <button
            type="button"
            title="close this tile (x)"
            data-testid="close-tile"
            onClick={(e) => {
              e.stopPropagation();
              props.onClose();
            }}
          >
            ×
          </button>
        )}
      </div>
      <Screen
        content={shown?.content ?? ''}
        burn={!pane.isPlaceholderData}
        cols={fitting ? undefined : sp?.width}
        rows={fitting ? undefined : sp?.height}
        boxRef={box}
        focused={several && focused}
        onClick={props.onFocus}
        height={sp?.height}
        onCell={
          writable && p?.mouse
            ? (x, y) => void click(address, { button: 'left', x, y }, props.refused)
            : undefined
        }
        onWheel={
          writable && p?.mouse
            ? (up, x, y) =>
                click(address, { button: up ? 'wheelup' : 'wheeldown', x, y }, props.refused)
            : undefined
        }
        testId={focused ? 'screen' : 'cell-screen'}
      />
    </div>
  );
}

interface TreeProps {
  node: TileNode;
  weights: Weights;
  setWeights: (f: (w: Weights) => Weights) => void;
  tile: (index: number) => React.ReactNode;
}

function Tree(props: TreeProps) {
  const { node, weights, setWeights, tile } = props;
  const box = useRef<HTMLDivElement>(null);
  if (typeof node === 'number') return <>{tile(node)}</>;
  const n = node.children.length;
  const w = weights[node.key] ?? equal(n);
  const onDrag = (k: number) => (dx: number, dy: number) => {
    const el = box.current;
    if (!el) return;
    const size = node.kind === 'h' ? el.clientWidth : el.clientHeight;
    const delta = (node.kind === 'h' ? dx : dy) / (size || 1);
    setWeights((ws) => ({ ...ws, [node.key]: drag(ws[node.key] ?? equal(n), k, delta) }));
  };
  return (
    <div className={`mx-split mx-split-${node.kind}`} ref={box} data-testid="split">
      {node.children.map((c, i) => (
        <div
          key={i}
          className="mx-slot"
          style={{ flexBasis: `${w[i] * 100}%` }}
          data-fraction={w[i].toFixed(3)}
        >
          <Tree {...props} node={c} />
          {i < n - 1 && <Divider kind={node.kind} onDrag={onDrag(i)} />}
        </div>
      ))}
    </div>
  );
}

function Tiles({ addresses }: { addresses: string[] }) {
  const n = addresses.length;
  const several = n > 1;
  const navigate = useNavigate();
  const toast = useToast();
  const all = useAllPanes(true);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const index = Math.min(focusedIndex, n - 1);
  const focused = addresses[index];
  const focusedPane = usePaneCached(focused).data?.pane;
  const writable = focusedPane?.mode === 'write';
  const input = useInput(focused);
  const [layout, setLayout] = useState<Arrangement>(() =>
    defaultFor(window.innerWidth > window.innerHeight),
  );
  const [weights, setWeights] = useState<Weights>({});
  const [fit, setFit] = useState<Record<string, boolean>>({});
  const [refitTick, setRefitTick] = useState(0);
  const [dragging, setDragging] = useState<string | null>(null);
  const refused = useCallback(
    (why: string) => toast.push({ kind: 'refused', title: why }),
    [toast],
  );

  // A new count resets the arrangement to one that fits it.
  useEffect(() => {
    setLayout((l) =>
      options(n).includes(l) ? l : defaultFor(window.innerWidth > window.innerHeight),
    );
    setWeights({});
  }, [n]);
  useEffect(() => {
    setHeading({ pane: focusedPane, place: focused });
    return () => setHeading({ place: '' });
  }, [focusedPane, focused]);
  // Leaving the pane view, and not for another arrangement of it, gives
  // every pane kept fitted back to the host.
  useEffect(() => {
    views++;
    return () => {
      views--;
      window.setTimeout(() => {
        if (!views) releaseKept();
      }, 0);
    };
  }, []);

  // Tiles that are panes of one window share one fit: the focused one's,
  // or the first of them; the others are held. A pane alone is zoomed
  // over its siblings, when it has any.
  const windowOf = useCallback(
    (a: string) => {
      const q = (all.data ?? []).find((x) => x.address === a);
      return q ? `${q.host}/${q.session}/${q.window_index}` : a;
    },
    [all.data],
  );
  const heldTile = (a: string) => {
    const w = windowOf(a);
    const mates = addresses.filter((b) => windowOf(b) === w);
    if (mates.length < 2) return false;
    return a !== (mates.includes(focused) ? focused : mates[0]);
  };
  const siblings = (a: string) => {
    const w = windowOf(a);
    return (all.data ?? []).some((q) => q.address !== a && windowOf(q.address) === w);
  };

  const go = useCallback(
    (next: string[]) => {
      if (next !== addresses)
        navigate({ to: '/p/$', params: { _splat: routeFor(next) }, replace: true });
    },
    [addresses, navigate],
  );
  const strip = useMemo(() => {
    const order = (all.data ?? []).map((p) => p.address);
    for (const a of addresses) if (!order.includes(a)) order.push(a);
    return order;
  }, [all.data, addresses]);
  // A tab focuses its tile, or swaps into the focused one; with Shift it
  // opens beside the others instead.
  const onTab = useCallback(
    (address: string, add = false) => {
      const at = addresses.indexOf(address);
      if (at >= 0) setFocusedIndex(at);
      else if (add && addresses.length < MAX_TILES) go([...addresses, address]);
      else go(replace(addresses, index, address));
    },
    [addresses, index, go],
  );
  // Android's swipe: the focused tile shows the neighbouring pane of the strip.
  const neighbour = (step: number) => {
    const at = strip.indexOf(focused);
    if (at < 0) return;
    let k = at + step;
    while (k >= 0 && k < strip.length && addresses.includes(strip[k])) k += step;
    if (k >= 0 && k < strip.length) go(replace(addresses, index, strip[k]));
  };
  const toggleFit = (address: string, on?: boolean) =>
    setFit((f) => ({ ...f, [address]: on ?? !(f[address] ?? writable) }));

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      // ] and [ go to the next pane: the next tile, or with one tile open
      // the strip's neighbour shown in it.
      if (ev.key === ']' || ev.key === '[') {
        const d = ev.key === ']' ? 1 : -1;
        if (several) setFocusedIndex((index + d + n) % n);
        else neighbour(d);
      } else if (/^[1-4]$/.test(ev.key) && Number(ev.key) <= n) setFocusedIndex(Number(ev.key) - 1);
      else if (ev.key === 'l' && several) setLayout((l) => next(l, n));
      else if (ev.key === 'x' && several) go(close(addresses, focused));
      else if (ev.key === 'f' && writable) toggleFit(focused);
      else if (ev.key === 'F') {
        const on = !addresses.some((a) => fit[a] ?? true);
        const f: Record<string, boolean> = {};
        for (const a of addresses) f[a] = on;
        setFit(f);
      } else if (ev.key === 'r' && writable) setRefitTick((t) => t + 1);
      else if (ev.key === 'z' && focusedPane) zoom(focusedPane);
      else if (ev.key === 'w' && focusedPane)
        navigate({
          to: `/w/${focusedPane.host}/${focusedPane.session}/${focusedPane.window_index}`,
        });
      else if (ev.key === 'Enter' && several) go([focused]);
      else return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const send = async (body: { text: string } | { key: Key } | { mouse: Mouse }) => {
    try {
      await input.mutateAsync(body);
    } catch (err) {
      refused(
        err instanceof ApiError
          ? err.code === 'read_only'
            ? 'this pane is read-only'
            : err.code
          : 'hub unreachable',
      );
    }
  };

  // Zoom: the focused pane alone, or the window's panes side by side
  // again, up to four, the one that was alone first; a window of one pane
  // shows its mirror layout instead.
  const zoom = useCallback(
    (p: Pane) => {
      if (several) {
        go([p.address]);
        return;
      }
      const mates = (all.data ?? [])
        .filter(
          (q) => q.host === p.host && q.session === p.session && q.window_index === p.window_index,
        )
        .map((q) => q.address);
      const rest = mates.filter((a) => a !== p.address).slice(0, MAX_TILES - 1);
      if (!rest.length) {
        navigate({ to: `/w/${p.host}/${p.session}/${p.window_index}` });
        return;
      }
      go([p.address, ...rest]);
      setFocusedIndex(0);
    },
    [several, all.data, go, navigate],
  );
  const focusedFit = fit[focused] ?? writable;
  const tile = (i: number) => {
    const a = addresses[i];
    return (
      <Tile
        key={a}
        address={a}
        index={i}
        focused={i === index}
        several={several}
        fit={fit[a]}
        held={heldTile(a)}
        alone={!several}
        zoomable={siblings(a)}
        refitTick={i === index ? refitTick : 0}
        dragging={dragging}
        onFocus={() => setFocusedIndex(i)}
        onClose={() => go(close(addresses, a))}
        onFit={() => toggleFit(a)}
        onDragStart={() => setDragging(a)}
        onDragEnd={() => setDragging(null)}
        onDrop={() => {
          if (dragging && dragging !== a) go(swap(addresses, dragging, a));
          setDragging(null);
        }}
        onZoom={zoom}
        refused={refused}
      />
    );
  };
  return (
    <div
      className="mx-tiles"
      data-testid="pane"
      data-layout={several ? layout : undefined}
      data-panes={addresses.join(' ')}
    >
      <div className="mx-top">
        <Link to="/" className="mx-back" title="back to the panes (Esc)" data-testid="back">
          ‹
        </Link>
        <Tabs panes={all.data ?? []} open={addresses} focused={focused} onTab={onTab} addable />
        <span className="mx-tools">
          {several && (
            <button
              type="button"
              onClick={() => setLayout((l) => next(l, n))}
              title={`next arrangement (l): ${options(n).join(', ')}`}
              data-testid="arrange"
            >
              ▦
            </button>
          )}
          {writable && (
            <button
              type="button"
              className={`mx-toggle${focusedFit ? ' on' : ''}`}
              onClick={() => toggleFit(focused)}
              title={`fit: the host pane follows this tile (f), ${focusedFit ? 'on' : 'off'}; F: every tile`}
              data-testid="fit"
              data-on={focusedFit ? '1' : '0'}
            >
              ⤢
            </button>
          )}
          {writable && focusedFit && (
            <button
              type="button"
              onClick={() => setRefitTick((t) => t + 1)}
              title="fit again: this client's size (r)"
              data-testid="refit"
            >
              ⟳
            </button>
          )}
          {focusedPane && (
            <button
              type="button"
              className={`mx-toggle${several ? '' : ' on'}`}
              onClick={() => zoom(focusedPane)}
              title={
                several
                  ? 'this pane alone (z, Enter, or double-click)'
                  : "the window's panes side by side (z, or double-click); w: the mirror layout"
              }
              data-testid="zoom"
              data-on={several ? '0' : '1'}
            >
              ⊡
            </button>
          )}
        </span>
      </div>
      <div className="mx-area">
        <Tree node={tree(n, layout)} weights={weights} setWeights={setWeights} tile={tile} />
      </div>
      <InputPanel
        pane={focusedPane}
        writable={writable}
        placeholder={
          focusedPane
            ? writable
              ? several
                ? `type into ${focused}`
                : 'type · Enter sends · Shift+Enter new line · Esc leaves'
              : 'read-only pane'
            : 'no pane'
        }
        send={send}
      >
        {focusedPane && !writable && (
          <div className="mx-readonly" data-testid="readonly">
            read-only: your grant or the pane's mark does not allow typing
          </div>
        )}
      </InputPanel>
    </div>
  );
}

export function PanePage() {
  const { _splat: splat = '' } = useParams({ strict: false });
  const parsed = useMemo(() => parseRoute(splat), [splat]);
  if ('error' in parsed) {
    return (
      <div className="mx-empty mx-bad" data-testid="pane-error">
        {parsed.error}
      </div>
    );
  }
  return <Tiles key={parsed.addresses.length} addresses={parsed.addresses} />;
}
