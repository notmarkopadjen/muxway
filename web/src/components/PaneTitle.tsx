import type { Pane } from '../api/types';
import { describe, type Agent } from '../term/describe';

// The marks of the AI CLIs, drawn with strokes so they are the same in
// every font: a spark for Claude Code, a hexagon for Codex, a lifted
// chevron for Antigravity. Decorative: the name beside them says who.
export function ClaudeMark() {
  // A spark: twelve rays from the centre.
  const rays = Array.from({ length: 12 }, (_, i) => (i * 30 * Math.PI) / 180);
  return (
    <svg className="mx-mark mx-mark-claude" viewBox="-10 -10 20 20" aria-hidden="true">
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

export function CodexMark() {
  // A hexagon, a point up, with a dot at its heart.
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = ((i * 60 - 90) * Math.PI) / 180;
    return `${(Math.cos(a) * 8).toFixed(2)},${(Math.sin(a) * 8).toFixed(2)}`;
  }).join(' ');
  return (
    <svg className="mx-mark mx-mark-codex" viewBox="-10 -10 20 20" aria-hidden="true">
      <polygon points={pts} fill="none" />
      <circle r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function AntigravityMark() {
  // A chevron lifted off its ground line.
  return (
    <svg className="mx-mark mx-mark-antigravity" viewBox="-10 -10 20 20" aria-hidden="true">
      <polyline points="-7,2 0,-7 7,2" fill="none" />
      <line x1="-5" y1="7.5" x2="5" y2="7.5" />
    </svg>
  );
}

// The mark of an agent, or nothing for a program without one.
export function AgentMark({ agent }: { agent?: Agent }) {
  switch (agent) {
    case 'claude':
      return <ClaudeMark />;
    case 'codex':
      return <CodexMark />;
    case 'antigravity':
      return <AntigravityMark />;
    default:
      return null;
  }
}

// The pane's own name: what runs in it and what it says it is doing.
export function PaneTitle({ pane }: { pane: Pick<Pane, 'command' | 'title'> }) {
  const d = describe(pane);
  return (
    <span className="mx-title" data-testid="pane-title" data-agent={d.agent}>
      <AgentMark agent={d.agent} />
      <span className="mx-title-name">{d.name}</span>
      {d.status && <span className="mx-title-status"> · {d.status}</span>}
    </span>
  );
}
