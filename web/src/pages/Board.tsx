import { useNavigate, useParams } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAllPanes, useInput, usePane } from '../api/queries';
import type { Key, Mouse } from '../api/types';
import { LensMark } from '../components/Lens';
import { Divider } from '../components/Divider';
import { InputPanel } from '../components/InputPanel';
import { Palette } from '../components/Palette';
import { PaneTitle } from '../components/PaneTitle';
import { useToast } from '../components/Toast';
import {
  addPane,
  BOARD_NAME,
  dragShare,
  equalise,
  loadBoard,
  panesOf,
  removePane,
  saveBoard,
  swapPanes,
  type Board,
  type BoardNode,
} from '../term/board';
import { noteOwn, useLens } from '../term/lens';
import { Screen } from '../term/Screen';
import { useFit } from '../term/useFit';
import { setHeading } from '../shell/heading';

// A board: the person's own arrangement of panes from any window, session
// or host, kept in this browser. Each cell reads its pane as the pane view
// does; the input line and the key bar go to the focused one.

interface CellProps {
  address: string;
  focused: boolean;
  scale: number;
  fit: boolean;
  refitTick: number;
  every: number;
  dragging: string | null;
  onFocus: () => void;
  onRemove: () => void;
  onFit: () => void;
  onZoom: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
}

// A click lands in the pane clicked, focused or not.
async function click(address: string, mouse: Mouse) {
  try {
    noteOwn(address);
    await api<void>(`/v1/panes/${address}/input`, {
      method: 'POST',
      body: JSON.stringify({ mouse }),
    });
  } catch {
    /* the pane view says why; here the click is simply lost */
  }
}

