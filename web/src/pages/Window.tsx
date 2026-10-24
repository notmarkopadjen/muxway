import { useNavigate, useParams } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { useInput, useWindow } from '../api/queries';
import type { Key, Mouse, PaneContent } from '../api/types';
import { LensMark } from '../components/Lens';
import { Divider } from '../components/Divider';
import { KeyBar } from '../components/KeyBar';
import { PaneTitle } from '../components/PaneTitle';
import { useToast } from '../components/Toast';
import { addPane, loadBoard, saveBoard } from '../term/board';
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
import { useFit } from '../term/useFit';
import { setHeading } from '../shell/heading';

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
}

function Tree(props: TreeProps) {
  const { node, path, arr, panes, focused, burn, fit, setArr, onFocus, onZoom, onCell } = props;
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
          <LensMark status={st} attention={p.attention} />
          <PaneTitle pane={p} />
          <span className="mx-dim">
            {p.address.split('/').slice(1).join('/')} · {p.width}×{p.height}
          </span>
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
          height={p.height}
          onCell={p.mode === 'write' && p.mouse ? (x, y) => onCell(p.address, x, y) : undefined}
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
  // Zoom shows one pane alone, in the browser only; a second time brings
  // the window back.
  const [zoomed, setZoomed] = useState<string | null>(null);
  const zoom = zoomed && visible.includes(zoomed) ? zoomed : null;
  const zoomLeaf = tree && zoom ? leaves(tree).find((l) => l.id === zoom) : undefined;
  const toggleZoom = useCallback((id: string) => {
    setFocused(id);
    setZoomed((z) => (z === id ? null : id));
  }, []);
  const move = (id: string | null) => {
    setFocused(id);
    if (zoom) setZoomed(id);
  };
  const focusedPane = focus ? panes.get(focus)?.pane : undefined;
  const writable = focusedPane?.mode === 'write';
  const input = useInput(focusedPane?.address ?? '');
  const [text, setText] = useState('');
  const area = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(true);
  const fitting = fit && !!writable;
  // With fit on the host takes the browser's proportions too, and its
  // zoom: the pane shown alone here is shown alone there.
  const sent = fit && tree ? layoutFor(tree, arr) : undefined;
  const { refit } = useFit(focusedPane?.address ?? '', fitting, area, 'window', sent, !!zoom);
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
      if (ev.key === ']') move(visible[(i + 1) % visible.length] ?? null);
      else if (ev.key === '[') move(visible[(i - 1 + visible.length) % visible.length] ?? null);
      else if (ev.key === 'z' && focus) toggleZoom(focus);
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
      } else if (ev.key === 'Enter' && focusedPane)
        navigate({ to: '/p/$', params: { _splat: focusedPane.address } });
      else if (ev.key === 'f' && writable) setFit((f) => !f);
      else if (ev.key === 'r' && fit && writable) refit();
      else if (ev.key === 'b' && focusedPane) {
        saveBoard('main', addPane(loadBoard('main'), focusedPane.address, null, 'h'));
        navigate({ to: '/b/$name', params: { name: 'main' } });
      } else return;
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
    zoom,
    toggleZoom,
    fit,
    refit,
  ]);

  const send = async (body: { text: string } | { key: Key } | { mouse: Mouse }) => {
    if (!focusedPane) return;
    try {
      await input.mutateAsync(body);
    } catch (err) {
      toast.push({
        kind: 'refused',
        title: err instanceof ApiError ? err.code : 'hub unreachable',
      });
    }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text;
    setText('');
    if (t) await send({ text: t });
    await send({ key: 'Enter' });
  };
  // A click lands in the pane clicked, focused or not.
  const click = async (address: string, mouse: Mouse) => {
    try {
      noteOwn(address);
      await api<void>(`/v1/panes/${address}/input`, {
        method: 'POST',
        body: JSON.stringify({ mouse }),
      });
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
  const hiddenPanes = arr.hidden.filter((id) => panes.has(id));
  return (
    <div className="mx-winview" data-testid="window" data-layout={layout}>
      <div className="mx-pane-head">
        <span>
          {host}/{session}/{data.data?.window.index ?? win}
          {data.data ? ` · ${data.data.window.name}` : ''}
        </span>
        <span className="mx-dim" data-testid="focus">
          focus: {focusedPane ? focusedPane.address : 'none'}
        </span>
        {writable && (
          <button
            type="button"
            className={`mx-toggle${fit ? ' on' : ''}`}
            onClick={() => setFit(!fit)}
            data-testid="fit"
            data-on={fit ? '1' : '0'}
          >
            fit {fit ? 'on' : 'off'}
          </button>
        )}
        {writable && fit && (
          <button
            type="button"
            onClick={refit}
            title="fit again: this client's size (r)"
            data-testid="refit"
          >
            ⟳
          </button>
        )}
        {zoom && (
          <button
            type="button"
            className="mx-toggle on"
            onClick={() => setZoomed(null)}
            title="the whole window again (z, or double-click)"
            data-testid="unzoom"
          >
            zoomed
          </button>
        )}
        <button
          type="button"
          onClick={() => tree && setArr((a) => equalised(a, tree))}
          title="equal shares (=)"
          data-testid="equalise"
        >
          equalise
        </button>
        <button
          type="button"
          onClick={() => setArr(() => fresh(layout))}
          title="host layout (0)"
          data-testid="reset"
        >
          reset
        </button>
        {hiddenPanes.length > 0 && (
          <span className="mx-hidden-bar" data-testid="hidden">
            hidden:
            {hiddenPanes.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setArr((a) => ({ ...a, hidden: a.hidden.filter((h) => h !== id) }))}
              >
                {panes.get(id)?.pane.address.split('/').slice(1).join('/')}
              </button>
            ))}
          </span>
        )}
      </div>
      <div className="mx-area" ref={area}>
        {tree && (
          <Tree
            node={zoomLeaf ?? tree}
            path="0"
            arr={arr}
            panes={panes}
            focused={focus}
            burn={!data.isPlaceholderData}
            fit={fitting}
            setArr={setArr}
            onFocus={setFocused}
            onZoom={toggleZoom}
            onCell={(address, x, y) => void click(address, { button: 'left', x, y })}
          />
        )}
      </div>
      <form className="mx-input" onSubmit={submit}>
        <span className="mx-prompt">{writable ? '>' : '○'}</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!writable}
          placeholder={
            focusedPane
              ? writable
                ? `type into ${focusedPane.address}`
                : 'read-only pane'
              : 'no pane'
          }
          aria-label="input"
          autoComplete="off"
          data-testid="input"
        />
        <button type="submit" disabled={!writable}>
          send
        </button>
      </form>
      <KeyBar onKey={(k) => void send({ key: k })} disabled={!writable} />
    </div>
  );
}
