import type { Pane } from '../api/types';
import { CLAUDE_COMMANDS, isShell, SHELL_COMMANDS } from './commands';
import { describe } from './describe';

// Completion of the first word on the input line: Claude Code's slash
// commands, the command row's eight first; for a shell its starters and
// the lines sent before. Nothing from a pane or the hub is ever listed.

export const CLAUDE_SLASH = [
  '/add-dir',
  '/agents',
  '/bug',
  '/clear',
  '/compact',
  '/config',
  '/context',
  '/cost',
  '/doctor',
  '/exit',
  '/export',
  '/help',
  '/hooks',
  '/ide',
  '/init',
  '/login',
  '/logout',
  '/mcp',
  '/memory',
  '/model',
  '/permissions',
  '/pr-comments',
  '/release-notes',
  '/rename',
  '/resume',
  '/review',
  '/sandbox',
  '/security-review',
  '/stats',
  '/status',
  '/terminal-setup',
  '/usage',
  '/vim',
];

export const MAX_COMPLETIONS = 8;

// The first word of the text when the caret is at its end and only
// blanks come before it; otherwise nothing is offered.
export function firstWord(text: string, caret: number): string | null {
  const m = /^\s*(\S+)$/.exec(text.slice(0, caret));
  if (!m) return null;
  const after = text[caret];
  return after === undefined || /\s/.test(after) ? m[1] : null;
}

export function completions(
  p: Pick<Pane, 'command' | 'title'>,
  text: string,
  caret: number,
  recent: string[],
): string[] {
  const word = firstWord(text, caret);
  if (!word) return [];
  let pool: string[];
  if (describe(p).agent === 'claude')
    pool = [...CLAUDE_COMMANDS.map((c) => c.text.trim()), ...CLAUDE_SLASH];
  else if (isShell(p.command)) pool = [...SHELL_COMMANDS.map((c) => c.text), ...recent];
  else return [];
  const out: string[] = [];
  for (const c of pool) if (c.startsWith(word) && !out.includes(c)) out.push(c);
  return out.slice(0, MAX_COMPLETIONS);
}

// The text with its first word replaced by the pick and a space after it.
export function complete(
  text: string,
  caret: number,
  pick: string,
): { text: string; caret: number } {
  const before = text.slice(0, caret);
  const lead = before.length - before.trimStart().length;
  const rest = text.slice(caret).replace(/^[^\S\n]/, '');
  return { text: text.slice(0, lead) + pick + ' ' + rest, caret: lead + pick.length + 1 };
}
