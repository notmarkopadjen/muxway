import type { Pane } from '../api/types';

// What a pane is, for a person: the program in it and what that program
// says about itself. An AI CLI is named, with the status it writes into
// the pane title; the tmux names step back to second place.

export type Agent =
  | 'claude'
  | 'codex'
  | 'gemini'
  | 'antigravity'
  | 'opencode'
  | 'copilot'
  | 'aider'
  | 'goose'
  | 'amp'
  | 'cursor';

export interface Description {
  agent?: Agent;
  name: string;
  status: string;
}

// Claude Code leads its title with a spark glyph and follows it with what
// it is on.
const CLAUDE = /^[✳✶✻✽✢]\s*/u;

// The other harnesses, by their command; the ones that run under an
// interpreter by their name in the title.
const AGENTS: [Agent, string, RegExp | null][] = [
  ['codex', 'Codex', null],
  ['gemini', 'Gemini', /\bgemini\b/i],
  ['antigravity', 'Antigravity', /\bantigravity\b/i],
  ['opencode', 'OpenCode', null],
  ['copilot', 'Copilot', /\bcopilot\b/i],
  ['aider', 'aider', null],
  ['goose', 'goose', null],
  ['amp', 'Amp', null],
  ['cursor', 'Cursor', null],
];
const COMMANDS: Record<string, Agent> = {
  codex: 'codex',
  gemini: 'gemini',
  agy: 'antigravity',
  opencode: 'opencode',
  copilot: 'copilot',
  aider: 'aider',
  goose: 'goose',
  amp: 'amp',
  'cursor-agent': 'cursor',
};
const INTERPRETERS = new Set(['node', 'bun', 'deno', 'python', 'python3', 'uv']);

export function describe(p: Pick<Pane, 'command' | 'title'>): Description {
  const title = p.title.trim();
  if (p.command === 'claude' || CLAUDE.test(title)) {
    const status = title.replace(CLAUDE, '').trim();
    return { agent: 'claude', name: 'Claude', status: status === p.command ? '' : status };
  }
  const byCommand = COMMANDS[p.command];
  for (const [agent, name, inTitle] of AGENTS) {
    if (byCommand === agent || (inTitle && INTERPRETERS.has(p.command) && inTitle.test(title))) {
      const status = title === p.command || title.toLowerCase() === name.toLowerCase() ? '' : title;
      return { agent, name, status };
    }
  }
  return { name: p.command, status: title === p.command ? '' : title };
}

export function label(p: Pick<Pane, 'command' | 'title'>): string {
  const d = describe(p);
  return d.status ? `${d.name} · ${d.status}` : d.name;
}
