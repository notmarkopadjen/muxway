import type { Attention } from '../api/types';
import { glyph, word, type Status } from '../term/lens';
import { Badge } from './Badge';

// A turning ring: the working mark, drawn rather than typed, so it is the
// same in every font.
export function WorkingMark() {
  return (
    <svg className="mx-mark mx-mark-working" viewBox="-10 -10 20 20" aria-label="working">
      <circle r="7" fill="none" strokeDasharray="33 11" />
    </svg>
  );
}

// A pane's state as the lens sees it: the badge while it waits for you,
// a turning mark while it works, and the word after it when asked.
export function LensMark({
  status,
  attention,
  withWord = false,
}: {
  status: Status;
  attention?: Attention;
  withWord?: boolean;
}) {
  if (status === 'waiting') {
    return (
      <>
        <Badge attention={attention} />
        {withWord && <span className="mx-word">{word(status, attention?.kind)}</span>}
      </>
    );
  }
  if (status === 'working') {
    return (
      <>
        <span className="mx-badge mx-working" data-testid="working" title={glyph(status)}>
          <WorkingMark />
        </span>
        {withWord && <span className="mx-word">{word(status)}</span>}
      </>
    );
  }
  return <span className="mx-badge-slot" />;
}
