import { SHELL_COMMANDS } from '../term/commands';
import { AgentMark } from './PaneTitle';
import type { Offer } from '../term/complete';

// The list above the input line while a word is typed: the program's
// commands, then words from the screen, marked ⇥ since Tab takes them
// and Enter sends the line as typed. A click takes a row; the keys are
// the field's, which keeps the focus.
export function Completions({
  items,
  picked,
  onTake,
}: {
  items: Offer[];
  picked: number;
  onTake: (c: string) => void;
}) {
  return (
    <div className="mx-complete" role="listbox" data-testid="complete">
      {items.map((o, i) => (
        <div
          key={o.text}
          role="option"
          aria-selected={i === picked}
          className={i === picked ? 'mx-picked' : undefined}
          data-testid="completion"
          data-text={o.text}
          data-kind={o.kind}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onTake(o.text)}
        >
          {i === picked ? '▸ ' : '  '}
          <AgentMark agent={SHELL_COMMANDS.find((c) => c.text === o.text)?.agent} />
          {o.text}
          {o.kind === 'word' ? <span className="mx-dim"> ⇥</span> : null}
        </div>
      ))}
    </div>
  );
}
