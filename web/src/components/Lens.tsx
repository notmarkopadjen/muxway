import type { Attention } from '../api/types';
import { glyph, word, type Status } from '../term/lens';
import { Badge } from './Badge';

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
        <span className="mx-badge mx-working" data-testid="working">
          {glyph(status)}
        </span>
        {withWord && <span className="mx-word">{word(status)}</span>}
      </>
    );
  }
  return <span className="mx-badge-slot" />;
}
