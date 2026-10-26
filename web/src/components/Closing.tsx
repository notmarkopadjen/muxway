import { useEffect, useRef, useState, type ReactNode } from 'react';

// Keeps a window mounted while it powers off, the open animation run
// backwards, then lets it go. With motion off it goes at once.
function still(): boolean {
  return (
    document.documentElement.dataset.motion === 'off' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function Closing({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  // Opened again while closing, the window starts afresh, not mid-fade.
  const [gen, setGen] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) {
      setMounted(true);
      if (closing) setGen((g) => g + 1);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    // On its way out the window takes no keys and holds no focus.
    const active = document.activeElement;
    if (active instanceof HTMLElement && box.current?.contains(active)) active.blur();
    setClosing(true);
    const t = setTimeout(
      () => {
        setMounted(false);
        setClosing(false);
      },
      still() ? 0 : 600,
    );
    return () => clearTimeout(t);
  }, [open, mounted, closing]);
  if (!mounted) return null;
  return (
    <div
      key={gen}
      ref={box}
      className={closing ? 'mx-closing' : undefined}
      style={{ display: 'contents' }}
      inert={closing || undefined}
    >
      {children}
    </div>
  );
}
