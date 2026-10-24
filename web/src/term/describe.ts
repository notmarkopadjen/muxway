import type { Pane } from '../api/types';

// What a pane is, for a person: the program in it and what that program
// says about itself. An AI CLI is named, with the status it writes into
// the pane title; the tmux names step back to second place.

export interface Description {
  agent?: 'claude';
  name: string;
  status: string;
}

// Claude Code leads its title with a spark glyph and follows it with what
// it is on.
const CLAUDE = /^[✳✶✻✽✢]\s*/u;

export function describe(p: Pick<Pane, 'command' | 'title'>): Description {
  const title = p.title.trim();
  if (p.command === 'claude' || CLAUDE.test(title)) {
    const status = title.replace(CLAUDE, '').trim();
    return { agent: 'claude', name: 'Claude', status: status === p.command ? '' : status };
  }
  return { name: p.command, status: title === p.command ? '' : title };
}

export function label(p: Pick<Pane, 'command' | 'title'>): string {
  const d = describe(p);
  return d.status ? `${d.name} · ${d.status}` : d.name;
}
