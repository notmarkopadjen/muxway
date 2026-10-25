import { useNavigate, useParams } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { closePane, useAllPanes, useHosts, useInput, usePane, usePaneCached } from '../api/queries';
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
  tilesLayout,
  tree,
  dropOn,
  prune,
  zoneAt,
  type Layout,
  type TileNode,
  type Weights,
  type Zone,
} from '../term/tiles';
import { releaseKept, useFit } from '../term/useFit';
import { setHeading } from '../shell/heading';
import { InHeader } from '../shell/HeaderSlot';
import { AddMenu } from '../components/AddMenu';
import { requestPalette } from '../term/intent';

// Tiles as they were, kept across the navigation a change of count makes:
// the tiles a zoom came from, to go back to, and what a closed tile left.
interface Kept {
  panes: string[];
  layout: Layout;
  custom: TileNode | null;
  weights: Weights;
}
let unzoomed: Kept | null = null;
let carried: Kept | null = null;
// The pane to focus once the tiles of a new count are up.
let focusNext: string | null = null;

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
  // The tiles fit their window as one, with the arrangement as its layout.
  windowFit: boolean;
  // Alone in the view: the window is sized and the pane zoomed in it,
  // when it has siblings to be zoomed over.
  alone: boolean;
  zoomable: boolean;
  refitTick: number;
  dragging: string | null;
  onFocus: () => void;
  onClose: () => void;
  // The host closes writable panes for clients; asking: the header asks.
  hostCloses: boolean;
  asking: boolean;
  onAsk: () => void;
  onAnswer: (yes: boolean) => void;
  onFit: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: (zone: Zone) => void;
  onZoom: (p: Pane) => void;
  refused: (why: string) => void;
}

