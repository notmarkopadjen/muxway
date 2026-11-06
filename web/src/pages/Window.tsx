import { useNavigate, useParams } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useQueryClient } from '@tanstack/react-query';
import {
  hostOf,
  keys,
  resizePane,
  useChanges,
  useHosts,
  useInput,
  useLater,
  useWindow,
} from '../api/queries';
import type { Change, Mouse, PaneContent } from '../api/types';
import { LensMark } from '../components/Lens';
import { Divider } from '../components/Divider';
import { InputPanel } from '../components/InputPanel';
import { PaneTitle, paneTooltip } from '../components/PaneTitle';
import { Tabs } from '../components/Tabs';
import { useToast } from '../components/Toast';
import {
  fractions,
  fresh,
  layoutFor,
  leaves,
  parseLayout,
  sameShape,
  type Arrangement,
  type Node,
} from '../term/layout';
import { noteOwn, useLens } from '../term/lens';
import { Screen } from '../term/Screen';
import { AddMenu } from '../components/AddMenu';
import { ChangesWindow } from '../components/Changes';
import { ShareWindow, sharesOf, useShares } from '../components/ShareWindow';
import { Closing } from '../components/Closing';
import { FileWindow, type Shown } from '../components/FileWindow';
import { useFit } from '../term/useFit';
import { drawn, nameFor, useMoving } from '../term/drawn';
import {
  next as nextPreset,
  options as presetOptions,
  tilesLayout,
  tree as presetTree,
  type Layout as Preset,
  type TileNode,
} from '../term/tiles';
import { countOf, summary } from '../term/changes';
import { screenWords } from '../term/complete';
import { Backlog, keyToBody, paneChord, pasteText, type Body } from '../term/direct';
import {
  deskPanes,
  knownDesk,
  noteDesk,
  sameDesk,
  useDesk,
  writeDesk,
  type Desk,
} from '../api/desk';
import { routeFor } from '../term/tiles';
import { setLastPlace } from '../settings';
import { requestPalette } from '../term/intent';
import { setHeading } from '../shell/heading';
import { InHeader } from '../shell/HeaderSlot';
import { Tools } from '../components/Tools';

// Equal shares in every split, in the browser; with fit on the host follows.
function equalised(a: Arrangement, tree: Node): Arrangement {
  const fractions: Record<string, number[]> = {};
  const walk = (n: Node, path: string) => {
    if (n.kind === 'pane') return;
    fractions[path] = Array(n.children.length).fill(1 / n.children.length) as number[];
    n.children.forEach((c, i) => walk(c, `${path}.${i}`));
  };
  walk(tree, '0');
  return { ...a, fractions };
}

// A window as tmux lays it out, with an arrangement of the browser's own:
// fractions per split, hidden panes, a font multiplier per pane. The
// arrangement is kept per window and dropped whenever the host's layout
// changes.

function storageKey(host: string, session: string, windowId: string) {
  return `mx-arr:${host}/${session}/${windowId}`;
}
function load(key: string, layout: string): Arrangement {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const a = JSON.parse(raw) as Arrangement;
      if (a.layout === layout) return a;
    }
  } catch {
    /* ignore */
  }
  return fresh(layout);
}
function save(key: string, a: Arrangement) {
  try {
    localStorage.setItem(key, JSON.stringify(a));
  } catch {
    /* ignore */
  }
}

interface TreeProps {
  node: Node;
  path: string;
  arr: Arrangement;
  panes: Map<string, PaneContent>;
  focused: string | null;
  burn: boolean;
  fit: boolean;
  setArr: (f: (a: Arrangement) => Arrangement) => void;
  onFocus: (id: string) => void;
  onZoom: (id: string) => void;
  // Direct typing lands in the focused pane: its cursor is a block, and
  // a click with a fine pointer on a writable pane's screen turns it on.
  direct: boolean;
  onDirect: (id: string) => void;
  // The host has roots: a writable cell's header counts the repository's
  // changes, and the count opens the changes window over the focused cell.
  previews: boolean;
  changesOpen: boolean;
  onChanges: (id: string) => void;
  panel?: React.ReactNode;
  onCell: (address: string, x: number, y: number) => void;
  onWheel: (address: string, up: boolean, x: number, y: number, count: number) => Promise<void>;
  onFile: (address: string, name: string) => void;
  onPath?: (address: string, path: string) => void;
  onCopied: (rows: number) => void;
  onPrompt: (id: string) => void;
}

