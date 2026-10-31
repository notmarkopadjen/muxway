import { useNavigate, useParams } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { queryClient } from '../query';
import { useQueryClient } from '@tanstack/react-query';
import {
  closePane,
  hostOf,
  keys,
  resizePane,
  sendInput,
  useAllPanes,
  useChanges,
  useHosts,
  useInput,
  usePane,
  usePaneCached,
} from '../api/queries';
import { splitAddress } from '../hubs';
import type { Mouse, Pane, PaneContent } from '../api/types';
import { Divider } from '../components/Divider';
import { InputPanel } from '../components/InputPanel';
import { LensMark } from '../components/Lens';
import { Choices } from '../components/Choices';
import { MinimisedRow } from '../components/Minimised';
import { PaneTitle } from '../components/PaneTitle';
import { Tabs } from '../components/Tabs';
import { useToast } from '../components/Toast';
import { noteChange, noteOwn, useLens } from '../term/lens';
import { drawn, nameFor, useMoving } from '../term/drawn';
import { inOrder, move, step } from '../term/order';
import { setTabOrder, useTabOrder } from '../settings';
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
  across,
  dropOn,
  fromHost,
  rects,
  bottomLeaves,
  exactLayout,
  rootKey,
  nearWeights,
  prune,
  sameTree,
  zoneAt,
  type Layout,
  type TileNode,
  type Weights,
  type Zone,
} from '../term/tiles';
import { cellsFor, inner } from '../term/measure';
import { releaseKept, useFit } from '../term/useFit';
import { screenWords } from '../term/complete';
import { countOf, summary } from '../term/changes';
import { Backlog, keyToBody, pasteText } from '../term/direct';
import { setHeading } from '../shell/heading';
import { InHeader } from '../shell/HeaderSlot';
import { AddMenu } from '../components/AddMenu';
import { Closing } from '../components/Closing';
import { FileWindow, type Shown } from '../components/FileWindow';
import { ChangesWindow } from '../components/Changes';
import { Tools } from '../components/Tools';
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
// The minimised panes, carried across the navigation to the tiles named.
let minimisedKept: { panes: string[]; minimised: string[] } | null = null;

// How long a tile shows its last frame while the host catches up with a fit.
const HOLD_FRAME_MS = 3000;

// The last settled frame of each pane, shown again when the pane comes
// back into a tile while the host catches up.
const frames = new Map<string, PaneContent>();

export function forgetFrames() {
  frames.clear();
}

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
    await sendInput(address, { mouse });
    // The program has moved: show it soon, not at the next poll, and once
    // more a little later, in case the first read caught the screen cleared
    // and not yet redrawn.
    for (const ms of [150, 600])
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: keys.pane(address) }), ms);
  } catch (err) {
    refused(err instanceof ApiError ? err.code : 'hub unreachable');
  }
}

interface TileProps {
  address: string;
  // A window over the screen, docked to the tile's edge: the changes.
  panel?: React.ReactNode;
  index: number;
  focused: boolean;
  several: boolean;
  fit: boolean | undefined;
  // The tiles fit their window as one, with the arrangement as its layout;
  // fitted says that fit is on (off, the tile is drawn scaled to its box).
  windowFit: boolean;
  windowFitted: boolean;
  // Alone in the view: the window is sized and the pane zoomed in it,
  // when it has siblings to be zoomed over.
  alone: boolean;
  zoomable: boolean;
  refitTick: number;
  dragging: string | null;
  onFocus: () => void;
  onClose: () => void;
  // The pane is no longer there: the tile goes, with a word.
  onGone: () => void;
  // The tile out of the arrangement, into the minimised row; off on the last tile.
  minimisable: boolean;
  onMinimise: () => void;
  // The host closes writable panes for clients; asking: the header asks.
  hostCloses: boolean;
  asking: boolean;
  onAsk: () => void;
  onAnswer: (yes: boolean) => void;
  onFit: () => void;
  onFile: (name: string) => void;
  // The host previews files a pane prints the paths of, for writers.
  onPath?: (path: string) => void;
  // The host has roots: the header counts the repository's changes, and
  // the count opens the changes window over this tile.
  previews: boolean;
  changesOpen: boolean;
  onChanges: () => void;
  // Height the input line takes beyond one row, which is not a resize.
  slack: () => number;
  onCopied: (rows: number) => void;
  // A click on the row the program waits on: the line takes the focus.
  onPrompt: () => void;
  // Direct typing: keys go to this pane as pressed; the cursor is drawn
  // as a block. A click on the screen with a fine pointer turns it on.
  direct: boolean;
  onDirect: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: (zone: Zone) => void;
  onZoom: (p: Pane) => void;
  refused: (why: string) => void;
  // The tile's edges inside the area; a click on the strip along one lays
  // the tile across the whole view, its width or its height.
  edges?: Edges;
  onSpread?: (axis: 'w' | 'h') => void;
}

type Edge = 'left' | 'right' | 'top' | 'bottom';
type Edges = Record<Edge, boolean>;
const EDGE_GLYPH: Record<Edge, string> = { left: '«', right: '»', top: '˄', bottom: '˅' };

