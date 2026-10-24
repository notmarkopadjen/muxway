import { useState } from 'react';
import { KEYS, type Key } from '../api/types';

// The bar's groups, each with its own discreet tint.
const NAV = new Set(['Up', 'Down', 'Left', 'Right', 'PageUp', 'PageDown', 'Home', 'End']);
export function group(k: Key): 'edit' | 'nav' | 'ctrl' | 'fn' {
  if (k.startsWith('C-')) return 'ctrl';
  if (/^F\d+$/.test(k)) return 'fn';
  return NAV.has(k) ? 'nav' : 'edit';
}

export function KeyBar({ onKey, disabled }: { onKey: (k: Key) => void; disabled: boolean }) {
  const [pressed, setPressed] = useState<Key | null>(null);
  return (
    <div className="mx-keybar" data-testid="keybar">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          disabled={disabled}
          className={pressed === k ? 'mx-press' : undefined}
          data-group={group(k)}
          onAnimationEnd={() => setPressed(null)}
          onClick={() => {
            setPressed(k);
            onKey(k);
          }}
        >
          {k}
        </button>
      ))}
    </div>
  );
}
