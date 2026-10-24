import type { Pane } from '../api/types';
import { describe } from '../term/describe';

export function ClaudeMark() {
  // A spark: twelve rays from the centre.
  const rays = Array.from({ length: 12 }, (_, i) => (i * 30 * Math.PI) / 180);
  return (
    <svg className="mx-mark mx-mark-claude" viewBox="-10 -10 20 20" aria-label="Claude">
      {rays.map((a, i) => (
        <line
          key={i}
          x1={Math.cos(a) * 3}
          y1={Math.sin(a) * 3}
          x2={Math.cos(a) * (i % 2 ? 7 : 9)}
          y2={Math.sin(a) * (i % 2 ? 7 : 9)}
        />
      ))}
    </svg>
  );
}

// The pane's own name: what runs in it and what it says it is doing.
export function PaneTitle({ pane }: { pane: Pick<Pane, 'command' | 'title'> }) {
  const d = describe(pane);
  return (
    <span className="mx-title" data-testid="pane-title" data-agent={d.agent}>
      {d.agent === 'claude' && <ClaudeMark />}
      <span className="mx-title-name">{d.name}</span>
      {d.status && <span className="mx-title-status"> · {d.status}</span>}
    </span>
  );
}