function Tile(props: TileProps) {
  const { address, focused, several, refitTick, dragging, alone, zoomable, windowFit } = props;
  const pane = usePane(address, focused ? 1_000 : 2_000);
  const box = useRef<HTMLDivElement>(null);
  const p = pane.data?.pane;
  const writable = p?.mode === 'write';
  // Every writable tile opens with fit on, as a single pane does.
  const fit = props.fit ?? writable;
  const fitting = fit && writable && !props.held && !windowFit;
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
  const [over, setOver] = useState<Zone | null>(null);
  // A pane that exited leaves the tiles at once; tmux has renumbered the
  // rest, so the window's last address is the one that is gone.
  const gone = several && pane.error instanceof ApiError && pane.error.status === 404;
  const { onClose } = props;
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);

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
      className={`mx-tile${over ? ` mx-drop mx-drop-${over}` : ''}`}
      data-drop={over ?? undefined}
      data-testid="tile"
      data-pane={address}
      data-several={several ? '' : undefined}
      data-focused={focused ? '' : undefined}
      data-fit={writable ? (fit ? '1' : '0') : undefined}
      data-held={props.held ? '' : undefined}
      onDragOver={(e) => {
        if (dragging && dragging !== address) {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          setOver(zoneAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height));
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const zone = over ?? 'swap';
        setOver(null);
        props.onDrop(zone);
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
        title={
          several
            ? 'drag onto another tile: its middle swaps the two, an edge splits its place'
            : undefined
        }
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
        {props.asking && p ? (
          <span className="mx-ask" data-testid="close-ask" onClick={(e) => e.stopPropagation()}>
            close the pane on {p.host}?{' '}
            <button type="button" data-testid="close-yes" onClick={() => props.onAnswer(true)}>
              y
            </button>{' '}
            <button type="button" data-testid="close-no" onClick={() => props.onAnswer(false)}>
              n
            </button>
          </span>
        ) : (
          (several || (props.hostCloses && writable)) && (
            <button
              type="button"
              title={
                props.hostCloses && writable
                  ? 'close the pane on its host (x)'
                  : 'close this tile (x); the host does not let clients close panes'
              }
              data-testid="close-tile"
              onClick={(e) => {
                e.stopPropagation();
                if (props.hostCloses && writable) props.onAsk();
                else props.onClose();
              }}
            >
              ×
            </button>
          )
        )}
      </div>
      <Screen
        content={shown?.content ?? ''}
        burn={!pane.isPlaceholderData}
        cols={fitting || windowFit ? undefined : sp?.width}
        rows={fitting || windowFit ? undefined : sp?.height}
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
  const [focusedIndex, setFocusedIndex] = useState(() => {
    const at = focusNext ? addresses.indexOf(focusNext) : -1;
    focusNext = null;
    return Math.max(at, 0);
  });
  const index = Math.min(focusedIndex, n - 1);
  const focused = addresses[index];
  const focusedPane = usePaneCached(focused).data?.pane;
  const writable = focusedPane?.mode === 'write';
  const input = useInput(focused);
  const [custom, setCustom] = useState<TileNode | null>(null);
  const [layout, setLayout] = useState<Layout>(() =>
    defaultFor(window.innerWidth > window.innerHeight),
  );
  const [weights, setWeights] = useState<Weights>({});
  const shape: TileNode =
    layout === 'custom' ? (custom ?? tree(n, defaultFor(true))) : tree(n, layout);
  const [fit, setFit] = useState<Record<string, boolean>>({});
  const [refitTick, setRefitTick] = useState(0);
  const [dragging, setDragging] = useState<string | null>(null);
  // The tile whose header asks whether to close its pane on the host.
  const [asking, setAsking] = useState<string | null>(null);
  const hosts = useHosts();
  const hostCloses = (a: string) => !!hosts.data?.find((h) => h.name === a.split('/')[0])?.close;
  // A tile closed in the view; the last one goes back to the list.
  const closeTile = (a: string) => {
    if (addresses.length <= 1) {
      navigate({ to: '/' });
      return;
    }
    const rest = close(addresses, a);
    if (layout === 'custom' && rest.length > 1)
      carried = { panes: rest, layout, custom: prune(shape, addresses.indexOf(a)), weights: {} };
    go(rest);
  };
  const answer = async (a: string, yes: boolean) => {
    setAsking(null);
    if (!yes) return;
    try {
      await closePane(a);
      closeTile(a);
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
  const refused = useCallback(
    (why: string) => toast.push({ kind: 'refused', title: why }),
    [toast],
  );

  // A new count resets the arrangement to one that fits it, unless zooming
  // out or closing a tile brings back the tiles as they were.
  useEffect(() => {
    for (const k of [carried, unzoomed])
      if (k && k.panes.join() === addresses.join()) {
        carried = null;
        setLayout(k.layout);
        setCustom(k.custom);
        setWeights(k.weights);
        return;
      }
    setLayout((l) =>
      l !== 'custom' && options(n).includes(l)
        ? l
        : defaultFor(window.innerWidth > window.innerHeight),
    );
    setCustom(null);
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
  // Open tiles that are every pane of one window fit the window as one,
  // laid out as the tiles are, the way the window view does: each pane
  // is then its tile, and no tile is held.
  const oneWindow = useMemo(() => {
    if (!several || !all.data) return null;
    const w = windowOf(addresses[0]);
    const mates = all.data.filter((q) => windowOf(q.address) === w);
    if (mates.length !== n || !addresses.every((a) => mates.some((q) => q.address === a)))
      return null;
    return addresses.map((a) => mates.find((q) => q.address === a)!.pane_id);
  }, [several, all.data, addresses, n, windowOf]);
  const area = useRef<HTMLDivElement>(null);
  const windowFit = !!oneWindow && (fit[focused] ?? true) && !!writable;
  const windowLayout = oneWindow ? tilesLayout(shape, weights, oneWindow) : undefined;
  const { refit: refitWindow } = useFit(focused, windowFit, area, 'window', windowLayout, false, {
    keep: true,
  });
  useEffect(() => {
    if (refitTick && windowFit) refitWindow();
  }, [refitTick, windowFit, refitWindow]);

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
    // Past either end it comes round to the other.
    for (let i = 1; i < strip.length; i++) {
      const k = (((at + step * i) % strip.length) + strip.length) % strip.length;
      if (!addresses.includes(strip[k])) {
        go(replace(addresses, index, strip[k]));
        return;
      }
    }
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
      else if (asking && (ev.key === 'y' || ev.key === 'n')) void answer(asking, ev.key === 'y');
      else if (ev.key === 'x' && hostCloses(focused) && writable) setAsking(focused);
      else if (ev.key === 'x' && several) closeTile(focused);
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

  // Zoom: the focused pane alone, and back to the tiles it came from, in
  // their places and arrangement; from a pane opened alone, the window's
  // panes side by side in the window's order, up to four; a window of one
  // pane shows its mirror layout instead.
  const zoom = useCallback(
    (p: Pane) => {
      if (several) {
        unzoomed = { panes: addresses, layout, custom, weights };
        go([p.address]);
        return;
      }
      if (unzoomed && unzoomed.panes.includes(p.address)) {
        const back = unzoomed.panes;
        focusNext = p.address;
        go(back);
        return;
      }
      const mates = (all.data ?? [])
        .filter(
          (q) => q.host === p.host && q.session === p.session && q.window_index === p.window_index,
        )
        .map((q) => q.address);
      if (mates.length < 2) {
        navigate({ to: `/w/${p.host}/${p.session}/${p.window_index}` });
        return;
      }
      const others = mates.filter((a) => a !== p.address).slice(0, MAX_TILES - 1);
      const back = mates.filter((a) => a === p.address || others.includes(a));
      focusNext = p.address;
      go(back);
    },
    [several, addresses, layout, weights, all.data, go, navigate],
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
        held={!oneWindow && heldTile(a)}
        windowFit={!!oneWindow}
        alone={!several}
        zoomable={siblings(a)}
        refitTick={i === index ? refitTick : 0}
        dragging={dragging}
        onFocus={() => setFocusedIndex(i)}
        onClose={() => closeTile(a)}
        hostCloses={hostCloses(a)}
        asking={asking === a}
        onAsk={() => setAsking(a)}
        onAnswer={(yes) => void answer(a, yes)}
        onFit={() => toggleFit(a)}
        onDragStart={() => setDragging(a)}
        onDragEnd={() => setDragging(null)}
        onDrop={(zone) => {
          if (dragging && dragging !== a && zone !== 'swap') {
            setCustom(dropOn(shape, addresses.indexOf(dragging), i, zone));
            setLayout('custom');
            setWeights({});
            setDragging(null);
            return;
          }
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
      <InHeader>
        <Tabs
          panes={all.data ?? []}
          open={addresses}
          focused={focused}
          onTab={onTab}
          onZoom={(a) => {
            const p = (all.data ?? []).find((q) => q.address === a);
            if (p) zoom(p);
          }}
          addable
        />
        <AddMenu
          pane={focusedPane}
          onMade={(a) =>
            go(addresses.length < MAX_TILES ? [...addresses, a] : replace(addresses, index, a))
          }
          onRefused={refused}
        />
        <span className="mx-tools">
          {several && (
            <button
              type="button"
              onClick={() => setLayout((l) => next(l, n))}
              title={`next arrangement (l): ${options(n).join(', ')}`}
              data-testid="arrange"
              data-label="arrange"
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
              data-label="fit"
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
              data-label="fit again"
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
              data-label="zoom"
              data-on={several ? '0' : '1'}
            >
              ⊡
            </button>
          )}
          <button
            type="button"
            onClick={requestPalette}
            title="go to a pane (p)"
            data-testid="open-palette"
            data-label="go to"
          >
            ≡
          </button>
        </span>
      </InHeader>
      <div className="mx-area" ref={area} data-window-fit={windowFit ? '' : undefined}>
        <Tree node={shape} weights={weights} setWeights={setWeights} tile={tile} />
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
