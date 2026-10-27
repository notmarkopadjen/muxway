import { useEffect } from 'react';
import { ApiError } from '../api/client';
import { usePane } from '../api/queries';
import { describe } from '../term/describe';
import { tabName, useLens } from '../term/lens';
import { LensMark } from './Lens';
import { ClaudeMark } from './PaneTitle';

// The minimised row: the tiles taken out of the arrangement, each a tab
// painted with its state, still read every two seconds so its glyph keeps
// moving. A click brings the tile back, focused. Not drawn while empty.
export function MinimisedRow({
  addresses,
  onRestore,
  onGone,
}: {
  addresses: string[];
  onRestore: (address: string) => void;
  onGone: (address: string) => void;
}) {
  if (!addresses.length) return null;
  return (
    <div className="mx-minimised" data-testid="minimised">
      {addresses.map((a) => (
        <MinimisedTab key={a} address={a} onClick={() => onRestore(a)} onGone={() => onGone(a)} />
      ))}
    </div>
  );
}

function MinimisedTab({
  address,
  onClick,
  onGone,
}: {
  address: string;
  onClick: () => void;
  onGone: () => void;
}) {
  const pane = usePane(address, 2_000);
  const lens = useLens();
  const p = pane.data?.pane;
  const st = p ? lens.status(p) : 'quiet';
  // A pane that exited leaves the row, as it would the tiles.
  const gone = pane.error instanceof ApiError && pane.error.status === 404;
  useEffect(() => {
    if (gone) onGone();
  }, [gone, onGone]);
  return (
    <button
      type="button"
      className="mx-tab mx-painted"
      data-testid="minimised-tab"
      data-address={address}
      data-state={st === 'quiet' ? undefined : st}
      onClick={onClick}
      title={`${address} · minimised, a click brings it back`}
    >
      {p && describe(p).agent === 'claude' && <ClaudeMark />}
      {st !== 'quiet' && <LensMark status={st} attention={p?.attention} />}
      <span className="mx-tab-name">{p ? tabName(p) : address.split('/').slice(1).join('/')}</span>
    </button>
  );
}
