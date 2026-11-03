import type { Pane } from '../api/types';

// What a pane is, for a person: the program in it and what that program
// says about itself. An AI CLI is named, with the status it writes into
// the pane title; the tmux names step back to second place. A pane its
// owner named (the alias) goes by that name, and what the program says
// becomes its status.

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

export type Named = Pick<Pane, 'command' | 'title'> & { alias?: string };

export function describe(p: Named): Description {
  if (p.alias) {
    const d = describe({ command: p.command, title: p.title });
    return { agent: d.agent, name: p.alias, status: d.agent ? d.status : said(d) };
  }
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

function said(d: Description): string {
  return d.status ? `${d.name} · ${d.status}` : d.name;
}

export function label(p: Named): string {
  return said(describe(p));
}

// What a typed name becomes: an alias, a-z, 0-9 and - up to 32, a
// space or _ to -, the rest dropped as it is typed.
export function aliasOf(typed: string): string {
  return typed
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 32);
}
