import { useNavigate, useParams } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, target } from '../api/client';
import { queryClient } from '../query';
import { useQueryClient } from '@tanstack/react-query';
import {
  closePane,
  hostOf,
  keys,
  resizePane,
  sendInput,
  typeLine,
  useAllPanes,
  useChanges,
  useHosts,
  useInput,
  useLater,
  useListing,
  usePane,
  usePaneCached,
} from '../api/queries';
import { isShell, SHELL_COMMANDS, useRecent } from '../term/commands';
import { lineFor, nameIndex, shellQuote, titleFor } from '../term/names';
import { firstWord, nextShadow, screenCommands, suggest } from '../term/suggest';
import { parse } from '../term/sgr';
import { joinAddress, splitAddress } from '../hubs';
import type { Mouse, Pane, PaneContent, TalkPartner } from '../api/types';
import { ChainMark, MailMark } from '../components/TalkMark';
import { groupsOf } from '../term/groups';
import { nameOf } from '../components/Talk';
import { Divider } from '../components/Divider';
import { InputPanel } from '../components/InputPanel';
import { LensMark } from '../components/Lens';
import { Choices } from '../components/Choices';
import { MinimisedRow } from '../components/Minimised';
import { PaneTitle, RenameField, paneTooltip, slowSecond } from '../components/PaneTitle';
import { Tabs } from '../components/Tabs';
import { useToast } from '../components/Toast';
import { noteChange, noteOwn, useLens, onTouch } from '../term/lens';
import { drawn, nameFor, useMoving } from '../term/drawn';
import { inOrder, move, rowOrder, step } from '../term/order';
import { setTabOrder, useHelper, useTabOrder } from '../settings';
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
import { CLIENT_LABEL } from '../term/client';
import { heldWords, holderOf, refitOnTouch } from '../term/holder';
import { cellsFor, inner } from '../term/measure';
import { releaseKept, useFit } from '../term/useFit';
import { screenWords } from '../term/complete';
import { countOf, summary } from '../term/changes';
import { Backlog, keyToBody, paneChord, pasteText, splitText, type Body } from '../term/direct';
import { setHeading } from '../shell/heading';
import { openMailWindow } from '../shell/mailwin';
import { InHeader } from '../shell/HeaderSlot';
import { AddMenu } from '../components/AddMenu';
import { Closing } from '../components/Closing';
import { FileWindow, type Shown } from '../components/FileWindow';
import { ShareWindow, sharesOf, useShares } from '../components/ShareWindow';
import { ChangesWindow } from '../components/Changes';
import { Tools } from '../components/Tools';
import { requestPalette } from '../term/intent';
import {
  deskPanes,
  knownDesk,
  noteDesk,
  sameDesk,
  useDesk,
  writeDesk,
  type Desk,
} from '../api/desk';
import { setLastPlace, setTabOrder as keepTabOrder } from '../settings';

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
// The later marks this client asked the host for and the listing has not
// shown yet, by address: a pane minimised is the row's at once and one
// brought back a tile at once, whatever the next listing still says.
const parking = new Map<string, boolean>();
// The tiles the listing has shown awake. One the listing then says is
// parked was parked by another client and goes to the row; a tile never
// seen awake was opened parked, and is woken.
const awakeTiles = new Set<string>();

// How long a tile shows its last frame while the host catches up with a fit.
const HOLD_FRAME_MS = 3000;

// The last settled frame of each pane, shown again when the pane comes
// back into a tile while the host catches up. Kept by address, trusted
// by pane: an address is a position, and the host renumbers panes when
// one closes, so a frame is used only for the pane it was taken from.
const frames = new Map<string, PaneContent>();

// Which pane a tile shows: the host's id, with the hub the pane came
// from. A tile learns it from the listing when it opens (or from its
// first frame when the listing has no entry yet) and keeps it: a frame
// of any other pane is never drawn in it.
export interface Identity {
  hub?: string;
  host: string;
  pane_id: string;
}
export const identityOf = (p: Pane): Identity => ({ hub: p.hub, host: p.host, pane_id: p.pane_id });
const sameIdentity = (a: Identity, b: Identity) =>
  (a.hub ?? '') === (b.hub ?? '') && a.host === b.host && a.pane_id === b.pane_id;

// How long the CRT warm-up plays over a tile once its first frame is in.
const WARMUP_MS = 600;

export function forgetFrames() {
  frames.clear();
  parking.clear();
  awakeTiles.clear();
}

// Pane views open; the last one gone releases the panes kept fitted.
let views = 0;

// openingDesk lays the desk's view out for the tiles about to open: the
// arrangement and the focus travel over the navigation as a closed
// tile's do.
export function openingDesk(d: Desk) {
  const panes = deskPanes(d);
  carried = {
    panes,
    layout: d.arrangement ?? defaultFor(window.innerWidth > window.innerHeight),
    custom: d.tree ?? null,
    weights: d.weights ?? {},
  };
  focusNext = d.focused && panes.includes(d.focused) ? d.focused : null;
}

// The pane view, as the Android client has it: a strip of every pane the
// token may read, painted with its state; one to eight of them open as
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

