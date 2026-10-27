import { useNavigate, useParams } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useQueryClient } from '@tanstack/react-query';
import { keys, useHosts, useInput, useWindow } from '../api/queries';
import type { Mouse, PaneContent } from '../api/types';
import { LensMark } from '../components/Lens';
import { Divider } from '../components/Divider';
import { InputPanel } from '../components/InputPanel';
import { PaneTitle } from '../components/PaneTitle';
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
import { Closing } from '../components/Closing';
import { FileWindow, type Shown } from '../components/FileWindow';
import { useFit } from '../term/useFit';
import { screenWords } from '../term/complete';
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
  const { onFile, onPath, onCopied, onPrompt } = props;
  const box = useRef<HTMLDivElement>(null);
  const lens = useLens();
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
        onDoubleClick={() => onZoom(node.id)}
      >
        <div
          className="mx-cell-head mx-painted"
          data-state={state}
          onClick={() => onFocus(node.id)}
        >
          <PaneTitle pane={p} />
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
          <button
            type="button"
            title="hide here (x)"
            onClick={() => setArr((a) => ({ ...a, hidden: [...a.hidden, node.id] }))}
          >
            ×
          </button>
        </div>
        <Screen
          content={pc.content}
          burn={burn}
          cols={fit ? undefined : p.width}
          rows={fit ? undefined : p.height}
          scale={arr.scale[node.id] ?? 1}
          focused={focused === node.id}
          onClick={() => onFocus(node.id)}
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
          onPrompt={p.mode === 'write' ? () => onPrompt(node.id) : undefined}
          cursorRow={p.cursor_y}
          testId="cell-screen"
        />
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
  const tree = useMemo(() => {
    try {
      return layout ? parseLayout(layout) : null;
    } catch {
      return null;
    }
  }, [layout]);
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
      setArr((a) => ({ ...a, hidden: a.hidden.filter((h) => h !== id) }));
    move(id);
  };
  const writable = focusedPane?.mode === 'write';
  const input = useInput(focusedPane?.address ?? '');
  const area = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(true);
  // A file of the inbox shown over the page; kept while its window powers off.
  const [shown, setShown] = useState<Shown | null>(null);
  const [showing, setShowing] = useState(false);
  const show = useCallback((s: Shown) => {
    setShown(s);
    setShowing(true);
  }, []);
  const hide = useCallback(() => setShowing(false), []);
  const hosts = useHosts();
  const previews = !!hosts.data?.find((h) => h.name === host && !h.hub)?.preview;
  const fitting = fit && !!writable;
  // With fit on the host takes the browser's proportions too.
  const sent = fit && tree ? layoutFor(tree, arr) : undefined;
  // The input line grown while a message is written takes height from
  // the area; the fit measures as if it had not.
  const grown = useRef(0);
  const slack = useCallback(() => grown.current, []);
  const { refit } = useFit(focusedPane?.address ?? '', fitting, area, 'window', sent, false, {
    slack,
  });
  useEffect(() => {
    setHeading({ pane: focusedPane, place: `window ${host}/${session}/${win}` });
    return () => setHeading({ place: '' });
  }, [focusedPane, host, session, win]);

  // The host's layout wins: a new layout string resets the arrangement.
  // Except with fit on, when the host's sizes are the browser's own: a
  // change of sizes alone keeps the arrangement, a change of shape resets.
  useEffect(() => {
    if (!layout || arr.layout === layout) return;
    setArrState((a) => {
      if (fit && a.layout && tree) {
        try {
          if (sameShape(parseLayout(a.layout), tree)) {
            const next = { ...a, layout };
            save(key, next);
            return next;
          }
        } catch {
          /* a layout that never parsed resets below */
        }
      }
      return load(key, layout);
    });
  }, [layout, key, arr.layout, fit, tree]);
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

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const i = focus ? visible.indexOf(focus) : -1;
      const by = (d: number) => move(visible[(i + d + visible.length) % visible.length] ?? null);
      if (ev.key === ']') by(1);
      else if (ev.key === '[') by(-1);
      else if ((ev.key === 'z' || ev.key === 'Enter') && focus) open(focus);
      else if (ev.key === 'x' && focus) setArr((a) => ({ ...a, hidden: [...a.hidden, focus] }));
      else if (ev.key === '0') setArr(() => fresh(layout));
      else if (ev.key === '=' && tree) setArr((a) => equalised(a, tree));
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
      else return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, focus, focusedPane, layout, navigate, setArr, writable, open, fit, refit]);

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
        <Tabs
          panes={stripPanes}
          open={stripPanes.filter((p) => !arr.hidden.includes(p.pane_id)).map((p) => p.address)}
          focused={focusedPane?.address ?? null}
          hidden={hiddenAddresses}
          onTab={onTab}
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
        <Tools
          tools={[
            ...(writable
              ? [
                  {
                    id: 'fit',
                    glyph: '⤢',
                    label: 'fit',
                    onClick: () => setFit(!fit),
                    on: fit,
                    title: `fit: the host window follows this box (f), ${fit ? 'on' : 'off'}`,
                  },
                ]
              : []),
            ...(focus
              ? [
                  {
                    id: 'zoom',
                    glyph: '⊡',
                    label: 'zoom',
                    onClick: () => open(focus),
                    title: 'this pane alone, in the pane view (z, Enter, or double-click)',
                  },
                ]
              : []),
            {
              id: 'equalise',
              glyph: '⊞',
              label: 'equal shares',
              onClick: () => tree && setArr((a) => equalised(a, tree)),
              title: 'equal shares (=)',
            },
            {
              id: 'reset',
              glyph: '↺',
              label: "the host's layout",
              onClick: () => setArr(() => fresh(layout)),
              title: "the host's layout (0)",
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
          />
        )}
      </Closing>
      <InputPanel
        pane={focusedPane}
        writable={writable}
        placeholder={
          focusedPane
            ? writable
              ? `type into ${focusedPane.address}`
              : 'read-only pane'
            : 'no pane'
        }
        send={send}
        onGrow={(px) => {
          grown.current = px;
        }}
        words={words}
      />
    </div>
  );
}
