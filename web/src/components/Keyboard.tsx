import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CAPS,
  fresh,
  HEIGHT,
  needsGrammar,
  press,
  WIDTH,
  type Body,
  type Cap,
} from '../term/keyboard';

// The keyboard window: the board over the pane view, sending each click to
// the focused pane. Its place, whether it is folded and the click sound are
// this browser's own.

const STORE = 'mx-keyboard';

interface Kept {
  x: number;
  y: number;
  folded: boolean;
  sound: boolean;
}

function load(): Kept | null {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Kept) : null;
  } catch {
    return null;
  }
}

function keep(k: Kept) {
  try {
    localStorage.setItem(STORE, JSON.stringify(k));
  } catch {
    /* storage off */
  }
}

// A short tick, made here rather than loaded.
let audio: AudioContext | null = null;
function tick() {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'square';
    o.frequency.value = 1800;
    g.gain.setValueAtTime(0.06, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.03);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.04);
  } catch {
    /* no audio */
  }
}

export function Keyboard({
  target,
  grammar,
  send,
  onRefused,
  onClose,
}: {
  target: string;
  grammar: boolean;
  send: (body: Body) => Promise<boolean>;
  onRefused: (why: string) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState(fresh);
  const [kept, setKept] = useState<Kept>(
    () =>
      load() ?? {
        x: Math.max(16, window.innerWidth / 2 - 470),
        y: Math.max(16, window.innerHeight - 420),
        folded: false,
        sound: false,
      },
  );
  const [lit, setLit] = useState<string | null>(null);
  const [shaken, setShaken] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => keep(kept), [kept]);

  const hit = useCallback(
    async (c: Cap) => {
      const r = press(c.act, state, grammar);
      setState(r.state);
      setLit(c.id);
      window.setTimeout(() => setLit((l) => (l === c.id ? null : l)), 140);
      if (kept.sound) tick();
      const ok = r.send ? await send(r.send) : !r.refuse;
      if (r.refuse) onRefused(r.refuse);
      if (!ok) {
        setShaken(c.id);
        window.setTimeout(() => setShaken(null), 320);
      }
    },
    [state, grammar, kept.sound, send, onRefused],
  );

  // The title bar drags the window, kept inside the screen.
  const drag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const ox = e.clientX - kept.x;
    const oy = e.clientY - kept.y;
    const move = (ev: PointerEvent) => {
      const w = box.current?.offsetWidth ?? 0;
      setKept((k) => ({
        ...k,
        x: Math.min(Math.max(0, ev.clientX - ox), Math.max(0, window.innerWidth - w)),
        y: Math.min(Math.max(0, ev.clientY - oy), window.innerHeight - 24),
      }));
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const latched = (c: Cap) =>
    c.act.t === 'mod'
      ? state.mods[c.act.m]
      : c.act.t === 'caps'
        ? state.caps && 'lock'
        : c.act.t === 'num'
          ? state.num && 'lock'
          : undefined;
  const dimmed = (c: Cap) =>
    (!grammar && needsGrammar(c)) ||
    (c.act.t === 'char' && c.act.c === ';' && (state.mods.C !== 'off' || state.mods.M !== 'off'));

  return (
    <div
      ref={box}
      className={`mx-keyboard${kept.folded ? ' folded' : ''}`}
      style={{ left: kept.x, top: kept.y }}
      role="dialog"
      aria-label={`keyboard for ${target}`}
      data-testid="keyboard"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="mx-keyboard-bar" onPointerDown={drag} data-testid="keyboard-bar">
        <span>┌─ keyboard ─ </span>
        <span className="mx-keyboard-target" data-testid="keyboard-target">
          {target}
        </span>
        <span className="mx-spacer">─</span>
        <button
          type="button"
          className={kept.sound ? 'on' : undefined}
          onClick={() => setKept((k) => ({ ...k, sound: !k.sound }))}
          title={`click sound, ${kept.sound ? 'on' : 'off'}`}
          aria-pressed={kept.sound}
          data-testid="keyboard-sound"
        >
          ♪
        </button>
        <button
          type="button"
          onClick={() => setKept((k) => ({ ...k, folded: !k.folded }))}
          title={kept.folded ? 'unfold' : 'fold to the bar'}
          data-testid="keyboard-fold"
        >
          _
        </button>
        <button type="button" onClick={onClose} title="close (Esc)" data-testid="keyboard-close">
          ×
        </button>
      </div>
      {!kept.folded && (
        <div className="mx-board-scroll">
          <div
            className="mx-board"
            style={{
              gridTemplateColumns: `repeat(${WIDTH * 4}, calc(var(--mx-k) / 4))`,
              gridTemplateRows: `repeat(${HEIGHT * 2}, calc(var(--mx-k) / 2))`,
            }}
          >
            {CAPS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`mx-cap${lit === c.id ? ' lit' : ''}${shaken === c.id ? ' shake' : ''}${
                  c.label.length > 3 ? ' small' : ''
                }`}
                style={{
                  gridColumn: `${c.x * 4 + 1} / span ${c.w * 4}`,
                  gridRow: `${c.y * 2 + 1} / span ${c.h * 2}`,
                }}
                data-latch={latched(c) && latched(c) !== 'off' ? latched(c) : undefined}
                data-dim={dimmed(c) ? '' : undefined}
                data-cap={c.label}
                title={c.title}
                onClick={() => void hit(c)}
                onDoubleClick={
                  c.act.t === 'mod'
                    ? () => {
                        const m = (c.act as { m: 'C' | 'M' | 'S' }).m;
                        setState((s) => ({ ...s, mods: { ...s.mods, [m]: 'lock' } }));
                      }
                    : undefined
                }
              >
                {c.up && <span className="up">{c.up}</span>}
                <span>{c.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
