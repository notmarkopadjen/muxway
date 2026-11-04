import type { TalkPartner } from '../api/types';

// The chain: two links, drawn with strokes like the agents' marks, in the
// talk hue. It marks a pane that talked with another lately; with a
// partner's name beside it on a header, alone on a tab or a row.
export function ChainMark({ fresh = false }: { fresh?: boolean }) {
  return (
    <svg
      className={`mx-mark mx-mark-talk${fresh ? ' mx-talk-fresh' : ''}`}
      viewBox="-10 -10 20 20"
      aria-label="talks with another pane"
      data-testid="talk-mark"
    >
      <rect x="-9" y="-3.5" width="11" height="7" rx="3.5" fill="none" />
      <rect x="-2" y="-3.5" width="11" height="7" rx="3.5" fill="none" />
    </svg>
  );
}

// Mail waiting for a pane's process: the envelope and the count, in the
// talk hue, on a tab, a row or a header. A click opens the pane's mail.
export function MailMark({ unread, onClick }: { unread: number; onClick?: () => void }) {
  return (
    <span
      className="mx-mail-count"
      data-testid="mail-mark"
      role={onClick ? 'button' : undefined}
      title={`${unread} unread mail for the process in this pane${onClick ? ': click reads it' : ''}`}
      onClick={
        onClick &&
        ((e) => {
          e.stopPropagation();
          onClick();
        })
      }
    >
      ✉ {unread}
    </span>
  );
}

// A partner said something in the last few seconds: the mark pulses.
export const FRESH_MS = 3_000;

export function fresh(talk: TalkPartner[] | undefined, now = Date.now()): boolean {
  return !!talk?.some((p) => now - p.at * 1000 < FRESH_MS);
}
