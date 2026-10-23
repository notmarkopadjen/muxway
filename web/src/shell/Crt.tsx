import { useEffect, useState, type ReactNode } from 'react';

// The tube: power-on once per page load, scanlines and a vignette always,
// a slow flicker on the glow.
export function Crt({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setOn(false), 1200);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div
      className={`mx-crt${on ? ' mx-power-on' : ''}`}
      data-testid="crt"
      data-power-on={on ? '1' : '0'}
    >
      <div className="mx-flicker" style={{ display: 'contents' }}>
        {children}
      </div>
      <div className="mx-scanlines" aria-hidden="true" />
      <div className="mx-vignette" aria-hidden="true" />
    </div>
  );
}