function Tree(props: TreeProps) {
  const { node, path, arr, panes, focused, burn, fit, setArr, onFocus, onZoom, onCell, onWheel } =
    props;
  const { direct, onDirect, previews, changesOpen, onChanges, panel } = props;
  const { onFile, onPath, onCopied, onPrompt } = props;
  const box = useRef<HTMLDivElement>(null);
  const pointer = useRef('mouse');
  const lens = useLens();
  const moving = useMoving();
  const own = node.kind === 'pane' ? panes.get(node.id)?.pane : undefined;
  const counting = !!own && own.mode === 'write' && previews;
  const ch = useChanges(own?.address ?? '', counting, 10_000);
  const counts =
    counting && ch.data && !(ch.error instanceof ApiError && ch.error.status === 404)
      ? countOf(ch.data.entries)
      : null;
  if (node.kind === 'pane') {
    if (arr.hidden.includes(node.id)) return null;
    const pc = panes.get(node.id);
    if (!pc) {
      return (
        <div className="mx-cell mx-cell-gap" data-testid="gap">
          <span className="mx-faint">not yours to see</span>
        </div>
      );
    }
    const p = pc.pane;
    const st = lens.status(p);
    const state = st === 'quiet' ? undefined : st;
    return (
      <div
        className="mx-cell"
        data-testid="cell"
        data-pane={node.id}
        data-state={state}
        data-focused={focused === node.id ? '' : undefined}
        data-moving={moving.on ? '' : undefined}
        style={moving.on ? { viewTransitionName: nameFor(node.id) } : undefined}
        onDoubleClick={() => onZoom(node.id)}
        onPointerDownCapture={(e) => {
          pointer.current = e.pointerType;
        }}
      >
        <div
          className="mx-cell-head mx-painted"
          data-state={state}
          onClick={() => onFocus(node.id)}
        >
          <PaneTitle pane={p} folder={p.cwd} title={paneTooltip(p)} />
          <span className="mx-dim">
            {p.address.split('/').slice(1).join('/')} · {p.width}×{p.height}
          </span>
          {st !== 'quiet' && (
            <span className={st === 'waiting' ? 'mx-attention' : 'mx-dim'}>
              <LensMark status={st} attention={p.attention} withWord />
              {p.attention?.text ? `: ${p.attention.text}` : ''}
            </span>
          )}
          <span className="mx-spacer" />
          {counts && (
            <button
              type="button"
              className={`mx-tile-changes${changesOpen && focused === node.id ? ' on' : ''}`}
              title="the repository's changes (g)"
              data-testid="cell-changes"
              onClick={(e) => {
                e.stopPropagation();
                onChanges(node.id);
              }}
            >
              ⎇ {summary({ ...counts, conflict: 0 }) || (counts.conflict ? '' : '✓')}
              {counts.conflict ? <span className="mx-warn"> !{counts.conflict}</span> : null}
            </button>
          )}
          <button
            type="button"
            title="hide here (x)"
            onClick={() => drawn(() => setArr((a) => ({ ...a, hidden: [...a.hidden, node.id] })))}
          >
            ×
          </button>
        </div>
        <div className="mx-cell-body">
          <Screen
            content={pc.content}
            burn={burn}
            cols={fit ? undefined : p.width}
            rows={fit ? undefined : p.height}
            scale={arr.scale[node.id] ?? 1}
            focused={focused === node.id}
            onClick={() => {
              onFocus(node.id);
              if (p.mode === 'write' && pointer.current !== 'touch') onDirect(node.id);
            }}
            height={p.height - (pc.trimmed ?? 0)}
            bounds={{ cols: p.width, rows: p.height }}
            onCell={p.mode === 'write' && p.mouse ? (x, y) => onCell(p.address, x, y) : undefined}
            onWheel={
              p.mode === 'write' && p.mouse
                ? (up, x, y, count) => onWheel(p.address, up, x, y, count)
                : undefined
            }
            onFile={(name) => onFile(p.address, name)}
            onPath={onPath && p.mode === 'write' ? (path) => onPath(p.address, path) : undefined}
            onCopy={onCopied}
            onPrompt={
              p.mode === 'write'
                ? () => {
                    // A touch keeps the line's way in; a fine pointer went direct.
                    if (pointer.current === 'touch') onPrompt(node.id);
                  }
                : undefined
            }
            cursorRow={p.cursor_y}
            cursor={
              direct && focused === node.id && p.cursor_x && p.cursor_y
                ? { x: p.cursor_x, y: p.cursor_y }
                : undefined
            }
            testId="cell-screen"
          />
          {focused === node.id && panel}
        </div>
      </div>
    );
  }
  const shown = node.children
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !leaves(c).every((l) => arr.hidden.includes(l.id)));
  if (!shown.length) return null;
  const base = arr.fractions[path] ?? fractions(node);
  const total = shown.reduce((s, { i }) => s + base[i], 0) || 1;
  const drag = (k: number) => (dx: number, dy: number) => {
    const el = box.current;
    if (!el) return;
    const size = node.kind === 'h' ? el.clientWidth : el.clientHeight;
    const delta = (node.kind === 'h' ? dx : dy) / size;
    setArr((a) => {
      const f = [...(a.fractions[path] ?? fractions(node))];
      const left = shown[k].i;
      const right = shown[k + 1].i;
      const move = Math.max(-f[left] + 0.05, Math.min(f[right] - 0.05, delta));
      f[left] += move;
      f[right] -= move;
      return { ...a, fractions: { ...a.fractions, [path]: f } };
    });
  };
  return (
    <div className={`mx-split mx-split-${node.kind}`} ref={box} data-testid="split">
      {shown.map(({ c, i }, k) => (
        <div
          key={i}
          className="mx-slot"
          style={{ flexBasis: `${(base[i] / total) * 100}%` }}
          data-fraction={(base[i] / total).toFixed(3)}
        >
          <Tree {...props} node={c} path={`${path}.${i}`} />
          {k < shown.length - 1 && <Divider kind={node.kind} onDrag={drag(k)} />}
        </div>
      ))}
    </div>
  );
}

