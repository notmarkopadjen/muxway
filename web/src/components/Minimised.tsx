import type { Pane } from '../api/types';
import { describe } from '../term/describe';
import { tabName } from '../term/lens';
import { Badge, GLYPH } from './Badge';
import { AgentMark } from './PaneTitle';

// The minimised row: the panes parked for later, less the tiles, each a
// tab painted from the listing with the moon and what waits underneath,
// dimmed. A click wakes the pane and brings it back as a tile, focused.
// Not drawn while empty.
export function MinimisedRow({
  panes,
  onRestore,
}: {
  panes: Pane[];
  onRestore: (address: string) => void;
}) {
  if (!panes.length) return null;
  return (
    <div className="mx-minimised" data-testid="minimised">
      {panes.map((p) => (
        <button
          type="button"
          key={p.address}
          className="mx-tab mx-painted"
          data-testid="minimised-tab"
          data-address={p.address}
          data-state="later"
          onClick={() => onRestore(p.address)}
          title={`${p.address} · minimised for later${
            p.attention ? `, ${p.attention.kind} underneath` : ''
          }; a click wakes it and brings it back`}
        >
          <AgentMark agent={describe(p).agent} />
          <Badge attention={p.attention} later />
          {p.attention && (
            <span className="mx-dim" data-testid="under-later">
              {' '}
              · {GLYPH[p.attention.kind]}
            </span>
          )}
          <span className="mx-tab-name">{tabName(p)}</span>
        </button>
      ))}
    </div>
  );
}
