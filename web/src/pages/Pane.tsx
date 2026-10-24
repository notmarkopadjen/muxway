import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { useAllPanes, useInput, usePane, usePaneCached } from '../api/queries';
import type { Key, Mouse, Pane } from '../api/types';
import { Divider } from '../components/Divider';
import { KeyBar } from '../components/KeyBar';
import { LensMark } from '../components/Lens';
import { ClaudeMark, PaneTitle } from '../components/PaneTitle';
import { useToast } from '../components/Toast';
import { describe } from '../term/describe';
import { noteChange, noteOwn, tabName, useLens } from '../term/lens';
import { Screen } from '../term/Screen';
import {
  close,
  defaultFor,
  drag,
  equal,
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
import { useFit } from '../term/useFit';
import { setHeading } from '../shell/heading';

// The pane view, as the Android client has it: a strip of every pane the
// token may read, painted with its state; one to four of them open as
// tiles in an arrangement of the browser's own; one input line and one
// key bar for the focused tile.

// A click lands in the pane clicked, focused or not.
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

function Tabs({
  panes,
  open,
  focused,
  onTab,
}: {
  panes: Pane[];
  open: string[];
  focused: string;
  onTab: (address: string) => void;
}) {
  const lens = useLens();
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    strip.current
      ?.querySelector('[data-focused]')
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [focused, panes.length]);
  const rows: { address: string; pane?: Pane }[] = panes.map((p) => ({
    address: p.address,
    pane: p,
  }));
  for (const a of open) if (!rows.some((r) => r.address === a)) rows.push({ address: a });
  return (
    <div className="mx-tabs" ref={strip} data-testid="tabs">
      {rows.map(({ address, pane }) => {
        const st = pane ? lens.status(pane) : 'quiet';
        const isOpen = open.includes(address);
        return (
          <button
            key={address}
            type="button"
            className="mx-tab mx-painted"
            data-testid="tab"
            data-address={address}
            data-open={isOpen ? '' : undefined}
            data-focused={address === focused ? '' : undefined}
            data-state={st === 'quiet' ? undefined : st}
            onClick={() => onTab(address)}
            title={address}
          >
            {st !== 'quiet' ? (
              <LensMark status={st} attention={pane?.attention} />
            ) : pane && describe(pane).agent === 'claude' ? (
              <ClaudeMark />
            ) : null}
            <span className="mx-tab-name">
              {pane ? tabName(pane) : address.split('/').slice(1).join('/')}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface TileProps {
  address: string;
  index: number;
  focused: boolean;
  several: boolean;
  fit: boolean | undefined;
  refitTick: number;
  dragging: string | null;
  onFocus: () => void;
  onClose: () => void;
  onFit: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  refused: (why: string) => void;
}

function Tile(props: TileProps) {
  const { address, focused, several, refitTick, dragging } = props;
  const pane = usePane(address, focused ? 1_000 : 2_000);
  const box = useRef<HTMLDivElement>(null);
  const p = pane.data?.pane;
  const writable = p?.mode === 'write';
  // Every writable tile opens with fit on, as a single pane does.
  const fit = props.fit ?? writable;
  const { size: fitted, refit } = useFit(address, fit && writable, box, 'pane');
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
        {p && writable && (
          <button
            type="button"
            className={`mx-toggle${fit ? ' on' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              props.onFit();
            }}
            title="size the host pane to this tile (f)"
            data-testid={focused ? 'fit' : 'tile-fit'}
            data-on={fit ? '1' : '0'}
          >
            fit {fit ? 'on' : 'off'}
            {fit && fitted ? ` ${fitted.cols}×${fitted.rows}` : ''}
          </button>
        )}
        {p && writable && fit && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              refit();
            }}
            title="fit again: this client's size (r)"
            data-testid={focused ? 'refit' : 'tile-refit'}
          >
            ⟳
          </button>
        )}
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
        content={pane.data?.content ?? ''}
        burn={!pane.isPlaceholderData}
        cols={fit && writable ? undefined : p?.width}
        rows={fit && writable ? undefined : p?.height}
        boxRef={box}
        focused={several && focused}
        onClick={props.onFocus}
        height={p?.height}
        onCell={
          writable && p?.mouse
            ? (x, y) => void click(address, { button: 'left', x, y }, props.refused)
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
  const [text, setText] = useState('');
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
  const onTab = useCallback(
    (address: string) => {
      const at = addresses.indexOf(address);
      if (at >= 0) setFocusedIndex(at);
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
      const k = ev.key;
      if (k === ']') setFocusedIndex((index + 1) % n);
      else if (k === '[') setFocusedIndex((index - 1 + n) % n);
      else if (k === '}') neighbour(1);
      else if (k === '{') neighbour(-1);
      else if (/^[1-4]$/.test(k) && Number(k) <= n) setFocusedIndex(Number(k) - 1);
      else if (k === 'l' && several) setLayout((l) => next(l, n));
      else if (k === 'x' && several) go(close(addresses, focused));
      else if (k === 'f' && writable) toggleFit(focused);
      else if (k === 'F') {
        const on = !addresses.some((a) => fit[a] ?? true);
        const f: Record<string, boolean> = {};
        for (const a of addresses) f[a] = on;
        setFit(f);
      } else if (k === 'r' && writable) setRefitTick((t) => t + 1);
      else if (k === 'w' && focusedPane)
        navigate({
          to: `/w/${focusedPane.host}/${focusedPane.session}/${focusedPane.window_index}`,
        });
      else if (k === 'Enter' && several) go([focused]);
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
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text;
    setText('');
    if (t) await send({ text: t });
    await send({ key: 'Enter' });
  };

  const windowPath = focusedPane
    ? `/w/${focusedPane.host}/${focusedPane.session}/${focusedPane.window_index}`
    : undefined;
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
        <Tabs panes={all.data ?? []} open={addresses} focused={focused} onTab={onTab} />
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
          {windowPath && (
            <Link to={windowPath} className="mx-dim" data-testid="to-window">
              window ▸
            </Link>
          )}
        </span>
      </div>
      <div className="mx-area">
        <Tree node={tree(n, layout)} weights={weights} setWeights={setWeights} tile={tile} />
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
                ? several
                  ? `type into ${focused}`
                  : 'type, Enter sends'
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
      <div>
        <KeyBar onKey={(k) => void send({ key: k })} disabled={!writable} />
        {focusedPane && !writable && (
          <div className="mx-readonly" data-testid="readonly">
            read-only: your grant or the pane's mark does not allow typing
          </div>
        )}
      </div>
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