// A click on a name types a line into the pane, as a click on a cell
// sends a click: what it typed shows soon, and once more a little later.
async function typeInto(
  address: string,
  text: string,
  enter: boolean,
  refused: (why: string) => void,
) {
  try {
    await typeLine(address, text, enter);
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
  // The pane this tile is for, from the listing; learnt from the first
  // frame when the view had none. The first frame drawn confirms it.
  identity?: Identity;
  onIdentity: (id: Identity) => void;
  // A frame of another pane came for this address.
  onStranger: () => void;
  // The tile out of the arrangement, its pane parked for later, into the
  // minimised row; the last tile makes way for the next pane, or the
  // list. Off, with the reason, where the pane cannot be parked.
  onMinimise: () => void;
  hostParks: boolean;
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
  // The host lists directories: in a writable shell pane the names of
  // its directory are links.
  lists: boolean;
  // The ghost word after the cursor, while direct typing lands here.
  ghost?: string;
  changesOpen: boolean;
  onChanges: () => void;
  onShare: () => void;
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
  // Whether a drop may split this tile's place; without, the whole tile
  // is the middle (eight open and a pane not open dragged in).
  splittable: boolean;
  onZoom: (p: Pane) => void;
  refused: (why: string) => void;
  // The tile's edges inside the area; a click on the strip along one lays
  // the tile across the whole view, its width or its height.
  edges?: Edges;
  onSpread?: (axis: 'w' | 'h') => void;
  // Talk: the name of a pane this one talked with, laying it beside, and
  // whether the tile is in a group (framed).
  partnerName: (p: TalkPartner) => string;
  onBeside: (p: TalkPartner) => void;
  grouped?: boolean;
  // The name as a field: a slow second click on it, or N, asks; the
  // host names panes and the pane is writable.
  renamable: boolean;
  renaming: boolean;
  onRename: (on: boolean) => void;
}

// The leaves of a tile tree: the tiles' indexes under it.
function leavesOf(t: TileNode): number[] {
  return typeof t === 'number' ? [t] : t.children.flatMap(leavesOf);
}

type Edge = 'left' | 'right' | 'top' | 'bottom';
type Edges = Record<Edge, boolean>;
const EDGE_GLYPH: Record<Edge, string> = { left: '«', right: '»', top: '˄', bottom: '˅' };

function Tile(props: TileProps) {
  // What last pressed on the tile's body: a touch keeps the line's ways.
  const pointer = useRef('mouse');
  const { address, focused, several, refitTick, dragging, alone, zoomable, windowFit } = props;
  const pane = usePane(address, focused ? 1_000 : 2_000);
  const titleClickAt = useRef<number>(undefined);
  const moving = useMoving();
  const box = useRef<HTMLDivElement>(null);
  // A frame is the tile's own when it is its pane's. Without an identity
  // yet, the first frame names the pane.
  const learnt = useRef<Identity | null>(null);
  const identity = props.identity ?? learnt.current;
  const mine = (f: PaneContent | undefined): f is PaneContent =>
    !!f && (!identity || sameIdentity(identityOf(f.pane), identity));
  useEffect(() => {
    if (!props.identity && !learnt.current && pane.data)
      learnt.current = identityOf(pane.data.pane);
  }, [props.identity, pane.data]);
  const data = mine(pane.data) ? pane.data : undefined;
  const p = data?.pane;
  // The first frame drawn confirms which pane this is.
  const { onIdentity } = props;
  const confirmed = useRef(false);
  useEffect(() => {
    if (p && !confirmed.current) {
      confirmed.current = true;
      onIdentity(identityOf(p));
    }
  }, [p, onIdentity]);
  const stranger = !!pane.data && !data;
  const { onStranger } = props;
  useEffect(() => {
    if (stranger) onStranger();
  }, [stranger, pane.data, onStranger]);
  const writable = p?.mode === 'write';
  // The names of a shell pane's directory, when the host lists it for
  // this writer and the person wants them: a click enters a directory or
  // opens a file the way they set; Shift+click only puts the name on the
  // pane's line.
  const helper = useHelper();
  const listingOn = props.lists && writable && helper.names && !!p && isShell(p.command);
  const listing = useListing(address, p?.cwd, listingOn, focused ? 2_000 : 5_000);
  // A listing kept from before the shell gave the pane away is no listing.
  const entries = listingOn ? listing.data?.entries : undefined;
  const names = useMemo(() => (entries ? nameIndex(entries) : undefined), [entries]);
  const open = helper.open;
  const { onPath, refused } = props;
  const onName = useCallback(
    (name: string, kind: 'dir' | 'file', shift: boolean) => {
      if (shift) {
        void typeInto(address, shellQuote(name) + ' ', false, refused);
        return;
      }
      const line = lineFor(kind, name, open);
      if (line === null) onPath?.(name);
      else void typeInto(address, line, true, refused);
    },
    [address, open, onPath, refused],
  );
  const nameTitle = useCallback(
    (name: string, kind: 'dir' | 'file') => titleFor(kind, name, open),
    [open],
  );
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
  const kept = () => {
    const f = frames.get(address);
    return f && mine(f) ? f : null;
  };
  const frame = useRef<PaneContent | null>(kept());
  const [, bump] = useState(0);
  const since = useRef(Date.now());
  useEffect(() => {
    since.current = Date.now();
    frame.current = kept();
    // A kept frame of another pane at this address is no use to anyone.
    const f = frames.get(address);
    if (f && !mine(f)) frames.delete(address);
  }, [address]);
  useEffect(() => {
    const t = window.setTimeout(() => bump((n) => n + 1), HOLD_FRAME_MS + 50);
    return () => window.clearTimeout(t);
  }, [address, asked]);
  const sentAt = asked?.at ?? since.current;
  let shown = data;
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
  // Who holds the window's size, from the listing: another client's fit
  // is named in the header, and the client touched last wins: typing
  // here, a key, this tile focused or the page come back to sends this
  // browser's fit again, two seconds apart at most; nobody's, or this
  // browser's own, sends nothing.
  const hToken = sp?.sized_by?.token;
  const hClient = sp?.sized_by?.client;
  const hMine = sp?.sized_by?.mine;
  const holder = useMemo(
    () =>
      holderOf(
        hToken === undefined
          ? undefined
          : { token: hToken, client: hClient ?? '', at: 0, mine: !!hMine },
        CLIENT_LABEL,
      ),
    [hToken, hClient, hMine],
  );
  const heldBy = held ? heldWords(holder) : 'held';
  const otherHolds = fitting && holder.kind === 'other';
  const lastTouchFit = useRef(0);
  const touch = useCallback(() => {
    if (!otherHolds) return;
    const now = Date.now();
    if (!refitOnTouch(holder, lastTouchFit.current, now)) return;
    lastTouchFit.current = now;
    refit();
  }, [otherHolds, holder, refit]);
  useEffect(() => onTouch(address, touch), [address, touch]);
  // Taking the focus is a touch; keeping it is not.
  const wasFocused = useRef(false);
  useEffect(() => {
    if (focused && !wasFocused.current) touch();
    wasFocused.current = focused;
  }, [focused, touch]);
  useEffect(() => {
    if (!focused) return;
    const back = () => touch();
    window.addEventListener('focus', back);
    return () => window.removeEventListener('focus', back);
  }, [focused, touch]);
  // The warm-up: over the box while the tile has nothing of its own to
  // draw, and for a moment more once its first frame is in, so the frame
  // comes up through the bloom.
  const hasOwn = !!shown;
  const [warm, setWarm] = useState(() => !hasOwn);
  useEffect(() => {
    if (!hasOwn) return;
    const t = window.setTimeout(() => setWarm(false), WARMUP_MS);
    return () => window.clearTimeout(t);
  }, [hasOwn]);
  // A change of content while the tile reads the pane counts as working,
  // unless it is the first read or the pane was just resized: that is the
  // reflow, not the program.
  const content = data?.content;
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
      data-group={props.grouped ? '' : undefined}
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
          setOver(
            props.splittable
              ? zoneAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
              : 'swap',
          );
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
    >
      <div
        className="mx-tile-head mx-painted"
        data-state={st === 'quiet' ? undefined : st}
        data-mode={p?.mode}
        onClick={props.onFocus}
        onDoubleClick={() => p && props.onZoom(p)}
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
        {p && props.renaming ? (
          <RenameField pane={p} onDone={() => props.onRename(false)} />
        ) : p ? (
          <PaneTitle
            pane={p}
            folder={p.cwd}
            title={paneTooltip(p)}
            onClick={
              props.renamable
                ? () => {
                    const now = Date.now();
                    if (focused && slowSecond(titleClickAt.current, now)) props.onRename(true);
                    titleClickAt.current = now;
                  }
                : undefined
            }
          />
        ) : (
          <span>{address}</span>
        )}
        {p && (
          <>
            {p.mode !== 'write' && <span className="mx-mode read">read-only</span>}
            {p.talk && p.talk.length > 0 && (
              <button
                type="button"
                className="mx-talk-link"
                data-testid="talk-link"
                title={`talks with ${p.talk.map(props.partnerName).join(', ')}: lay it beside (L)`}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onBeside(p.talk![0]);
                }}
              >
                <ChainMark />
              </button>
            )}
            {p.mail && (
              <MailMark unread={p.mail.unread} onClick={() => openMailWindow({ address })} />
            )}
            <span
              className="mx-size"
              data-testid={focused ? 'pane-size' : undefined}
              data-shown={held || syncing ? '' : undefined}
            >
              {p.width}×{p.height}
            </span>
            {held && (
              <span
                className="mx-warn"
                title={
                  holder.kind === 'other'
                    ? "another client holds this window's size: typing here takes it back"
                    : "the host could not give this tile's size: another tile's fit shares the axis, or the host's floor"
                }
                data-testid="held"
              >
                {heldBy}
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
                data-testid={
                  focused && st === 'waiting'
                    ? 'pane-attention'
                    : focused && st === 'later'
                      ? 'pane-later'
                      : undefined
                }
              >
                <LensMark status={st} attention={p.attention} withWord />
                {p.attention?.text &&
                (p.attention.kind === 'question' || p.attention.kind === 'permission')
                  ? `: ${p.attention.text}`
                  : ''}
              </span>
            )}
            {(st === 'waiting' || st === 'later') && (
              <Choices address={address} attention={p.attention} writable={p.mode === 'write'} />
            )}
          </>
        )}
        <span className="mx-spacer" />
        {p && (p.shared ?? 0) > 0 && (
          <button
            type="button"
            className="mx-tile-changes mx-tile-shared"
            title={`shared read-only: ${p.shared} ${p.shared === 1 ? 'link' : 'links'} live (s)`}
            data-testid="tile-shared"
            onClick={(e) => {
              e.stopPropagation();
              props.onShare();
            }}
          >
            ⇗ {p.shared}
          </button>
        )}
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
              !writable
                ? 'minimise: the pane is parked for later; needs a writable pane'
                : !props.hostParks
                  ? 'minimise: the pane is parked for later; the host is older than this'
                  : props.alone
                    ? 'minimise: the pane is parked for later, its tab goes to the row above the keys and the next pane takes the tile, or the list (-, d)'
                    : 'minimise: the pane is parked for later and its tab goes to the row above the keys (-, d)'
            }
            disabled={!writable || !props.hostParks}
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
            {p.last ? `end session ${p.session} on ${p.host}?` : `close the pane on ${p.host}?`}{' '}
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
        {warm && (
          <div
            className="mx-warmup"
            data-testid="warmup"
            data-warm={hasOwn ? '0' : '1'}
            aria-hidden="true"
          />
        )}
        <Screen
          content={shown?.content ?? ''}
          burn={!pane.isPlaceholderData && hasOwn}
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
          names={names}
          onName={names ? onName : undefined}
          nameTitle={nameTitle}
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
          ghost={props.direct ? props.ghost : undefined}
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
  // Two tiles talked lately: the divider between them is their chain.
  linked: (a: number, b: number) => boolean;
}

