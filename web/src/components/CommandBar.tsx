import { useState } from 'react';
import { SHELL_COMMANDS, type Command, type Row } from '../term/commands';
import { AgentMark } from './PaneTitle';

// One row of commands for the program in the focused pane, scrolling
// sideways like the tab strip. The agent's mark or a prompt sign says
// whose commands they are; a starter carries the mark of what it starts.
const ROW_NAMES = {
  claude: 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity',
  shell: 'shell',
} as const;

export function CommandBar({
  row,
  disabled,
  onRun,
}: {
  row: Row;
  disabled: boolean;
  onRun: (c: Command) => void;
}) {
  const [pressed, setPressed] = useState<string | null>(null);
  const fixed = row.kind === 'shell' ? SHELL_COMMANDS.length : row.commands.length;
  return (
    <div className="mx-cmdbar" data-testid="cmdbar" data-kind={row.kind}>
      <span className="mx-cmdmark" title={ROW_NAMES[row.kind]}>
        {row.kind === 'shell' ? '$' : <AgentMark agent={row.kind} />}
      </span>
      {row.commands.map((c, i) => (
        <span key={c.text}>
          {i === fixed && <span className="mx-cmdsep">│</span>}
          <button
            type="button"
            disabled={disabled}
            className={pressed === c.text ? 'mx-press' : undefined}
            onAnimationEnd={() => setPressed(null)}
            title={c.send ? `send ${c.text} and Enter` : `put ${c.text.trim()} on the input line`}
            data-testid="cmd"
            data-text={c.text}
            data-tone={c.tone}
            onClick={() => {
              setPressed(c.text);
              onRun(c);
            }}
          >
            <AgentMark agent={c.agent} />
            {c.label}
          </button>
        </span>
      ))}
    </div>
  );
}
