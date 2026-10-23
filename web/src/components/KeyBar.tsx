import { useState } from 'react';
import { KEYS, type Key } from '../api/types';

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
