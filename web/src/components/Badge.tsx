import type { Attention } from '../api/types';

export const GLYPH: Record<Attention['kind'], string> = {
  question: '?',
  permission: '!',
  idle: '…',
  done: '✓',
};

export function Badge({ attention }: { attention?: Attention }) {
  if (!attention) return <span className="mx-badge-slot" />;
  const pulse = attention.kind === 'question' || attention.kind === 'permission';
  return (
    <span
      className={`mx-badge mx-${attention.kind}${pulse ? ' mx-pulse' : ''}`}
      title={attention.text || attention.kind}
      data-testid="badge"
      data-kind={attention.kind}
    >
      {GLYPH[attention.kind]}
    </span>
  );
}