function Tile(props: TileProps) {
  // What last pressed on the tile's body: a touch keeps the line's ways.
  const pointer = useRef('mouse');
  const { address, focused, several, refitTick, dragging, alone, zoomable, windowFit } = props;
  const pane = usePane(address, focused ? 1_000 : 2_000);
  const moving = useMoving();
  const box = useRef<HTMLDivElement>(null);
  const p = pane.data?.pane;
  const writable = p?.mode === 'write';
  // Every writable tile opens with fit on, as a single pane does.
  const fit = props.fit ?? writable;
  const fitting = fit && writable && !windowFit;
  const {
    size: fitted,
    asked,
    refit,
  } = useFit(address, fitting, box, alone ? 'window' : 'pane', undefined, alone && zoomable, {
    keep: true,
    inset: false,
    slack: props.slack,
    known: () => p && { cols: p.width, rows: p.height, zoomed: p.zoomed },
  });
  // While a fit is in flight the host still answers at its old size; the
  // tile keeps showing the last frame it had rather than that one, for a
  // moment at most, so switching panes does not flash a smaller screen.
  const frame = useRef<PaneContent | null>(frames.get(address) ?? null);
  const [, bump] = useState(0);
  const since = useRef(Date.now());
  useEffect(() => {
    since.current = Date.now();
    frame.current = frames.get(address) ?? null;
  }, [address]);
  useEffect(() => {
    const t = window.setTimeout(() => bump((n) => n + 1), HOLD_FRAME_MS + 50);
    return () => window.clearTimeout(t);
  }, [address, asked]);
  const sentAt = asked?.at ?? since.current;
  let shown = pane.data;
  let settled = false;
  if (fitting && shown) {
    settled = !!fitted && shown.pane.width === fitted.cols && shown.pane.height === fitted.rows;
    if (settled || Date.now() - sentAt > HOLD_FRAME_MS) {
      frame.current = shown;
      if (settled) frames.set(address, shown);
    } else if (frame.current) shown = frame.current;
  }
  const sp = shown?.pane;
  // Held: the host would not give the size asked, since another tile's
  // fit shares the axis (its answer differs, or the pane was moved after
  // it). The screen is drawn scaled to the box, and nothing is sent again
  // until the box changes.
  const held =
    fitting &&
    !!fitted &&
    !!asked &&
    (fitted.cols !== asked.cols ||
      fitted.rows !== asked.rows ||
      (!settled && Date.now() - sentAt > HOLD_FRAME_MS));
  // Syncing: the size is asked and the pane not yet at it; the header says
  // so and the picture is drawn tuning in, so the held frame does not read
  // as stuck.
  const syncing = fitting && !settled && !held;
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
  // The repository's changes, counted in the header for a writer on a
  // host with roots; a 404 says the pane is in none, and the count goes.
  const counting = !!p && writable && props.previews;
  const ch = useChanges(address, counting, 10_000);
  const counts =
    counting && ch.data && !(ch.error instanceof ApiError && ch.error.status === 404)
      ? countOf(ch.data.entries)
      : null;
  // A pane that exited leaves the view at once, alone or among tiles;
  // tmux has renumbered the rest, so the window's last address is the
  // one that is gone.
  const gone = pane.error instanceof ApiError && pane.error.status === 404;
  const { onGone } = props;
  const left = useRef(false);
  useEffect(() => {
    if (gone && !left.current) {
      left.current = true;
      onGone();
    }
  }, [gone, onGone]);

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
      data-held={held ? '' : undefined}
      data-syncing={syncing ? '' : undefined}
      data-moving={moving.on ? '' : undefined}
      data-zooming={moving.zoom === address ? '' : undefined}
      style={moving.on ? { viewTransitionName: nameFor(address, moving.zoom) } : undefined}
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
            {held && (
              <span
                className="mx-warn"
                title="the host could not give this tile's size: another tile's fit shares the axis"
                data-testid="held"
              >
                held
              </span>
            )}
            {syncing && (
              <span
                className="mx-sync"
                title="waiting for the host at this size"
                data-testid="syncing"
              >
                sync
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
            {st === 'waiting' && (
              <Choices address={address} attention={p.attention} writable={p.mode === 'write'} />
            )}
          </>
        )}
        <span className="mx-spacer" />
        {counts && (
          <button
            type="button"
            className={`mx-tile-changes${props.changesOpen ? ' on' : ''}`}
            title="the repository's changes (g)"
            data-testid="tile-changes"
            onClick={(e) => {
              e.stopPropagation();
              props.onChanges();
            }}
          >
            ⎇ {summary({ ...counts, conflict: 0 }) || (counts.conflict ? '' : '✓')}
            {counts.conflict ? <span className="mx-warn"> !{counts.conflict}</span> : null}
          </button>
        )}
        {!props.asking && (
          <button
            type="button"
            title={
              props.minimisable
                ? 'minimise: the tile goes to the row above the keys (-)'
                : 'the last tile cannot be minimised'
            }
            disabled={!props.minimisable}
            data-testid="minimise"
            onClick={(e) => {
              e.stopPropagation();
              props.onMinimise();
            }}
          >
            _
          </button>
        )}
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
      <div
        className="mx-tile-body"
        onPointerDownCapture={(e) => {
          pointer.current = e.pointerType;
        }}
      >
        <Screen
          content={shown?.content ?? ''}
          burn={!pane.isPlaceholderData}
          cols={(fitting && !held) || (windowFit && props.windowFitted) ? undefined : sp?.width}
          rows={(fitting && !held) || (windowFit && props.windowFitted) ? undefined : sp?.height}
          boxRef={box}
          focused={several && focused}
          onClick={() => {
            props.onFocus();
            if (writable && pointer.current !== 'touch') props.onDirect();
          }}
          height={sp && sp.height - (shown?.trimmed ?? 0)}
          bounds={p && { cols: p.width, rows: p.height }}
          onCell={
            writable && p?.mouse
              ? (x, y) => void click(address, { button: 'left', x, y }, props.refused)
              : undefined
          }
          onWheel={
            writable && p?.mouse
              ? (up, x, y, count) =>
                  click(
                    address,
                    { button: up ? 'wheelup' : 'wheeldown', x, y, ...(count > 1 ? { count } : {}) },
                    props.refused,
                  )
              : undefined
          }
          onFile={props.onFile}
          onPath={writable ? props.onPath : undefined}
          onCopy={props.onCopied}
          onPrompt={
            writable
              ? () => {
                  // A touch keeps the line's way in; a fine pointer went direct.
                  if (pointer.current === 'touch') props.onPrompt();
                }
              : undefined
          }
          cursorRow={p?.cursor_y}
          cursor={
            props.direct && p?.cursor_x && p?.cursor_y
              ? { x: p.cursor_x, y: p.cursor_y }
              : undefined
          }
          testId={focused ? 'screen' : 'cell-screen'}
        />
        {props.panel}
        {props.onSpread &&
          (Object.keys(EDGE_GLYPH) as Edge[])
            .filter((e) => props.edges?.[e])
            .map((e) => {
              const wide = e === 'left' || e === 'right';
              return (
                <div
                  key={e}
                  className={`mx-edge mx-edge-${e}`}
                  data-testid={`edge-${e}`}
                  data-label={wide ? 'across' : 'full height'}
                  title={
                    wide
                      ? 'lay this tile across the whole width (e)'
                      : 'lay this tile down the whole height (E)'
                  }
                  onClick={(ev) => {
                    ev.stopPropagation();
                    props.onSpread!(wide ? 'w' : 'h');
                  }}
                >
                  <span aria-hidden>{EDGE_GLYPH[e].repeat(wide ? 1 : 3)}</span>
                </div>
              );
            })}
      </div>
    </div>
  );
}

