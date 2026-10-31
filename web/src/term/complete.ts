import type { Pane } from '../api/types';
import { AGY_COMMANDS, CLAUDE_COMMANDS, CODEX_COMMANDS, SHELL_COMMANDS, isShell } from './commands';
import { describe } from './describe';

// Completion on the input line. The first word gets the program's own:
// Claude Code's slash commands, the command row's eight first; for a
// shell its starters and the lines sent before. Any word, two letters
// in, also gets the words on the screen, a path a program printed or a
// name from an ls, newest first. Nothing the hub said is ever listed.

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

// The word the caret is at the end of, where it starts, and whether it
// is the line's first.
export function wordAt(
  text: string,
  caret: number,
): { word: string; start: number; first: boolean } | null {
  const before = text.slice(0, caret);
  const m = /(\S+)$/.exec(before);
  if (!m) return null;
  const after = text[caret];
  if (after !== undefined && !/\s/.test(after)) return null;
  const start = caret - m[1].length;
  return { word: m[1], start, first: before.slice(0, start).trim() === '' };
}

// An offer: a command the program takes, which Enter sends as it is, or
// a word from the screen, which Tab puts on the line.
export interface Offer {
  text: string;
  kind: 'command' | 'word';
}

export function completions(
  p: Pick<Pane, 'command' | 'title'>,
  text: string,
  caret: number,
  recent: string[],
  words: string[] = [],
): Offer[] {
  const at = wordAt(text, caret);
  if (!at) return [];
  const out: Offer[] = [];
  if (at.first) {
    let pool: string[] = [];
    const agent = describe(p).agent;
    if (agent === 'claude') pool = [...CLAUDE_COMMANDS.map((c) => c.text.trim()), ...CLAUDE_SLASH];
    else if (agent === 'codex') pool = CODEX_COMMANDS.map((c) => c.text.trim());
    else if (agent === 'antigravity') pool = AGY_COMMANDS.map((c) => c.text.trim());
    else if (isShell(p.command)) pool = [...SHELL_COMMANDS.map((c) => c.text), ...recent];
    for (const c of pool)
      if (c.startsWith(at.word) && !out.some((o) => o.text === c))
        out.push({ text: c, kind: 'command' });
  }
  if (at.word.length >= 2) {
    const low = at.word.toLowerCase();
    for (const w of words)
      if (w !== at.word && w.toLowerCase().startsWith(low) && !out.some((o) => o.text === w))
        out.push({ text: w, kind: 'word' });
  }
  return out.slice(0, MAX_COMPLETIONS);
}

// The words on a screen worth offering: three characters or more, not
// punctuation alone, the last printed first, each once.
export const MAX_WORDS = 400;
export function screenWords(content: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const parts = content.split(/[\s|│┃()[\]{}<>"'`,;]+/);
  for (let i = parts.length - 1; i >= 0 && out.length < MAX_WORDS; i--) {
    const w = parts[i].replace(/^[.:!?]+|[.:!?]+$/g, '');
    if (w.length < 3 || /^[\W_]+$/.test(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

// The text with the word at the caret replaced by the pick and a space
// after it.
export function complete(
  text: string,
  caret: number,
  pick: string,
): { text: string; caret: number } {
  const start = wordAt(text, caret)?.start ?? caret;
  const rest = text.slice(caret).replace(/^[^\S\n]/, '');
  return { text: text.slice(0, start) + pick + ' ' + rest, caret: start + pick.length + 1 };
}
