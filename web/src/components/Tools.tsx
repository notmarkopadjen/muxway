import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

// The view's buttons at the right of the header: squares on a wide screen,
// one ⋯ with a menu of the same entries where the row is too short.
export interface Tool {
  id: string;
  glyph: string;
  label: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  on?: boolean;
}

const NARROW = '(max-width: 640px)';

function useNarrow(): boolean {
  return useSyncExternalStore(
    (fn) => {
      const q = window.matchMedia(NARROW);
      q.addEventListener('change', fn);
      return () => q.removeEventListener('change', fn);
    },
    () => window.matchMedia(NARROW).matches,
  );
}

export function Tools({ tools }: { tools: Tool[] }) {
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', esc, true);
    };
  }, [open]);
  if (!tools.length) return null;
  const toggle = (t: Tool) => (t.on === undefined ? undefined : `mx-toggle${t.on ? ' on' : ''}`);
  const state = (t: Tool) => (t.on === undefined ? undefined : t.on ? '1' : '0');
  if (!narrow)
    return (
      <span className="mx-tools">
        {tools.map((t) => (
          <button
            key={t.id}
            type="button"
            className={toggle(t)}
            onClick={t.onClick}
            disabled={t.disabled}
            title={t.title}
            data-testid={t.id}
            data-label={t.label}
            data-on={state(t)}
          >
            {t.glyph}
          </button>
        ))}
      </span>
    );
  return (
    <span className="mx-tools mx-tools-folded" ref={box}>
      <button
        type="button"
        className={open ? 'on' : undefined}
        onClick={() => setOpen((o) => !o)}
        title="the pane buttons"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="more"
      >
        ⋯
      </button>
      {open && (
        <div className="mx-menu" role="menu" data-testid="tools-menu">
          {tools.map((t) => (
            <button
              key={t.id}
              type="button"
              role="menuitem"
              className={toggle(t)}
              onClick={() => {
                setOpen(false);
                t.onClick();
              }}
              disabled={t.disabled}
              title={t.title}
              data-testid={t.id}
              data-on={state(t)}
            >
              <span>
                {t.glyph} {t.label}
              </span>
              {t.on !== undefined && <kbd>{t.on ? 'on' : 'off'}</kbd>}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