function Cell(props: CellProps) {
  const { address, focused, scale, fit, refitTick, every, dragging } = props;
  const pane = usePane(address, every);
  const box = useRef<HTMLDivElement>(null);
  const p = pane.data?.pane;
  const writable = p?.mode === 'write';
  const { size: fitted, refit } = useFit(address, fit && writable, box, 'pane');
  // The board's r key, counted for the focused cell.
  useEffect(() => {
    if (refitTick) refit();
  }, [refitTick, refit]);
  const [over, setOver] = useState(false);
  const short = address.split('/').slice(1).join('/');
  const lens = useLens();
  const st = p ? lens.status(p) : 'quiet';
  const state = st === 'quiet' ? undefined : st;
  if (pane.isError) {
    const err = pane.error;
    return (
      <div className="mx-cell mx-cell-gap" data-testid="gap" data-pane={address}>
        <span className="mx-faint">
          {address}:{' '}
          {err instanceof ApiError && err.status === 404
            ? 'gone, or not yours to see'
            : err instanceof ApiError && err.status === 503
              ? 'host offline'
              : 'hub unreachable'}
        </span>
        <button type="button" onClick={props.onRemove} title="take it off the board (x)">
          remove
        </button>
      </div>
    );
  }
  return (
    <div
      className={`mx-cell${over ? ' mx-drop' : ''}`}
      data-testid="cell"
      data-pane={address}
      data-state={state}
      onDoubleClick={props.onZoom}
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
        className="mx-cell-head mx-painted"
        data-state={state}
        onClick={props.onFocus}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', '');
          e.dataTransfer.effectAllowed = 'move';
          props.onDragStart();
        }}
        onDragEnd={props.onDragEnd}
        title="drag onto another cell to swap"
      >
        <LensMark status={st} attention={p?.attention} />
        {p ? <PaneTitle pane={p} /> : <span>…</span>}
        <span className="mx-dim">
          {short}
          {p ? ` · ${p.width}×${p.height}` : ''}
        </span>
        <span className="mx-spacer" />
        {writable && (
          <button
            type="button"
            className={`mx-toggle${fit ? ' on' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              props.onFit();
            }}
            title="size the host pane to this box (f)"
            data-testid="cell-fit"
            data-on={fit ? '1' : '0'}
          >
            fit{fit && fitted ? ` ${fitted.cols}×${fitted.rows}` : ''}
          </button>
        )}
        {writable && fit && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              refit();
            }}
            title="fit again: this client's size (r)"
            data-testid="cell-refit"
          >
            ⟳
          </button>
        )}
        <button
          type="button"
          title="take it off the board (x)"
          onClick={(e) => {
            e.stopPropagation();
            props.onRemove();
          }}
        >
          ×
        </button>
      </div>
      <Screen
        content={pane.data?.content ?? ''}
        burn={!pane.isPlaceholderData}
        cols={fit && writable ? undefined : p?.width}
        rows={fit && writable ? undefined : p?.height}
        scale={scale}
        boxRef={box}
        focused={focused}
        onClick={props.onFocus}
        height={p?.height}
        onCell={
          writable && p?.mouse ? (x, y) => void click(address, { button: 'left', x, y }) : undefined
        }
        onWheel={
          writable && p?.mouse
            ? (up, x, y) => click(address, { button: up ? 'wheelup' : 'wheeldown', x, y })
            : undefined
        }
        testId="cell-screen"
      />
    </div>
  );
}

interface TreeProps {
  node: BoardNode;
  path: number[];
  board: Board;
  focus: string | null;
  dragging: string | null;
  refitTick: number;
  setBoard: (f: (b: Board) => Board) => void;
  setFocused: (id: string) => void;
  setDragging: (id: string | null) => void;
  zoom: (id: string) => void;
}

function Tree(props: TreeProps) {
  const { node, path, board, focus, dragging, refitTick, setBoard, setFocused, setDragging, zoom } =
    props;
  const box = useRef<HTMLDivElement>(null);
  if (node.kind === 'pane') {
    const id = node.id;
    return (
      <Cell
        address={id}
        focused={focus === id}
        scale={board.scale[id] ?? 1}
        fit={board.fit[id] ?? false}
        refitTick={focus === id ? refitTick : 0}
        every={focus === id ? 1_000 : 2_000}
        dragging={dragging}
        onFocus={() => setFocused(id)}
        onRemove={() => setBoard((b) => removePane(b, id))}
        onFit={() => setBoard((b) => ({ ...b, fit: { ...b.fit, [id]: !b.fit[id] } }))}
        onZoom={() => zoom(id)}
        onDragStart={() => setDragging(id)}
        onDragEnd={() => setDragging(null)}
        onDrop={() => {
          if (dragging && dragging !== id) setBoard((b) => swapPanes(b, dragging, id));
          setDragging(null);
        }}
      />
    );
  }
  const drag = (k: number) => (dx: number, dy: number) => {
    const el = box.current;
    if (!el) return;
    const size = node.kind === 'h' ? el.clientWidth : el.clientHeight;
    const delta = (node.kind === 'h' ? dx : dy) / size;
    setBoard((b) => dragShare(b, path, k, delta));
  };
  return (
    <div className={`mx-split mx-split-${node.kind}`} ref={box} data-testid="split">
      {node.children.map((c, i) => (
        <div
          key={panesOf(c)[0] ?? i}
          className="mx-slot"
          style={{ flexBasis: `${node.shares[i] * 100}%` }}
          data-fraction={node.shares[i].toFixed(3)}
        >
          <Tree {...props} node={c} path={[...path, i]} />
          {i < node.children.length - 1 && <Divider kind={node.kind} onDrag={drag(i)} />}
        </div>
      ))}
    </div>
  );
}

export function BoardPage() {
  const { name = 'main' } = useParams({ strict: false }) as { name?: string };
  const valid = BOARD_NAME.test(name);
  const navigate = useNavigate();
  const toast = useToast();
  const [board, setBoardState] = useState<Board>(() =>
    valid ? loadBoard(name) : { layout: null, scale: {}, fit: {} },
  );
  useEffect(() => {
    if (valid) setBoardState(loadBoard(name));
  }, [name, valid]);
  const setBoard = useCallback(
    (f: (b: Board) => Board) => {
      setBoardState((b) => {
        const next = f(b);
        if (valid) saveBoard(name, next);
        return next;
      });
    },
    [name, valid],
  );
  const order = useMemo(() => panesOf(board.layout), [board.layout]);
  const [focused, setFocused] = useState<string | null>(null);
  const focus = focused && order.includes(focused) ? focused : (order[0] ?? null);
  const shown: BoardNode | null =
    board.zoom && order.includes(board.zoom) ? { kind: 'pane', id: board.zoom } : board.layout;
  const [adding, setAdding] = useState<'h' | 'v' | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [refitTick, setRefitTick] = useState(0);
  const all = useAllPanes(true);
  const focusedPane = useMemo(
    () => (all.data ?? []).find((p) => p.address === focus),
    [all.data, focus],
  );
  const writable = focusedPane?.mode === 'write';
  const input = useInput(focus ?? '');
  useEffect(() => {
    setHeading({ pane: focusedPane, place: `board ${name}` });
    return () => setHeading({ place: '' });
  }, [focusedPane, name]);
  const open = useCallback(
    (id: string) => navigate({ to: '/p/$', params: { _splat: id } }),
    [navigate],
  );
  // Zoom shows one pane alone; a second time brings the board back.
  const zoom = useCallback(
    (id: string) => {
      setFocused(id);
      setBoard((b) => ({ ...b, zoom: b.zoom === id ? undefined : id }));
    },
    [setBoard],
  );
  const move = (id: string) => {
    setFocused(id);
    if (board.zoom) setBoard((b) => ({ ...b, zoom: id }));
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      // Ctrl with an arrow switches the pane from anywhere, the input line too.
      const arrow = ev.ctrlKey && !ev.metaKey && !ev.altKey && /^Arrow(Left|Right)$/.test(ev.key);
      const step = ev.key === 'ArrowRight' ? 1 : -1;
      const i = focus ? order.indexOf(focus) : -1;
      const k = ev.key;
      if (arrow && order.length) move(order[(i + step + order.length) % order.length]);
      else if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      else if (ev.ctrlKey || ev.metaKey || ev.altKey || adding) return;
      else if (k === 'a') setAdding('h');
      else if (k === 'A') setAdding('v');
      else if (k === ']' && order.length) move(order[(i + 1) % order.length]);
      else if (k === '[' && order.length) move(order[(i - 1 + order.length) % order.length]);
      else if (k === 'x' && focus) setBoard((b) => removePane(b, focus));
      else if (k === 's' && focus && order.length > 1)
        setBoard((b) => swapPanes(b, focus, order[(i + 1) % order.length]));
      else if (k === '=') setBoard((b) => equalise(b));
      else if (k === '+' && focus)
        setBoard((b) => ({
          ...b,
          scale: { ...b.scale, [focus]: Math.min(3, (b.scale[focus] ?? 1) * 1.15) },
        }));
      else if (k === '-' && focus)
        setBoard((b) => ({
          ...b,
          scale: { ...b.scale, [focus]: Math.max(0.4, (b.scale[focus] ?? 1) / 1.15) },
        }));
      else if (k === 'z' && focus) zoom(focus);
      else if (k === 'f' && focus && writable)
        setBoard((b) => ({ ...b, fit: { ...b.fit, [focus]: !b.fit[focus] } }));
      else if (k === 'r' && focus && writable && board.fit[focus]) setRefitTick((n) => n + 1);
      else if (k === 'F') {
        const on = !order.some((id) => board.fit[id]);
        const fit: Record<string, boolean> = {};
        for (const id of order) if (on) fit[id] = true;
        setBoard((b) => ({ ...b, fit }));
      } else if (k === 'Enter' && focus) open(focus);
      else if (k === 'w' && focusedPane)
        navigate({
          to: `/w/${focusedPane.host}/${focusedPane.session}/${focusedPane.window_index}`,
        });
      else return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    adding,
    focus,
    order,
    board.fit,
    board.zoom,
    focusedPane,
    writable,
    navigate,
    open,
    zoom,
    setBoard,
  ]);

  const send = async (body: { text: string } | { key: Key } | { mouse: Mouse }) => {
    if (!focus) return;
    try {
      await input.mutateAsync(body);
    } catch (err) {
      toast.push({
        kind: 'refused',
        title: err instanceof ApiError ? err.code : 'hub unreachable',
      });
    }
  };

  if (!valid) {
    return (
      <div className="mx-empty mx-bad" data-testid="board-error">
        a board is named with letters, digits and dashes, up to 32 of them
      </div>
    );
  }
  return (
    <div className="mx-winview mx-board" data-testid="board" data-panes={order.join(' ')}>
      <div className="mx-pane-head">
        <span>▤ {name}</span>
        <span className="mx-dim" data-testid="focus">
          focus: {focus ?? 'none'}
        </span>
        <button type="button" onClick={() => setAdding('h')} title="add a pane beside (a)">
          + beside
        </button>
        <button type="button" onClick={() => setAdding('v')} title="add a pane below (A)">
          + below
        </button>
        {board.zoom && (
          <button
            type="button"
            className="mx-toggle on"
            onClick={() => setBoard((b) => ({ ...b, zoom: undefined }))}
            title="the whole board again (z, or double-click)"
            data-testid="unzoom"
          >
            zoomed
          </button>
        )}
        <button type="button" onClick={() => setBoard((b) => equalise(b))} title="equal shares (=)">
          equalise
        </button>
      </div>
      <div className="mx-area">
        {shown ? (
          <Tree
            node={shown}
            path={[]}
            board={board}
            focus={focus}
            dragging={dragging}
            refitTick={refitTick}
            setBoard={setBoard}
            setFocused={setFocused}
            setDragging={setDragging}
            zoom={zoom}
          />
        ) : (
          <div className="mx-cell mx-cell-gap mx-board-empty" data-testid="board-empty">
            <span>
              an empty board: <kbd>a</kbd> adds a pane
            </span>
            <button type="button" onClick={() => setAdding('h')} data-testid="board-add">
              add a pane
            </button>
          </div>
        )}
      </div>
      <InputPanel
        pane={focusedPane}
        writable={writable}
        placeholder={focus ? (writable ? `type into ${focus}` : 'read-only pane') : 'no pane'}
        send={send}
      />
      {adding && (
        <Palette
          title={adding === 'h' ? 'add beside' : 'add below'}
          exclude={order}
          pick={(p) => {
            setBoard((b) => addPane(b, p.address, focus, adding));
            setFocused(p.address);
          }}
          onClose={() => setAdding(null)}
        />
      )}
    </div>
  );
}