function Tree(props: TreeProps) {
  const { node, weights, setWeights, tile, dragging, onAcross, linked } = props;
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
              chained={leavesOf(c).some((x) =>
                leavesOf(node.children[i + 1]).some((y) => linked(x, y)),
              )}
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
  // Which pane each tile is for, learnt from the listing when the tile
  // opens; the tiles follow their panes when the host renumbers them,
  // and close when their pane is in no listing while its host is.
  const identities = useRef(new Map<string, { id: Identity; confirmed: boolean }>());
  // The tiles whose read found no pane at their address: the listing
  // says whether the pane moved or is gone.
  const missing = useRef(new Set<string>());
  const [missingTick, setMissingTick] = useState(0);
  const strangerAt = useRef(0);
  const listed = all.data;
  useEffect(() => {
    if (!listed) return;
    for (const a of addresses) {
      if (identities.current.has(a)) continue;
      const e = listed.find((q) => q.address === a);
      if (e) identities.current.set(a, { id: identityOf(e), confirmed: false });
    }
  }, [listed, addresses]);
  const [focusedIndex, setFocusedIndex] = useState(() => {
    const at = focusNext ? addresses.indexOf(focusNext) : -1;
    focusNext = null;
    return Math.max(at, 0);
  });
  const index = Math.min(focusedIndex, n - 1);
  const focused = addresses[index];
  const hosts = useHosts();
  const hostParks = (a: string) => !!hostOf(hosts.data, a)?.later;
  // Minimise is the later mark on the host: a write, for a writable pane
  // on a host whose agent parks; a reader sees the mark and cannot move
  // it. The mark asked for counts at once (parking), until the listing
  // shows it or the hub refuses it.
  const later = useLater();
  const [parkTick, setParkTick] = useState(0);
  const canPark = (a: string) => {
    const p = (all.data ?? []).find((q) => q.address === a);
    return !!p && p.mode === 'write' && hostParks(a);
  };
  const setLater = (a: string, on: boolean) => {
    const p = (all.data ?? []).find((q) => q.address === a);
    if (!p || p.mode !== 'write' || !hostParks(a)) return;
    if (!!p.later === on) {
      if (parking.delete(a)) setParkTick((t) => t + 1);
      return;
    }
    parking.set(a, on);
    setParkTick((t) => t + 1);
    later.mutate(
      { address: a, later: on },
      {
        onError: (err) => {
          parking.delete(a);
          setParkTick((t) => t + 1);
          toast.push({ kind: 'later', title: a, text: String(err) });
        },
      },
    );
  };
  const isLater = useCallback((p: Pane) => parking.get(p.address) ?? !!p.later, [parkTick]);
  // The minimised row: the panes parked for later, less the tiles here,
  // oldest parking first, read from the listing like the strip.
  const minimised = useMemo(
    () => rowOrder((all.data ?? []).filter((p) => isLater(p) && !addresses.includes(p.address))),
    [all.data, addresses, isLater],
  );
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
  // The share window over the focused tile, and the live shares of the
  // page's panes, so the file window knows whom to tell what it shows.
  const [share, setShare] = useState(false);
  const shares = useShares(focused, !!focusedPane);
  const sharesFor = (address: string) =>
    sharesOf(
      shares.data,
      (all.data ?? []).find((q) => q.address === address),
    ).map((s) => s.id);
  const [dragging, setDragging] = useState<string | null>(null);
  // The tile whose header asks whether to close its pane on the host.
  const [asking, setAsking] = useState<string | null>(null);
  const hostCloses = (a: string) => !!hostOf(hosts.data, a)?.close;
  const hostPreviews = (a: string) => !!hostOf(hosts.data, a)?.preview;
  const hostLists = (a: string) => !!hostOf(hosts.data, a)?.dir;
  const hostRenames = (a: string) => !!hostOf(hosts.data, a)?.rename;
  // The pane whose name is a field right now.
  const [renaming, setRenaming] = useState<string | null>(null);
  const renamable = (a: string) =>
    hostRenames(a) && (all.data ?? []).find((q) => q.address === a)?.mode === 'write';
  // Direct typing: keys go to the focused pane as pressed, while it is
  // writable; focusing a read-only tile ends it, as does leaving the view.
  const [direct, setDirect] = useState(false);
  const directOn = direct && writable;
  // The ghost word for the focused shell pane: the shadow of the line
  // typed direct, the pool of known lines (this browser's sent lines, the
  // commands the screen shows, the starters) and the directory's names;
  // drawn where the cursor row confirms it, accepted with Right.
  const helper = useHelper();
  const recent = useRecent();
  const focusedShell = !!focusedPane && isShell(focusedPane.command);
  const ghosting = helper.suggest && writable && focusedShell;
  const focusedListing = useListing(focused, focusedPane?.cwd, ghosting && helper.names, 5_000);
  const focusedEntries = ghosting ? focusedListing.data?.entries : undefined;
  const focusedNames = useMemo(
    () => (focusedEntries ? nameIndex(focusedEntries) : undefined),
    [focusedEntries],
  );
  const [shadow, setShadow] = useState<string | null>(null);
  const rows = useMemo(
    () =>
      ghosting ? parse(focusedCached?.content ?? '').map((l) => l.map((s) => s.text).join('')) : [],
    [ghosting, focusedCached?.content],
  );
  const cursorIndex =
    focusedPane?.cursor_y && focusedPane.height
      ? rows.length -
        (focusedPane.height - (focusedCached?.trimmed ?? 0)) +
        focusedPane.cursor_y -
        1
      : -1;
  const pool = useMemo(
    () => [...recent, ...screenCommands(rows, cursorIndex), ...SHELL_COMMANDS.map((c) => c.text)],
    [recent, rows, cursorIndex],
  );
  const ghost = useMemo(() => {
    if (
      !ghosting ||
      !directOn ||
      !focusedPane?.cursor_x ||
      cursorIndex < 0 ||
      cursorIndex >= rows.length
    )
      return null;
    return suggest(rows[cursorIndex], focusedPane.cursor_x, shadow, pool, focusedNames);
  }, [ghosting, directOn, focusedPane?.cursor_x, cursorIndex, rows, shadow, pool, focusedNames]);
  const ghostRef = useRef(ghost);
  ghostRef.current = ghost;
  // The shadow is the focused pane's while direct typing is on.
  useEffect(() => {
    setShadow(null);
  }, [focused, directOn]);
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
  // A tile closed in the view; the last one goes back to the list, a
  // parked pane staying parked.
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
  // The listing moved or lost a tile's pane: the tile goes with it, or
  // goes. A pane in no listing is gone when its read found no pane at
  // the address, or when its host is listed without it (another pane
  // sits at the address now). That holds for a pane a frame confirmed;
  // an identity the listing alone gave may have come from a listing a
  // second stale, so a later listing naming another pane at the address
  // corrects it rather than closing a tile just opened. A tile whose
  // pane the view never knew goes on its read alone, as before.
  useEffect(() => {
    if (!listed) return;
    for (const [i, a] of addresses.entries()) {
      const entry = identities.current.get(a);
      if (!entry) {
        if (missing.current.has(a)) {
          missing.current.delete(a);
          toast.push({ kind: 'gone', title: `${a} is gone` });
          closeTile(a);
          return;
        }
        continue;
      }
      const { id, confirmed } = entry;
      const now = listed.find((q) => sameIdentity(identityOf(q), id));
      if (!confirmed) {
        const at = listed.find((q) => q.address === a);
        if (at && !sameIdentity(identityOf(at), id))
          identities.current.set(a, { id: identityOf(at), confirmed: false });
        else if (!at && !now && missing.current.has(a)) {
          identities.current.delete(a);
          missing.current.delete(a);
          toast.push({ kind: 'gone', title: `${a} is gone` });
          closeTile(a);
          return;
        }
        continue;
      }
      if (now && now.address !== a) {
        identities.current.delete(a);
        identities.current.set(now.address, entry);
        missing.current.delete(a);
        void go(replace(addresses, i, now.address));
        return;
      }
      const hostListed = listed.some((q) => (q.hub ?? '') === (id.hub ?? '') && q.host === id.host);
      if (!now && (hostListed || missing.current.has(a))) {
        identities.current.delete(a);
        missing.current.delete(a);
        toast.push({ kind: 'gone', title: `${a} is gone` });
        closeTile(a);
        return;
      }
    }
  }, [listed, addresses, missingTick]);
  // A parked pane's tile leaves the arrangement, as a closed one; its tab
  // is the row's. The last tile makes way: the next awake pane of the
  // strip takes it, or, with none, the view goes back to the list, the
  // desk saying so.
  const leave = (a: string) => {
    if (addresses.length <= 1) {
      const next = awake(1);
      if (next) {
        focusNext = next;
        drawn(() => go([next]));
        return;
      }
      writeDesk({ view: 'list', order: tabOrder.slice(0, 64) }, true);
      void navigate({ to: '/' });
      return;
    }
    const rest = close(addresses, a);
    if (layout === 'custom' && rest.length > 1)
      carried = { panes: rest, layout, custom: prune(shape, addresses.indexOf(a)), weights: {} };
    drawn(() => go(rest));
  };
  // Minimise: the pane is parked for later on its host, and its tile
  // leaves for the row.
  const minimise = (a: string) => {
    if (!canPark(a)) return;
    awakeTiles.delete(a);
    setLater(a, true);
    leave(a);
  };
  // Back from the row, woken, as one more tile, focused; with eight open it
  // takes the focused tile's place, as a tab does.
  const restore = (a: string) => {
    setLater(a, false);
    drawn(() => {
      if (addresses.length < MAX_TILES) {
        focusNext = a;
        go([...addresses, a]);
      } else go(replace(addresses, index, a));
    });
  };
  // The listing confirms the marks asked for, which are then forgotten;
  // a tile it shows awake is noted; a tile it says is parked goes to the
  // row when another client parked it, and is woken when this view opened
  // it parked (a reader's stays, with the mark).
  useEffect(() => {
    if (!listed) return;
    let changed = false;
    for (const [a, on] of parking) {
      const p = listed.find((q) => q.address === a);
      if (p && !!p.later === on) {
        parking.delete(a);
        changed = true;
      }
    }
    for (const a of awakeTiles) if (!addresses.includes(a)) awakeTiles.delete(a);
    for (const a of addresses) {
      const p = listed.find((q) => q.address === a);
      if (!p) continue;
      if (!p.later) {
        awakeTiles.add(a);
        continue;
      }
      if (parking.get(a) === false) continue;
      if (awakeTiles.has(a)) {
        awakeTiles.delete(a);
        leave(a);
        break;
      }
      if (p.mode === 'write' && hostParks(a)) setLater(a, false);
    }
    if (changed) setParkTick((t) => t + 1);
  }, [listed, addresses]);
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
  // Talk: a partner's address as this page names it (a peer's panes carry
  // the hub's name), when the tiles were focused last, and laying the
  // partner beside a tile: swapped next to it when open, opened there
  // when not; with eight open it takes the place of the tile focused
  // longest ago among the others.
  const withHub = (a: string, partner: string) => joinAddress(splitAddress(a).hub, partner);
  const focusedAt = useRef(new Map<string, number>());
  useEffect(() => {
    focusedAt.current.set(focused, Date.now());
  }, [focused]);
  const beside = (a: string, partner: string) => {
    const i = addresses.indexOf(a);
    if (partner === a || i < 0) return;
    const j = addresses.indexOf(partner);
    const slot = i + 1 < n ? i + 1 : i - 1;
    if (j >= 0) {
      setFocusedIndex(i);
      if (Math.abs(j - i) !== 1) drawn(() => go(swap(addresses, partner, addresses[slot])));
      return;
    }
    if (n < MAX_TILES) {
      focusNext = a;
      go([...addresses.slice(0, i + 1), partner, ...addresses.slice(i + 1)]);
      return;
    }
    let victim = slot;
    let oldest = Infinity;
    for (const [k, x] of addresses.entries()) {
      const at = focusedAt.current.get(x) ?? 0;
      if (k !== i && at < oldest) {
        oldest = at;
        victim = k;
      }
    }
    setFocusedIndex(i);
    drawn(() => go(replace(addresses, victim, partner)));
  };
  const linked = (x: number, y: number) => {
    const pa = (all.data ?? []).find((p) => p.address === addresses[x]);
    return !!pa?.talk?.some((tp) => withHub(addresses[x], tp.address) === addresses[y]);
  };
  // Which tiles are in a group, for their frame.
  const groups = useMemo(() => groupsOf(all.data ?? []), [all.data]);

  // The desk: this view, written half a second after a change, and the
  // other clients' changes to it followed. The focus is the desk's on
  // opening only (focusNext, set by whoever opened the desk).
  const desk = useDesk();
  const tabOrder = useTabOrder();
  useEffect(() => setLastPlace('view'), []);
  const mine = useMemo<Desk>(
    () => ({
      view: 'panes',
      panes: addresses,
      focused,
      arrangement: layout,
      tree: layout === 'custom' && custom ? custom : undefined,
      weights: Object.keys(weights).length ? weights : undefined,
      order: tabOrder.slice(0, 64),
    }),
    [addresses, focused, layout, custom, weights, tabOrder],
  );
  useEffect(() => {
    writeDesk(mine);
  }, [mine]);
  useEffect(() => {
    const d = desk.data;
    if (!d || sameDesk(d, knownDesk()) || sameDesk(d, mine)) return;
    // A view opened by a link writes its own desk first; until the hub
    // has answered that, what it holds is older than this view, and a
    // desk older than the view's last write is never applied.
    const last = knownDesk()?.rev;
    if (!last || (d.rev ?? 0) < last) return;
    noteDesk(d);
    if (d.view === 'window' && d.window) {
      const [host, session, win] = d.window.split('/');
      void navigate({ to: `/w/${host}/${session}/${win}` });
      return;
    }
    const panes = deskPanes(d);
    if (!panes.length) return;
    if (d.order) keepTabOrder(d.order);
    if (panes.join() === addresses.join()) {
      if (d.arrangement) setLayout(d.arrangement);
      if (d.tree) setCustom(d.tree);
      setWeights(d.weights ?? {});
      return;
    }
    carried = {
      panes,
      layout: d.arrangement ?? defaultFor(window.innerWidth > window.innerHeight),
      custom: d.tree ?? null,
      weights: d.weights ?? {},
    };
    void go(panes);
  }, [desk.data]);
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

  // A change of count mounts the tiles anew.
  const go = useCallback(
    (next: string[]) => {
      if (next === addresses) return Promise.resolve();
      return navigate({ to: '/p/$', params: { _splat: routeFor(next) }, replace: true });
    },
    [addresses, navigate],
  );
  // The strip: the listing less the parked panes, which are the row's; a
  // reader's parked tile keeps its tab, since the reader cannot wake it.
  const shownPanes = useMemo(
    () => (all.data ?? []).filter((p) => !isLater(p) || addresses.includes(p.address)),
    [all.data, isLater, addresses],
  );
  // The strip in the owner's order; an open address the listing lacks
  // goes last.
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
  // A slow second click on the focused pane's tab asks for its name.
  const tabClick = useRef<{ address: string; at: number } | null>(null);
  const onTab = (address: string, add = false) => {
    const now = Date.now();
    const prev = tabClick.current;
    tabClick.current = { address, at: now };
    if (address === focused && prev?.address === address && slowSecond(prev.at, now)) {
      if (renamable(address)) setRenaming(address);
      return;
    }
    const at = addresses.indexOf(address);
    if (at >= 0) setFocusedIndex(at);
    else if (add && addresses.length < MAX_TILES) go([...addresses, address]);
    else go(replace(addresses, index, address));
  };
  // Android's swipe: the focused tile shows the neighbouring pane of the
  // strip. A parked pane is not on the way: it is the row's, not the
  // strip's, and only its tab there, the add menu, the list or the inbox
  // brings it back. The next pane of the strip from the focused one, not
  // open; past either end it comes round to the other.
  const awake = (step: number): string | undefined => {
    const at = strip.indexOf(focused);
    if (at < 0) return undefined;
    for (let i = 1; i < strip.length; i++) {
      const k = (((at + step * i) % strip.length) + strip.length) % strip.length;
      if (!addresses.includes(strip[k])) return strip[k];
    }
    return undefined;
  };
  const neighbour = (step: number) => {
    const next = awake(step);
    if (next) go(replace(addresses, index, next));
  };
  const toggleFit = (address: string, on?: boolean) =>
    setFit((f) => ({ ...f, [address]: on ?? !(f[address] ?? writable) }));

  // ] and [ go to the next pane: the next tile, or with one tile open the
  // strip's neighbour shown in it; Ctrl+] and Ctrl+[ the same from
  // anywhere, the line and direct typing included.
  const cycle = (d: number) => {
    if (several) setFocusedIndex((index + d + n) % n);
    else neighbour(d);
  };
  const cycleRef = useRef(cycle);
  cycleRef.current = cycle;
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const chord = paneChord(ev);
      if (chord) {
        cycle(chord);
        ev.preventDefault();
        ev.stopImmediatePropagation();
        return;
      }
      const target = ev.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey || directOn) return;
      if (ev.key === ']' || ev.key === '[') {
        cycle(ev.key === ']' ? 1 : -1);
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
      else if (ev.key === '-' || ev.key === 'd') minimise(focused);
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
      else if (ev.key === 's' && writable) setShare((s) => !s);
      else if (ev.key === 'i' && writable) enterDirect();
      else if (ev.key === 'N' && focusedPane && renamable(focused)) setRenaming(focused);
      else if (ev.key === 'L' && focusedPane?.talk?.length)
        beside(focused, withHub(focused, focusedPane.talk[0].address));
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
    // Every body sent moves the shadow of the line along with it.
    const push = (b: Body) => {
      setShadow((s) => nextShadow(s, b));
      backlog.push(b);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (elsewhere(ev.target)) return;
      // The pane chords move the focus and stay in direct typing: the next
      // pane is typed into at once. They never reach the pane.
      const chord = paneChord(ev);
      if (chord) {
        cycleRef.current(chord);
        ev.preventDefault();
        ev.stopImmediatePropagation();
        return;
      }
      if (ev.key === 'Escape' && ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        setDirect(false);
        ev.preventDefault();
        ev.stopImmediatePropagation();
        return;
      }
      // Right takes the ghost word whole, Ctrl+Right its first word, as
      // text; without a ghost they are the pane's keys.
      const g = ghostRef.current;
      if (g && ev.key === 'ArrowRight' && !ev.altKey && !ev.metaKey && !ev.shiftKey) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        push({ text: ev.ctrlKey ? firstWord(g) : g });
        return;
      }
      const body = keyToBody(ev, !!window.getSelection()?.toString());
      if (!body) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      push(body);
    };
    const onPaste = (ev: ClipboardEvent) => {
      if (elsewhere(ev.target) || ev.clipboardData?.files.length) return;
      const text = pasteText(ev.clipboardData?.getData('text') ?? '');
      if (!text) return;
      ev.preventDefault();
      // A long paste goes in pieces, in order, behind the request in flight.
      for (const piece of splitText(text)) push({ text: piece });
    };
    const onComposed = (ev: CompositionEvent) => {
      if (!elsewhere(ev.target) && ev.data) push({ text: ev.data });
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
  // panes side by side in the window's order, up to eight; a window of one
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
  // A tab of a pane not open, dropped on the view: the pane comes in as
  // one more tile where the drop says. The count is the route, so the
  // made tree travels over the navigation as a closed tile's does, and
  // the pane is focused once the tiles are up.
  const bring = (address: string, made: (leaf: number) => TileNode) => {
    const panes = [...addresses, address];
    carried = { panes, layout: 'custom', custom: made(n), weights: {} };
    focusNext = address;
    touch();
    drawn(() => go(panes));
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
          missing.current.add(a);
          setMissingTick((t) => t + 1);
          void qc.invalidateQueries({ queryKey: keys.panesOf() });
        }}
        onStranger={() => {
          // Another pane answers at this address: the listing says where
          // this tile's pane went, so it is asked for now, not in five seconds.
          if (Date.now() - strangerAt.current < 2_000) return;
          strangerAt.current = Date.now();
          void qc.invalidateQueries({ queryKey: keys.panesOf() });
        }}
        identity={identities.current.get(a)?.id}
        onIdentity={(id) => identities.current.set(a, { id, confirmed: true })}
        onMinimise={() => minimise(a)}
        hostParks={hostParks(a)}
        hostCloses={hostCloses(a)}
        asking={asking === a}
        onAsk={() => setAsking(a)}
        onAnswer={(yes) => void answer(a, yes)}
        onFit={() => toggleFit(a)}
        onFile={(name) => show({ address: a, name })}
        onPath={hostPreviews(a) ? (path) => show({ address: a, path }) : undefined}
        previews={hostPreviews(a)}
        lists={hostLists(a)}
        ghost={i === index ? (ghost ?? undefined) : undefined}
        changesOpen={i === index && showsChanges}
        onChanges={() => {
          setFocusedIndex(i);
          setChanges((c) => (i === index ? !c : true));
        }}
        onShare={() => {
          setFocusedIndex(i);
          setShare(true);
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
                relay={sharesFor(a).length ? { ids: sharesFor(a), hub: target(a).hub } : undefined}
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
          const from = dragging;
          setDragging(null);
          if (!from || from === a) return;
          if (!addresses.includes(from)) {
            // From the strip, a pane not open: the middle gives it this
            // tile's place, as a tab click does; an edge brings it in
            // beside, while there is room for one more.
            if (zone === 'swap' || n >= MAX_TILES) {
              touch();
              setFocusedIndex(i);
              drawn(() => go(replace(addresses, i, from)));
            } else bring(from, (leaf) => dropOn(shape, leaf, i, zone));
            return;
          }
          if (oneWindow && !movable) {
            refused('moving these panes needs every pane of the window writable');
            return;
          }
          touch();
          if (zone !== 'swap') {
            drawn(() => {
              setCustom(dropOn(shape, addresses.indexOf(from), i, zone));
              setLayout('custom');
              setWeights({});
            });
            return;
          }
          drawn(() => go(swap(addresses, from, a)));
        }}
        splittable={!dragging || addresses.includes(dragging) || n < MAX_TILES}
        onZoom={zoom}
        refused={refused}
        edges={edgesOf(i)}
        onSpread={rearrangeable ? (axis) => spread(i, axis) : undefined}
        partnerName={(tp) => nameOf(all.data, withHub(a, tp.address), tp.pane_id)}
        onBeside={(tp) => beside(a, withHub(a, tp.address))}
        grouped={groups.has(a)}
        renamable={renamable(a)}
        renaming={renaming === a}
        onRename={(on) => setRenaming(on ? a : null)}
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
        <div className="mx-header-strip">
          <Tabs
            panes={stripPanes}
            open={addresses}
            focused={focused}
            onTab={onTab}
            reorder={reorder}
            onDragPane={setDragging}
            onZoom={(a) => {
              const p = (all.data ?? []).find((q) => q.address === a);
              if (p) zoom(p);
            }}
            addable
          />
          <AddMenu
            pane={focusedPane}
            open={addresses}
            minimised={minimised.map((p) => p.address)}
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
        </div>
        <Tools
          tools={[
            {
              id: 'arrange',
              glyph: '▦',
              label: 'arrange',
              onClick: () => {
                touch();
                drawn(() => setLayout((l) => next(l, n)));
              },
              disabled: !several || (!!oneWindow && !movable),
              title: !several
                ? 'arrangements are for two or more tiles'
                : oneWindow && !movable
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
              disabled: !several || (!!oneWindow && !movable),
              title: !several
                ? 'equal shares are for two or more tiles'
                : oneWindow && !movable
                  ? 'the panes of this window move only when every one is writable'
                  : 'equal shares in every split (=); with fit on, the host follows',
            },
            {
              id: 'reset',
              glyph: '↺',
              label: "the host's layout",
              onClick: () => undefined,
              disabled: true,
              title: "the host's layout: in the window view (w)",
            },
            {
              id: 'fit',
              glyph: '⤢',
              label: 'fit',
              onClick: () => toggleFit(focused),
              disabled: !writable,
              on: focusedFit,
              title: writable
                ? `fit: the host pane follows this tile (f), ${focusedFit ? 'on' : 'off'}; F: every tile`
                : 'fit: the host pane follows this tile; needs a writable pane',
            },
            {
              id: 'direct',
              glyph: '▮',
              label: 'direct',
              onClick: () => (directOn ? setDirect(false) : enterDirect()),
              disabled: !writable,
              on: directOn,
              title: !writable
                ? 'direct: keys go to the pane as pressed; needs a writable pane'
                : directOn
                  ? 'direct: keys go to the pane as pressed; Shift+Esc or this leaves'
                  : 'direct: keys go to the pane as pressed (i); Shift+Esc leaves',
            },
            {
              id: 'changes',
              glyph: '⎇',
              label: 'changes',
              onClick: () => setChanges((c) => !c),
              disabled: !writable || !hostPreviews(focused),
              on: changes,
              title: !writable
                ? "the repository's changes; needs a writable pane"
                : !hostPreviews(focused)
                  ? "the repository's changes; the host has no preview roots"
                  : "git's changes of the pane's repository, over the tile (g)",
            },
            {
              id: 'share',
              glyph: '⇗',
              label: 'share',
              onClick: () => setShare((s) => !s),
              disabled: !writable,
              on: share,
              title: writable
                ? 'share the pane read-only: a link and a password (s)'
                : 'share the pane read-only; needs a writable pane',
            },
            {
              id: 'zoom',
              glyph: '⊡',
              label: 'zoom',
              onClick: () => focusedPane && zoom(focusedPane),
              disabled: !focusedPane,
              on: !several,
              title: several
                ? 'this pane alone (z, Enter, or double-click its header)'
                : focusedPane?.hub
                  ? "the window's panes side by side (z, or double-click the header)"
                  : "the window's panes side by side (z, or double-click the header); w: the mirror layout",
            },
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
          linked={linked}
          onAcross={
            dragging
              ? (key, wrap, first) => {
                  const from = dragging;
                  setDragging(null);
                  if (addresses.includes(from)) lay(addresses.indexOf(from), key, wrap, first);
                  else if (n >= MAX_TILES) refused(`up to ${MAX_TILES} panes side by side`);
                  else bring(from, (leaf) => across(shape, leaf, key, wrap, first));
                }
              : undefined
          }
        />
      </div>
      <MinimisedRow panes={minimised} onRestore={restore} />
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
        pool={ghosting ? pool : undefined}
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
            relay={
              sharesFor(shown.address).length
                ? { ids: sharesFor(shown.address), hub: target(shown.address).hub }
                : undefined
            }
          />
        )}
      </Closing>
      <Closing open={share && !!focusedPane}>
        {focusedPane && <ShareWindow pane={focusedPane} onClose={() => setShare(false)} />}
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