interface TreeProps {
  node: TileNode;
  weights: Weights;
  setWeights: (f: (w: Weights) => Weights) => void;
  tile: (index: number) => React.ReactNode;
  // A header is being dragged: the dividers take it, laying the pane across
  // their split, first or last.
  dragging: boolean;
  onAcross?: (key: string, wrap: 'h' | 'v', first: boolean) => void;
}

function Tree(props: TreeProps) {
  const { node, weights, setWeights, tile, dragging, onAcross } = props;
  const box = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState<boolean | null>(null);
  if (typeof node === 'number') return <>{tile(node)}</>;
  // Across a split side by side the pane is stacked over or under it, and
  // the other way round.
  const wrap = node.kind === 'h' ? 'v' : 'h';
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
    <div
      className={`mx-split mx-split-${node.kind}`}
      ref={box}
      data-testid="split"
      data-key={node.key}
    >
      {dragging && over !== null && (
        <div
          className={`mx-across mx-across-${wrap}-${over ? 'first' : 'last'}`}
          data-testid="across"
        >
          <span>{wrap === 'v' ? '══ across ══' : '║ full height ║'}</span>
        </div>
      )}
      {node.children.map((c, i) => (
        <div
          key={i}
          className="mx-slot"
          style={{ flexBasis: `${w[i] * 100}%` }}
          data-fraction={w[i].toFixed(3)}
        >
          <Tree {...props} node={c} />
          {i < n - 1 && (
            <Divider
              kind={node.kind}
              onDrag={onDrag(i)}
              dropping={dragging}
              onOver={setOver}
              onDropHere={onAcross && ((first) => onAcross(node.key, wrap, first))}
            />
          )}
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
  // Panes taken out of the arrangement: read on, shown in the row above
  // the keys, forgotten with the view.
  const [minimised, setMinimised] = useState<string[]>(() => {
    const k = minimisedKept;
    minimisedKept = null;
    return k && k.panes.join() === addresses.join() ? k.minimised : [];
  });
  const focusedCached = usePaneCached(focused).data;
  const focusedPane = focusedCached?.pane;
  const words = useMemo(() => screenWords(focusedCached?.content ?? ''), [focusedCached?.content]);
  const focusLine = useCallback(() => {
    const el = document.querySelector<HTMLTextAreaElement>('[data-testid="input"]');
    if (el && !el.disabled) el.focus();
  }, []);
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
  // A file of the inbox shown over the page; kept while its window powers off.
  const [shown, setShown] = useState<Shown | null>(null);
  const [showing, setShowing] = useState(false);
  const show = useCallback((s: Shown) => {
    setShown(s);
    setShowing(true);
  }, []);
  const hide = useCallback(() => setShowing(false), []);
  // The changes window over the focused tile, and whether it is folded.
  const [changes, setChanges] = useState(false);
  const [changesFolded, setChangesFolded] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  // The tile whose header asks whether to close its pane on the host.
  const [asking, setAsking] = useState<string | null>(null);
  const hosts = useHosts();
  const hostCloses = (a: string) => !!hostOf(hosts.data, a)?.close;
  const hostPreviews = (a: string) => !!hostOf(hosts.data, a)?.preview;
  // Direct typing: keys go to the focused pane as pressed, while it is
  // writable; focusing a read-only tile ends it, as does leaving the view.
  const [direct, setDirect] = useState(false);
  const directOn = direct && writable;
  const repeats = useRef(false);
  repeats.current = !!hostOf(hosts.data, focused)?.repeat;
  useEffect(() => {
    if (direct && focusedPane && !writable) setDirect(false);
  }, [direct, focusedPane, writable]);
  const enterDirect = useCallback(() => {
    setDirect(true);
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) active.blur();
    document.querySelector<HTMLElement>('[data-testid="screen"]')?.focus();
  }, []);
  // The changes window shows for a writer on a host with roots; the
  // repository's state is asked again once the pane's output settles.
  const showsChanges = changes && writable && hostPreviews(focused);
  const focusedContent = focusedCached?.content;
  useEffect(() => {
    if (!showsChanges) return;
    const t = setTimeout(
      () => void queryClient.invalidateQueries({ queryKey: keys.changes(focused) }),
      800,
    );
    return () => clearTimeout(t);
  }, [showsChanges, focused, focusedContent]);
  // A tile closed in the view; the last one brings a minimised pane back,
  // or goes back to the list.
  const closeTile = (a: string) => {
    if (addresses.length <= 1) {
      if (minimised.length) {
        focusNext = minimised[0];
        go([minimised[0]], minimised.slice(1));
      } else navigate({ to: '/' });
      return;
    }
    const rest = close(addresses, a);
    if (layout === 'custom' && rest.length > 1)
      carried = { panes: rest, layout, custom: prune(shape, addresses.indexOf(a)), weights: {} };
    go(rest);
  };
  // The tile out of the arrangement, as a closed one, and its pane into
  // the row; the last tile stays.
  const minimise = (a: string) => {
    if (addresses.length <= 1 || minimised.includes(a)) return;
    const rest = close(addresses, a);
    if (layout === 'custom' && rest.length > 1)
      carried = { panes: rest, layout, custom: prune(shape, addresses.indexOf(a)), weights: {} };
    drawn(() => go(rest, [...minimised, a]));
  };
  // Back from the row as one more tile, focused; with four open it takes
  // the focused tile's place, as a tab does.
  const restore = (a: string) => {
    const rest = minimised.filter((m) => m !== a);
    drawn(() => {
      if (addresses.length < MAX_TILES) {
        focusNext = a;
        go([...addresses, a], rest);
      } else go(replace(addresses, index, a), rest);
    });
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
    setHeading({ pane: focusedPane, place: focused, direct: directOn });
    return () => setHeading({ place: '' });
  }, [focusedPane, focused, directOn]);
  // Leaving the pane view, and not for another arrangement of it, gives
  // every pane kept fitted back to the host.
  useEffect(() => {
    views++;
    return () => {
      views--;
      minimisedKept = null;
      window.setTimeout(() => {
        if (!views) releaseKept();
      }, 0);
    };
  }, []);

  // A pane alone is zoomed over its siblings, when it has any. Tiles of
  // one window each fit their own pane; the host sorts the neighbours out.
  const windowOf = useCallback(
    (a: string) => {
      const q = (all.data ?? []).find((x) => x.address === a);
      return q ? `${q.hub ?? ''}~${q.host}/${q.session}/${q.window_index}` : a;
    },
    [all.data],
  );
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
  // Such tiles and their window are kept the same both ways: the tiles take
  // the host's layout when it changes there, and what is changed here is
  // sent as the window's layout, which moves the panes on the host. Moving
  // them needs every one writable; without, the tiles only follow.
  const hostLayout = oneWindow
    ? (all.data ?? []).find((q) => q.address === addresses[0])?.window_layout
    : undefined;
  const movable =
    !!oneWindow &&
    addresses.every((a) => (all.data ?? []).find((q) => q.address === a)?.mode === 'write');
  const [synced, setSynced] = useState(false);
  // When the tiles were last changed here: the host's layout is not taken
  // over a change it has not caught up with.
  const touched = useRef(0);
  const touch = () => {
    touched.current = Date.now();
  };
  const idsKey = oneWindow?.join() ?? '';
  // The layout last sent to the host. Coming back from it, it is not a
  // change to take: an exact one differs from the weights by the headers.
  const sentLayout = useRef('');
  const adopt = useCallback(
    (always: boolean) => {
      if (!oneWindow || !hostLayout) return;
      const h = fromHost(hostLayout, oneWindow);
      if (!h) return;
      const settled = Date.now() - touched.current > 3000;
      const mine = sentLayout.current ? fromHost(sentLayout.current, oneWindow) : null;
      const ours =
        !!mine && sameTree(h.node, mine.node) && nearWeights(h.node, h.weights, mine.weights, 0.03);
      if (
        always ||
        (settled &&
          !ours &&
          (!sameTree(h.node, shape) || !nearWeights(h.node, h.weights, weights, 0.03)))
      ) {
        setCustom(h.node);
        setLayout('custom');
        setWeights(h.weights);
      }
      setSynced(true);
    },
    [oneWindow, hostLayout, shape, weights],
  );
  useEffect(() => {
    if (!oneWindow) setSynced(false);
    else adopt(!synced);
  }, [hostLayout, idsKey]);
  const qc = useQueryClient();
  // After a layout the panes may have new indexes: the listing takes the
  // answer at once, and the route follows the tiles' panes by id.
  const follow = (r: { panes?: Pane[] }) => {
    if (!r.panes || !oneWindow) return;
    const by = new Map(r.panes.map((p) => [p.pane_id, p]));
    const { hub } = splitAddress(addresses[0]);
    qc.setQueryData<Pane[]>(keys.panesOf(hub), (old) =>
      old?.map((p) => (p.host === r.panes![0].host ? (by.get(p.pane_id) ?? p) : p)),
    );
    qc.invalidateQueries({ queryKey: ['pane'] });
    const next = oneWindow.map((id, i) => by.get(id)?.address ?? addresses[i]);
    if (next.join() !== addresses.join())
      navigate({ to: '/p/$', params: { _splat: routeFor(next) }, replace: true });
  };
  const area = useRef<HTMLDivElement>(null);
  // The input line grown while a message is written takes height from
  // the tiles; the fits measure as if it had not.
  const grown = useRef(0);
  const slack = useCallback(() => grown.current, []);
  const windowFit = !!oneWindow && synced && (fit[focused] ?? true) && !!writable;
  const windowLayout = oneWindow && synced ? tilesLayout(shape, weights, oneWindow) : undefined;
  // The window's size and layout, exact: each pane as many cells as its
  // tile's screen holds, the tiles along the bottom measured as if the
  // input line had not grown.
  const exact = useCallback(() => {
    if (!oneWindow || !area.current) return null;
    const bottom = new Set(bottomLeaves(shape));
    const sizes: { cols: number; rows: number }[] = [];
    for (const [i, a] of addresses.entries()) {
      const el = area.current.querySelector<HTMLElement>(`[data-pane="${a}"] .mx-screen`);
      if (!el) return null;
      const { w, h } = inner(el);
      sizes.push(cellsFor(w, h + (bottom.has(i) ? grown.current : 0)));
    }
    const r = exactLayout(shape, sizes, oneWindow);
    sentLayout.current = r.layout;
    return r;
  }, [oneWindow, shape, addresses]);
  // The window is fitted through one tile's pane, the same one while it
  // is open, so moving the focus sends nothing.
  const windowVia =
    addresses.find((a) => (all.data ?? []).find((q) => q.address === a)?.mode === 'write') ??
    focused;
  const { refit: refitWindow } = useFit(windowVia, windowFit, area, 'window', windowLayout, false, {
    keep: true,
    onDone: follow,
    slack,
    exact,
  });
  // With fit off the arrangement still goes to the host, without a size.
  // Only with fit really off: while the focused pane is still unknown the
  // window fit is not on yet either, and a layout sent then would take
  // the window's one resize a second from the fit.
  const [retry, setRetry] = useState(0);
  const windowFitOff = fit[focused] === false;
  useEffect(() => {
    if (!movable || !synced || !windowFitOff || !windowLayout || !hostLayout || !oneWindow) return;
    const h = fromHost(hostLayout, oneWindow);
    if (h && sameTree(h.node, shape) && nearWeights(shape, h.weights, weights, 0.01)) return;
    const t = window.setTimeout(() => {
      sentLayout.current = windowLayout;
      resizePane(windowVia, { scope: 'window', layout: windowLayout })
        .then(follow)
        .catch((err) => {
          if (err instanceof ApiError && err.status === 429)
            window.setTimeout(() => setRetry((n) => n + 1), 1100);
          else {
            refused(err instanceof ApiError ? err.code : 'hub unreachable');
            adopt(true);
          }
        });
    }, 300);
    return () => window.clearTimeout(t);
  }, [movable, synced, windowFitOff, windowLayout, retry]);
  useEffect(() => {
    if (refitTick && windowFit) refitWindow();
  }, [refitTick, windowFit, refitWindow]);

  // The minimised panes go along, less any the next tiles show; a change
  // of count mounts the tiles anew and they are taken up there.
  const go = useCallback(
    (next: string[], keep = minimised) => {
      if (next === addresses) return Promise.resolve();
      const rest = keep.filter((a) => !next.includes(a));
      minimisedKept = { panes: next, minimised: rest };
      if (next.length === addresses.length) setMinimised(rest);
      return navigate({ to: '/p/$', params: { _splat: routeFor(next) }, replace: true });
    },
    [addresses, minimised, navigate],
  );
  const shownPanes = useMemo(
    () => (all.data ?? []).filter((p) => !minimised.includes(p.address)),
    [all.data, minimised],
  );
  // The strip in the owner's order; an open address the listing lacks
  // goes last.
  const tabOrder = useTabOrder();
  const stripPanes = useMemo(() => inOrder(shownPanes, tabOrder), [shownPanes, tabOrder]);
  const strip = useMemo(() => {
    const order = stripPanes.map((p) => p.address);
    for (const a of addresses) if (!order.includes(a)) order.push(a);
    return order;
  }, [stripPanes, addresses]);
  const reorder = useCallback(
    (dragged: string, before: string | null) => setTabOrder(move(tabOrder, strip, dragged, before)),
    [tabOrder, strip],
  );
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
      if (ev.ctrlKey || ev.metaKey || ev.altKey || directOn) return;
      // ] and [ go to the next pane: the next tile, or with one tile open
      // the strip's neighbour shown in it.
      if (ev.key === ']' || ev.key === '[') {
        const d = ev.key === ']' ? 1 : -1;
        if (several) setFocusedIndex((index + d + n) % n);
        else neighbour(d);
      } else if (ev.key === '}' || ev.key === '{') {
        // The focused pane's tab one place along the strip.
        setTabOrder(step(tabOrder, strip, focused, ev.key === '}' ? 1 : -1));
      } else if (/^[1-4]$/.test(ev.key) && Number(ev.key) <= n) setFocusedIndex(Number(ev.key) - 1);
      else if (ev.key === 'l' && several && (!oneWindow || movable)) {
        touch();
        drawn(() => setLayout((l) => next(l, n)));
      } else if (asking && (ev.key === 'y' || ev.key === 'n')) void answer(asking, ev.key === 'y');
      else if (ev.key === 'x' && hostCloses(focused) && writable) setAsking(focused);
      else if (ev.key === 'x' && several) closeTile(focused);
      else if (ev.key === '-' && several) minimise(focused);
      else if ((ev.key === 'e' || ev.key === 'E') && several)
        spread(index, ev.key === 'e' ? 'w' : 'h');
      else if (ev.key === 'f' && writable) toggleFit(focused);
      else if (ev.key === 'F') {
        const on = !addresses.some((a) => fit[a] ?? true);
        const f: Record<string, boolean> = {};
        for (const a of addresses) f[a] = on;
        setFit(f);
      } else if (ev.key === 'r' && writable) setRefitTick((t) => t + 1);
      else if (ev.key === '=' && several && (!oneWindow || movable)) {
        touch();
        drawn(() => setWeights({}));
      } else if (ev.key === 'g' && writable && hostPreviews(focused)) setChanges((c) => !c);
      else if (ev.key === 'i' && writable) enterDirect();
      else if (ev.key === ':') focusLine();
      else if (ev.key === 'z' && focusedPane) zoom(focusedPane);
      else if (ev.key === 'w' && focusedPane && !focusedPane.hub)
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

  const send = async (body: { text: string } | { key: string } | { mouse: Mouse }) => {
    try {
      await input.mutateAsync(body);
      return true;
    } catch (err) {
      refused(
        err instanceof ApiError
          ? err.code === 'read_only'
            ? 'this pane is read-only'
            : err.code
          : 'hub unreachable',
      );
      return false;
    }
  };
  // The keys of direct typing, queued per pane behind the request in
  // flight; a key typed while the focus moves goes to the new tile. The
  // file window keeps every key while it is open; a pasted file goes to
  // the inbox as on the line, with its path typed into the pane.
  const sendRef = useRef(send);
  sendRef.current = send;
  const backlog = useMemo(
    () =>
      new Backlog(
        (b) => sendRef.current(b),
        () => repeats.current,
      ),
    [focused],
  );
  useEffect(() => {
    if (!directOn) return;
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    };
    const elsewhere = (t: EventTarget | null) =>
      typing(t) || !!document.querySelector('.mx-picture-back');
    const onKey = (ev: KeyboardEvent) => {
      if (elsewhere(ev.target)) return;
      if (ev.key === 'Escape' && ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        setDirect(false);
        ev.preventDefault();
        ev.stopImmediatePropagation();
        return;
      }
      const body = keyToBody(ev, !!window.getSelection()?.toString());
      if (!body) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      backlog.push(body);
    };
    const onPaste = (ev: ClipboardEvent) => {
      if (elsewhere(ev.target) || ev.clipboardData?.files.length) return;
      const text = pasteText(ev.clipboardData?.getData('text') ?? '');
      if (!text) return;
      ev.preventDefault();
      backlog.push({ text });
    };
    const onComposed = (ev: CompositionEvent) => {
      if (!elsewhere(ev.target) && ev.data) backlog.push({ text: ev.data });
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('paste', onPaste, true);
    window.addEventListener('compositionend', onComposed, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('paste', onPaste, true);
      window.removeEventListener('compositionend', onComposed, true);
    };
  }, [directOn, backlog]);

  // Zoom: the focused pane alone, and back to the tiles it came from, in
  // their places and arrangement; from a pane opened alone, the window's
  // panes side by side in the window's order, up to four; a window of one
  // pane shows its mirror layout instead.
  // The zoom is drawn (drawn.ts): the tile switches off to a line that
  // travels to its new place and opens there, unless effects are off.
  const animated = useCallback((address: string, change: () => void) => {
    drawn(change, address);
  }, []);
  const zoom = useCallback(
    (p: Pane) => {
      if (several) {
        unzoomed = { panes: addresses, layout, custom, weights };
        animated(p.address, () => go([p.address]));
        return;
      }
      if (unzoomed && unzoomed.panes.includes(p.address)) {
        const back = unzoomed.panes;
        focusNext = p.address;
        animated(p.address, () => go(back));
        return;
      }
      const mates = (all.data ?? [])
        .filter(
          (q) =>
            q.hub === p.hub &&
            q.host === p.host &&
            q.session === p.session &&
            q.window_index === p.window_index,
        )
        .map((q) => q.address);
      if (mates.length < 2) {
        // The window view is this hub's own.
        if (!p.hub) navigate({ to: `/w/${p.host}/${p.session}/${p.window_index}` });
        return;
      }
      const others = mates.filter((a) => a !== p.address).slice(0, MAX_TILES - 1);
      const back = mates.filter((a) => a === p.address || others.includes(a));
      focusNext = p.address;
      animated(p.address, () => go(back));
    },
    [several, addresses, layout, weights, all.data, go, navigate, animated],
  );
  const focusedFit = fit[focused] ?? writable;
  // Laying a tile across: onto a divider, its split; from an edge strip or
  // e / E, the whole view, on the side the tile's middle is.
  const rearrangeable = several && (!oneWindow || movable);
  const places = rects(shape, weights);
  const lay = (i: number, key: string, wrap: 'h' | 'v', first: boolean) => {
    if (!rearrangeable) {
      refused('moving these panes needs every pane of the window writable');
      return;
    }
    touch();
    drawn(() => {
      setCustom(across(shape, i, key, wrap, first));
      setLayout('custom');
      setWeights({});
    });
  };
  const spread = (i: number, axis: 'w' | 'h') => {
    const r = places.get(i);
    const key = rootKey(shape);
    if (!r || !key || (axis === 'w' ? r.w : r.h) > 0.999) return;
    if (axis === 'w') lay(i, key, 'v', r.y + r.h / 2 < 0.5);
    else lay(i, key, 'h', r.x + r.w / 2 < 0.5);
  };
  const edgesOf = (i: number): Edges | undefined => {
    const r = places.get(i);
    if (!r) return undefined;
    return {
      left: r.x > 0.001,
      right: r.x + r.w < 0.999,
      top: r.y > 0.001,
      bottom: r.y + r.h < 0.999,
    };
  };
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
        windowFit={!!oneWindow}
        windowFitted={windowFit}
        alone={!several}
        zoomable={siblings(a)}
        refitTick={i === index ? refitTick : 0}
        dragging={dragging}
        onFocus={() => setFocusedIndex(i)}
        onClose={() => closeTile(a)}
        onGone={() => {
          toast.push({ kind: 'gone', title: `${a} is gone` });
          closeTile(a);
        }}
        minimisable={several}
        onMinimise={() => minimise(a)}
        hostCloses={hostCloses(a)}
        asking={asking === a}
        onAsk={() => setAsking(a)}
        onAnswer={(yes) => void answer(a, yes)}
        onFit={() => toggleFit(a)}
        onFile={(name) => show({ address: a, name })}
        onPath={hostPreviews(a) ? (path) => show({ address: a, path }) : undefined}
        previews={hostPreviews(a)}
        changesOpen={i === index && showsChanges}
        onChanges={() => {
          setFocusedIndex(i);
          setChanges((c) => (i === index ? !c : true));
        }}
        direct={i === index && directOn}
        onDirect={() => {
          setFocusedIndex(i);
          enterDirect();
        }}
        panel={
          i === index && hostPreviews(a) ? (
            <Closing open={showsChanges}>
              <ChangesWindow
                address={a}
                direct={directOn}
                folded={changesFolded}
                onFold={() => setChangesFolded((f) => !f)}
                onClose={() => setChanges(false)}
                onOpen={(c, root) =>
                  show({ address: a, path: c.path, change: { kind: c.kind, root } })
                }
              />
            </Closing>
          ) : undefined
        }
        slack={slack}
        onCopied={(rows) =>
          toast.push({
            kind: 'copied',
            title: rows ? `${rows} ${rows === 1 ? 'row' : 'rows'}` : 'refused by the browser',
          })
        }
        onPrompt={() => {
          setFocusedIndex(i);
          focusLine();
        }}
        onDragStart={() => setDragging(a)}
        onDragEnd={() => setDragging(null)}
        onDrop={(zone) => {
          if (oneWindow && !movable && dragging && dragging !== a) {
            refused('moving these panes needs every pane of the window writable');
            setDragging(null);
            return;
          }
          touch();
          if (dragging && dragging !== a && zone !== 'swap') {
            drawn(() => {
              setCustom(dropOn(shape, addresses.indexOf(dragging), i, zone));
              setLayout('custom');
              setWeights({});
            });
            setDragging(null);
            return;
          }
          if (dragging && dragging !== a) drawn(() => go(swap(addresses, dragging, a)));
          setDragging(null);
        }}
        onZoom={zoom}
        refused={refused}
        edges={edgesOf(i)}
        onSpread={rearrangeable ? (axis) => spread(i, axis) : undefined}
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
          panes={stripPanes}
          open={addresses}
          focused={focused}
          onTab={onTab}
          reorder={reorder}
          onZoom={(a) => {
            const p = (all.data ?? []).find((q) => q.address === a);
            if (p) zoom(p);
          }}
          addable
        />
        <AddMenu
          pane={focusedPane}
          open={addresses}
          minimised={minimised}
          onMade={async (a) => {
            // tmux numbers panes by place, so a pane split beside an open
            // one can shift its neighbours' addresses: the open tiles
            // follow their panes by id through a fresh listing.
            const ids = addresses.map(
              (x) => (all.data ?? []).find((q) => q.address === x)?.pane_id,
            );
            const { hub } = splitAddress(addresses[0]);
            await qc.invalidateQueries({ queryKey: keys.panesOf(hub) });
            const list = qc.getQueryData<Pane[]>(keys.panesOf(hub)) ?? [];
            const kept = addresses.map(
              (x, i) => (ids[i] && list.find((q) => q.pane_id === ids[i])?.address) || x,
            );
            if (kept.length < MAX_TILES) {
              focusNext = a;
              go([...kept.filter((x) => x !== a), a]);
            } else go(replace(kept, index, a));
          }}
          onPick={restore}
          onRefused={refused}
        />
        <Tools
          tools={[
            ...(several
              ? [
                  {
                    id: 'arrange',
                    glyph: '▦',
                    label: 'arrange',
                    onClick: () => {
                      touch();
                      drawn(() => setLayout((l) => next(l, n)));
                    },
                    disabled: !!oneWindow && !movable,
                    title:
                      oneWindow && !movable
                        ? 'the panes of this window move only when every one is writable'
                        : `next arrangement (l): ${options(n).join(', ')}`,
                  },
                  {
                    id: 'equal',
                    glyph: '⊞',
                    label: 'equal',
                    onClick: () => {
                      touch();
                      drawn(() => setWeights({}));
                    },
                    disabled: !!oneWindow && !movable,
                    title:
                      oneWindow && !movable
                        ? 'the panes of this window move only when every one is writable'
                        : 'equal shares in every split (=); with fit on, the host follows',
                  },
                ]
              : []),
            ...(writable
              ? [
                  {
                    id: 'fit',
                    glyph: '⤢',
                    label: 'fit',
                    onClick: () => toggleFit(focused),
                    on: focusedFit,
                    title: `fit: the host pane follows this tile (f), ${focusedFit ? 'on' : 'off'}; F: every tile`,
                  },
                ]
              : []),
            ...(writable
              ? [
                  {
                    id: 'direct',
                    glyph: '▮',
                    label: 'direct',
                    onClick: () => (directOn ? setDirect(false) : enterDirect()),
                    on: directOn,
                    title: directOn
                      ? 'direct: keys go to the pane as pressed; Shift+Esc or this leaves'
                      : 'direct: keys go to the pane as pressed (i); Shift+Esc leaves',
                  },
                ]
              : []),
            ...(writable && hostPreviews(focused)
              ? [
                  {
                    id: 'changes',
                    glyph: '⎇',
                    label: 'changes',
                    onClick: () => setChanges((c) => !c),
                    on: changes,
                    title: "git's changes of the pane's repository, over the tile (g)",
                  },
                ]
              : []),
            ...(focusedPane
              ? [
                  {
                    id: 'zoom',
                    glyph: '⊡',
                    label: 'zoom',
                    onClick: () => zoom(focusedPane),
                    on: !several,
                    title: several
                      ? 'this pane alone (z, Enter, or double-click)'
                      : focusedPane.hub
                        ? "the window's panes side by side (z, or double-click)"
                        : "the window's panes side by side (z, or double-click); w: the mirror layout",
                  },
                ]
              : []),
            {
              id: 'open-palette',
              glyph: '≡',
              label: 'go to',
              onClick: requestPalette,
              title: 'go to a pane (p)',
            },
          ]}
        />
      </InHeader>
      <div className="mx-area" ref={area} data-window-fit={windowFit ? '' : undefined}>
        <Tree
          node={shape}
          weights={weights}
          setWeights={(f) => {
            touch();
            setWeights(f);
          }}
          tile={tile}
          dragging={!!dragging}
          onAcross={
            dragging
              ? (key, wrap, first) => {
                  lay(addresses.indexOf(dragging), key, wrap, first);
                  setDragging(null);
                }
              : undefined
          }
        />
      </div>
      <MinimisedRow
        addresses={minimised}
        onRestore={restore}
        onGone={(a) => setMinimised((m) => m.filter((x) => x !== a))}
      />
      <InputPanel
        pane={focusedPane}
        writable={writable}
        placeholder={
          focusedPane
            ? writable
              ? directOn
                ? 'direct · keys go to the pane · Shift+Esc or a click here types on the line'
                : several
                  ? `type into ${focused}`
                  : 'type · Enter sends · Shift+Enter new line · Esc leaves'
              : 'read-only pane'
            : 'no pane'
        }
        direct={directOn}
        onLeaveDirect={() => setDirect(false)}
        send={send}
        onGrow={(px) => {
          grown.current = px;
        }}
        words={words}
      >
        {focusedPane && !writable && (
          <div className="mx-readonly" data-testid="readonly">
            read-only: your grant or the pane's mark does not allow typing
          </div>
        )}
      </InputPanel>
      <Closing open={showing && !!shown}>
        {shown && (
          <FileWindow
            shown={shown}
            onClose={hide}
            onFile={(name) => show({ address: shown.address, name })}
            onPath={
              hostPreviews(shown.address)
                ? (path) => show({ address: shown.address, path })
                : undefined
            }
          />
        )}
      </Closing>
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