export function WindowPage() {
  const {
    host = '',
    session = '',
    window: win = '',
  } = useParams({ strict: false }) as Record<string, string>;
  const data = useWindow(host, session, win);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const layout = data.data?.window.layout ?? '';
  const windowId = data.data?.panes[0]?.pane.window_id ?? win;
  const key = storageKey(host, session, windowId);
  const [arr, setArrState] = useState<Arrangement>(() => fresh(''));
  // ▦ moves the host's panes: the layout shown stays pinned until the
  // host's new one is here, which is then drawn as a move.
  const [pinned, setPinned] = useState<string | null>(null);
  const shownLayout = pinned ?? layout;
  useEffect(() => {
    if (pinned === null || layout === pinned) return;
    // From a task: an effect cannot flush the marks into the DOM itself.
    const t = window.setTimeout(() => drawn(() => setPinned(null)), 0);
    return () => window.clearTimeout(t);
  }, [layout, pinned]);
  useEffect(() => {
    if (pinned === null) return;
    const t = window.setTimeout(() => setPinned(null), 4000);
    return () => window.clearTimeout(t);
  }, [pinned]);
  const tree = useMemo(() => {
    try {
      return shownLayout ? parseLayout(shownLayout) : null;
    } catch {
      return null;
    }
  }, [shownLayout]);
  const panes = useMemo(
    () => new Map((data.data?.panes ?? []).map((pc) => [pc.pane.pane_id, pc])),
    [data.data],
  );
  const visible = useMemo(
    () =>
      tree
        ? leaves(tree)
            .map((l) => l.id)
            .filter((id) => panes.has(id) && !arr.hidden.includes(id))
        : [],
    [tree, panes, arr.hidden],
  );
  const [focused, setFocused] = useState<string | null>(null);
  const focus = focused && visible.includes(focused) ? focused : (visible[0] ?? null);
  // Zoom opens the pane alone in the pane view, with everything that
  // view has; from there the window is one key away again.
  const open = useCallback(
    (id: string) => {
      const address = panes.get(id)?.pane.address;
      if (address) navigate({ to: '/p/$', params: { _splat: address } });
    },
    [panes, navigate],
  );
  const move = (id: string | null) => setFocused(id);
  const focusedPane = focus ? panes.get(focus)?.pane : undefined;
  // The desk: this window, written, and the other clients' changes followed.
  const desk = useDesk();
  useEffect(() => setLastPlace('view'), []);
  const mine = useMemo<Desk>(
    () => ({ view: 'window', window: `${host}/${session}/${win}`, focused: focusedPane?.address }),
    [host, session, win, focusedPane?.address],
  );
  useEffect(() => {
    if (data.data) writeDesk(mine);
  }, [mine, data.data]);
  useEffect(() => {
    const d = desk.data;
    if (!d || sameDesk(d, knownDesk()) || sameDesk(d, mine)) return;
    const last = knownDesk()?.rev;
    if (!last || (d.rev ?? 0) < last) return;
    noteDesk(d);
    if (d.view === 'window' && d.window && d.window !== `${host}/${session}/${win}`) {
      const [h, s, w] = d.window.split('/');
      void navigate({ to: `/w/${h}/${s}/${w}` });
    } else if (deskPanes(d).length) {
      void navigate({ to: '/p/$', params: { _splat: routeFor(deskPanes(d)) } });
    }
  }, [desk.data, mine, host, session, win, navigate]);
  const focusedContent = focus ? panes.get(focus)?.content : undefined;
  const words = useMemo(() => screenWords(focusedContent ?? ''), [focusedContent]);
  const focusLine = useCallback(() => {
    const el = document.querySelector<HTMLTextAreaElement>('[data-testid="input"]');
    if (el && !el.disabled) el.focus();
  }, []);
  // The strip: this window's panes in layout order, hidden ones dimmed.
  const stripPanes = useMemo(
    () => (tree ? leaves(tree).map((l) => panes.get(l.id)?.pane) : []).filter((p) => !!p),
    [tree, panes],
  );
  const hiddenAddresses = stripPanes
    .filter((p) => arr.hidden.includes(p.pane_id))
    .map((p) => p.address);
  const onTab = (address: string) => {
    const id = stripPanes.find((p) => p.address === address)?.pane_id;
    if (!id) return;
    if (arr.hidden.includes(id))
      drawn(() => setArr((a) => ({ ...a, hidden: a.hidden.filter((h) => h !== id) })));
    move(id);
  };
  const writable = focusedPane?.mode === 'write';
  const input = useInput(focusedPane?.address ?? '');
  // Direct typing: keys go to the focused pane as pressed, while it is
  // writable; focusing a read-only pane ends it, as does leaving the view.
  const [direct, setDirect] = useState(false);
  const directOn = direct && writable;
  useEffect(() => {
    if (direct && focusedPane && !writable) setDirect(false);
  }, [direct, focusedPane, writable]);
  // The changes window over the focused cell, and whether it is folded.
  const [changes, setChanges] = useState(false);
  const [share, setShare] = useState(false);
  const shares = useShares(focusedPane?.address, !!focusedPane);
  const [changesFolded, setChangesFolded] = useState(false);
  const enterDirect = useCallback(() => {
    setDirect(true);
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) active.blur();
    document
      .querySelector<HTMLElement>('.mx-cell[data-focused] [data-testid="cell-screen"]')
      ?.focus();
  }, []);
  const area = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(true);
  // A file of the inbox shown over the page; kept while its window powers off.
  const [shown, setShown] = useState<Shown | null>(null);
  const shownPane = shown
    ? [...panes.values()].map((pc) => pc.pane).find((q) => q.address === shown.address)
    : undefined;
  const shownShares = sharesOf(shares.data, shownPane).map((sh) => sh.id);
  const focusedShares = sharesOf(shares.data, focusedPane).map((sh) => sh.id);
  const [showing, setShowing] = useState(false);
  const show = useCallback((s: Shown) => {
    setShown(s);
    setShowing(true);
  }, []);
  const hide = useCallback(() => setShowing(false), []);
  const hosts = useHosts();
  const previews = !!hosts.data?.find((h) => h.name === host && !h.hub)?.preview;
  const parks = !!hosts.data?.find((h) => h.name === host && !h.hub)?.later;
  const later = useLater();
  const setLater = useCallback(
    (address: string, on: boolean) => {
      const p = stripPanes.find((q) => q.address === address);
      if (!p || p.mode !== 'write' || !parks || !!p.later === on) return;
      later.mutate(
        { address, later: on },
        { onError: (err) => toast.push({ kind: 'later', title: address, text: String(err) }) },
      );
    },
    [stripPanes, parks, later, toast],
  );
  const repeats = useRef(false);
  repeats.current = !!hostOf(hosts.data, focusedPane?.address ?? '')?.repeat;
  // The changes window shows for a writer on a host with roots; the
  // repository's state is asked again once the pane's output settles.
  const showsChanges = changes && writable && previews;
  const focusedAddress = focusedPane?.address ?? '';
  useEffect(() => {
    if (!showsChanges) return;
    const t = setTimeout(
      () => void qc.invalidateQueries({ queryKey: keys.changes(focusedAddress) }),
      800,
    );
    return () => clearTimeout(t);
  }, [showsChanges, focusedAddress, focusedContent, qc]);
  // The window is fitted through one of its writable panes, the same one
  // while it is shown, so moving the focus sends nothing.
  const fitVia = useMemo(
    () => visible.map((id) => panes.get(id)?.pane).find((p) => p?.mode === 'write')?.address ?? '',
    [visible, panes],
  );
  const fitting = fit && !!fitVia;
  // With fit on the host takes the browser's proportions too.
  const sent = fit && tree ? layoutFor(tree, arr) : undefined;
  // The input line grown while a message is written takes height from
  // the area; the fit measures as if it had not.
  const grown = useRef(0);
  const slack = useCallback(() => grown.current, []);
  const { refit } = useFit(fitVia, fitting, area, 'window', sent, false, {
    slack,
  });
  // The next preset for the window's panes, as the pane view cycles its
  // tiles, sent to the host as the window's layout: the shown panes laid
  // out the preset way, the hidden ones kept in a thin stack at the
  // right. Moving the host's panes needs the write grant on all of them;
  // the hub says so if not.
  const [preset, setPreset] = useState<Preset>('custom');
  const readOnlyPane = [...panes.values()].some((p) => p.pane.mode !== 'write');
  const arrangeable = !!fitVia && !readOnlyPane && visible.length >= 2 && visible.length <= 4;
  const arrange = useCallback(() => {
    if (!arrangeable) return;
    const p = nextPreset(preset, visible.length);
    const hidden = [...panes.keys()].filter((id) => !visible.includes(id));
    let node: TileNode = presetTree(visible.length, p);
    const weights: Record<string, number[]> = {};
    if (hidden.length) {
      const stack = hidden.map((_, i) => visible.length + i);
      node = {
        kind: 'h',
        key: 'shown',
        children: [node, { kind: 'v', key: 'hidden', children: stack }],
      };
      weights.shown = [0.85, 0.15];
    }
    setPreset(p);
    setPinned(shownLayout);
    const layout = tilesLayout(node, weights, [...visible, ...hidden]);
    // The window takes one resize a second: right after a fit or a
    // release the layout waits its turn.
    const send = (tries: number) =>
      resizePane(fitVia, { scope: 'window', layout })
        .then(() => qc.invalidateQueries({ queryKey: keys.window(host, session, win) }))
        .catch((err) => {
          if (err instanceof ApiError && err.status === 429 && tries > 1)
            window.setTimeout(() => send(tries - 1), 1100);
          else {
            setPinned(null);
            toast.push({
              kind: 'refused',
              title: err instanceof ApiError ? err.code : 'hub unreachable',
            });
          }
        });
    void send(3);
  }, [arrangeable, preset, visible, panes, fitVia, qc, host, session, win, toast, shownLayout]);
  useEffect(() => {
    setHeading({
      pane: focusedPane,
      place: `window ${host}/${session}/${win}`,
      direct: directOn,
    });
    return () => setHeading({ place: '' });
  }, [focusedPane, host, session, win, directOn]);

  // The host's layout wins: a new layout string resets the arrangement.
  // Except with fit on, when the host's sizes are the browser's own: a
  // change of sizes alone keeps the arrangement, a change of shape resets.
  useEffect(() => {
    if (!shownLayout || arr.layout === shownLayout) return;
    setArrState((a) => {
      if (fit && a.layout && tree) {
        try {
          if (sameShape(parseLayout(a.layout), tree)) {
            const next = { ...a, layout: shownLayout };
            save(key, next);
            return next;
          }
        } catch {
          /* a layout that never parsed resets below */
        }
      }
      return load(key, shownLayout);
    });
  }, [shownLayout, key, arr.layout, fit, tree]);
  const setArr = useCallback(
    (f: (a: Arrangement) => Arrangement) => {
      setArrState((a) => {
        const next = f(a);
        save(key, next);
        return next;
      });
    },
    [key],
  );

  // ] and [ move between the cells; Ctrl+] and Ctrl+[ the same from
  // anywhere, the line and direct typing included.
  const by = (d: number) => {
    const i = focus ? visible.indexOf(focus) : -1;
    move(visible[(i + d + visible.length) % visible.length] ?? null);
  };
  const byRef = useRef(by);
  byRef.current = by;
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const chord = paneChord(ev);
      if (chord) {
        by(chord);
        ev.preventDefault();
        ev.stopImmediatePropagation();
        return;
      }
      const target = ev.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey || directOn) return;
      if (ev.key === ']') by(1);
      else if (ev.key === '[') by(-1);
      else if ((ev.key === 'z' || ev.key === 'Enter') && focus) open(focus);
      else if (ev.key === 'x' && focus)
        drawn(() => setArr((a) => ({ ...a, hidden: [...a.hidden, focus] })));
      else if (ev.key === '0') drawn(() => setArr(() => fresh(layout)));
      else if (ev.key === 'l' && arrangeable) arrange();
      else if (ev.key === '=' && tree) drawn(() => setArr((a) => equalised(a, tree)));
      else if (ev.key === '+' && focus) {
        setArr((a) => ({
          ...a,
          scale: { ...a.scale, [focus]: Math.min(3, (a.scale[focus] ?? 1) * 1.15) },
        }));
      } else if (ev.key === '-' && focus) {
        setArr((a) => ({
          ...a,
          scale: { ...a.scale, [focus]: Math.max(0.4, (a.scale[focus] ?? 1) / 1.15) },
        }));
      } else if (ev.key === 'f' && writable) setFit((f) => !f);
      else if (ev.key === 'r' && fit && writable) refit();
      else if (ev.key === 'i' && writable) enterDirect();
      else if (ev.key === ':') focusLine();
      else if (ev.key === 'g' && writable && previews) setChanges((c) => !c);
      else if (ev.key === 'd' && focusedPane) setLater(focusedPane.address, !focusedPane.later);
      else if (ev.key === 's' && writable) setShare((s) => !s);
      else return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    visible,
    focus,
    focusedPane,
    layout,
    navigate,
    setArr,
    writable,
    open,
    fit,
    refit,
    directOn,
    enterDirect,
    focusLine,
    previews,
    setLater,
  ]);

  const send = async (body: { text: string } | { key: string } | { mouse: Mouse }) => {
    if (!focusedPane) return false;
    try {
      await input.mutateAsync(body);
      return true;
    } catch (err) {
      toast.push({
        kind: 'refused',
        title: err instanceof ApiError ? err.code : 'hub unreachable',
      });
      return false;
    }
  };
  // The keys of direct typing, queued per pane behind the request in
  // flight, as the pane view does; the file window keeps every key while
  // it is open.
  const sendRef = useRef(send);
  sendRef.current = send;
  const backlog = useMemo(
    () =>
      new Backlog(
        (b) => sendRef.current(b),
        () => repeats.current,
      ),
    [focus],
  );
  useEffect(() => {
    if (!directOn) return;
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    };
    const elsewhere = (t: EventTarget | null) =>
      typing(t) || !!document.querySelector('.mx-picture-back');
    const push = (b: Body) => backlog.push(b);
    const onKey = (ev: KeyboardEvent) => {
      if (elsewhere(ev.target)) return;
      // The pane chords move the focus and stay in direct typing.
      const chord = paneChord(ev);
      if (chord) {
        byRef.current(chord);
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
      push({ text });
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
  // A click or a wheel notch lands in the pane under the pointer, focused or not.
  const click = async (address: string, mouse: Mouse) => {
    try {
      noteOwn(address);
      await api<void>(`/v1/panes/${address}/input`, {
        method: 'POST',
        body: JSON.stringify({ mouse }),
      });
      // The program has moved: show it soon, not at the next poll, and once
      // more a little later, in case the first read caught the screen cleared
      // and not yet redrawn.
      for (const ms of [150, 600])
        setTimeout(
          () => void qc.invalidateQueries({ queryKey: keys.window(host, session, win) }),
          ms,
        );
    } catch (err) {
      toast.push({
        kind: 'refused',
        title: err instanceof ApiError ? err.code : 'hub unreachable',
      });
    }
  };

  if (data.isError) {
    const err = data.error;
    return (
      <div className="mx-empty mx-bad" data-testid="window-error">
        {err instanceof ApiError && err.status === 404
          ? 'no such window, or not yours to see'
          : 'the hub could not be reached'}
      </div>
    );
  }
  return (
    <div className="mx-winview" data-testid="window" data-layout={layout}>
      <InHeader>
        <div className="mx-header-strip">
          <Tabs
            panes={stripPanes}
            open={stripPanes.filter((p) => !arr.hidden.includes(p.pane_id)).map((p) => p.address)}
            focused={focusedPane?.address ?? null}
            hidden={hiddenAddresses}
            onTab={onTab}
            onWake={(a) => setLater(a, false)}
          />
          <AddMenu
            pane={focusedPane}
            open={stripPanes.map((p) => p.address)}
            onMade={(a) => {
              // A split appears in this window by itself; a new session is elsewhere: open it.
              if (!a.startsWith(`${host}/${session}/`))
                navigate({ to: '/p/$', params: { _splat: a } });
            }}
            // A pane of another window: the pane view, with this one's focused pane beside it.
            onPick={(a) =>
              navigate({
                to: '/p/$',
                params: { _splat: focusedPane ? `${focusedPane.address},${a}` : a },
              })
            }
            onRefused={(why) => toast.push({ kind: 'refused', title: why })}
          />
        </div>
        <Tools
          tools={[
            {
              id: 'arrange',
              glyph: '▦',
              label: 'arrange',
              onClick: arrange,
              disabled: !arrangeable,
              title: readOnlyPane
                ? 'the panes of this window move only when every one is writable'
                : visible.length > 4
                  ? 'arrangements are for up to four panes'
                  : visible.length < 2
                    ? 'arrangements are for two or more panes'
                    : `next arrangement of the window's panes, on the host (l): ${presetOptions(visible.length).join(', ')}`,
            },
            {
              id: 'equal',
              glyph: '⊞',
              label: 'equal',
              onClick: () => tree && drawn(() => setArr((a) => equalised(a, tree))),
              title: 'equal shares in every split (=); with fit on, the host follows',
            },
            {
              id: 'reset',
              glyph: '↺',
              label: "the host's layout",
              onClick: () => drawn(() => setArr(() => fresh(layout))),
              title: "the host's layout (0)",
            },
            {
              id: 'fit',
              glyph: '⤢',
              label: 'fit',
              onClick: () => setFit(!fit),
              disabled: !writable,
              on: fit,
              title: writable
                ? `fit: the host window follows this box (f), ${fit ? 'on' : 'off'}`
                : 'fit: the host window follows this box; needs a writable pane',
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
              disabled: !writable || !previews,
              on: changes,
              title: !writable
                ? "the repository's changes; needs a writable pane"
                : !previews
                  ? "the repository's changes; the host has no preview roots"
                  : "git's changes of the pane's repository, over the cell (g)",
            },
            {
              id: 'later',
              glyph: '☾',
              label: 'later',
              onClick: () => focusedPane && setLater(focusedPane.address, !focusedPane.later),
              disabled: !writable || !parks,
              on: !!focusedPane?.later,
              title: !writable
                ? 'later: park the pane, its tab goes last; needs a writable pane'
                : !parks
                  ? 'later: park the pane; the host is older than this'
                  : focusedPane?.later
                    ? 'later: parked; wake it (d)'
                    : 'later: park the pane, its tab goes last and it stops calling (d)',
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
              onClick: () => focus && open(focus),
              disabled: !focus,
              on: false,
              title: 'this pane alone, in the pane view (z, Enter, or double-click)',
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
      <div className="mx-area" ref={area}>
        {tree && (
          <Tree
            node={tree}
            path="0"
            arr={arr}
            panes={panes}
            focused={focus}
            burn={!data.isPlaceholderData}
            fit={fitting}
            setArr={setArr}
            onFocus={setFocused}
            onZoom={open}
            direct={directOn}
            onDirect={(id) => {
              setFocused(id);
              enterDirect();
            }}
            previews={previews}
            changesOpen={showsChanges}
            onChanges={(id) => {
              setFocused(id);
              setChanges((c) => (id === focus ? !c : true));
            }}
            panel={
              focusedPane && previews ? (
                <Closing open={showsChanges}>
                  <ChangesWindow
                    address={focusedPane.address}
                    direct={directOn}
                    folded={changesFolded}
                    onFold={() => setChangesFolded((f) => !f)}
                    onClose={() => setChanges(false)}
                    onOpen={(c: Change, root: string) =>
                      show({
                        address: focusedPane.address,
                        path: c.path,
                        change: { kind: c.kind, root },
                      })
                    }
                    relay={focusedShares.length ? { ids: focusedShares } : undefined}
                  />
                </Closing>
              ) : undefined
            }
            onCell={(address, x, y) => void click(address, { button: 'left', x, y })}
            onWheel={(address, up, x, y, count) =>
              click(address, {
                button: up ? 'wheelup' : 'wheeldown',
                x,
                y,
                ...(count > 1 ? { count } : {}),
              })
            }
            onFile={(address, name) => show({ address, name })}
            onPath={previews ? (address, path) => show({ address, path }) : undefined}
            onCopied={(rows) =>
              toast.push({
                kind: 'copied',
                title: rows ? `${rows} ${rows === 1 ? 'row' : 'rows'}` : 'refused by the browser',
              })
            }
            onPrompt={(id) => {
              setFocused(id);
              focusLine();
            }}
          />
        )}
      </div>
      <Closing open={showing && !!shown}>
        {shown && (
          <FileWindow
            shown={shown}
            onClose={hide}
            onFile={(name) => show({ address: shown.address, name })}
            onPath={previews ? (path) => show({ address: shown.address, path }) : undefined}
            relay={shownShares.length ? { ids: shownShares } : undefined}
          />
        )}
      </Closing>
      <Closing open={share && !!focusedPane}>
        {focusedPane && <ShareWindow pane={focusedPane} onClose={() => setShare(false)} />}
      </Closing>
      <InputPanel
        pane={focusedPane}
        writable={writable}
        placeholder={
          focusedPane
            ? writable
              ? directOn
                ? 'direct · keys go to the pane · Shift+Esc or a click here types on the line'
                : `type into ${focusedPane.address}`
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
      />
    </div>
  );
}
