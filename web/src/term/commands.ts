import { useSyncExternalStore } from 'react';
import type { Pane } from '../api/types';
import { describe, type Agent } from './describe';

// The command row under the key bar: what the program in the focused pane
// is driven with, one button each. Claude Code takes slash commands; a
// shell takes the commands a person starts things with, then the last
// lines sent to a shell from this browser. A command either goes at once,
// followed by Enter, or fills the input line and waits for the rest.

// A command's tone tints its button: danger for what throws work away,
// start for what begins something, info for what only tells, act for
// the rest.
export type Tone = 'danger' | 'start' | 'info' | 'act';

export interface Command {
  label: string;
  text: string;
  send: boolean;
  tone: Tone;
  // The agent a starter launches, for its mark on the button.
  agent?: Agent;
}

export interface Row {
  kind: 'claude' | 'codex' | 'antigravity' | 'shell';
  commands: Command[];
}

const at = (text: string, tone: Tone = 'act'): Command => ({ label: text, text, send: true, tone });
const starts = (text: string, agent: Agent): Command => ({ ...at(text, 'start'), agent });
const fill = (text: string, tone: Tone = 'act'): Command => ({
  label: text,
  text: text + ' ',
  send: false,
  tone,
});

export const CLAUDE_COMMANDS: Command[] = [
  at('/clear', 'danger'),
  at('/exit', 'danger'),
  at('/compact'),
  fill('/rename'),
  at('/model', 'info'),
  at('/resume', 'start'),
  at('/usage', 'info'),
  at('/context', 'info'),
  at('/help', 'info'),
  at('/status', 'info'),
  at('/cost', 'info'),
  at('/todos', 'info'),
  at('/plan', 'start'),
  at('/review'),
  at('/memory', 'info'),
  at('/init', 'start'),
  at('/config', 'info'),
  at('/permissions', 'info'),
  at('/mcp', 'info'),
  at('/agents', 'info'),
  at('/hooks', 'info'),
  at('/doctor', 'info'),
  at('/fast'),
  at('/export'),
];

// Codex CLI's slash commands.
export const CODEX_COMMANDS: Command[] = [
  at('/new', 'danger'),
  at('/quit', 'danger'),
  at('/compact'),
  at('/model', 'info'),
  at('/approvals', 'info'),
  at('/status', 'info'),
  at('/diff', 'info'),
  at('/review'),
  at('/init', 'start'),
  at('/mcp', 'info'),
  fill('/mention'),
];

// Antigravity CLI's slash commands, from its reference.
export const AGY_COMMANDS: Command[] = [
  at('/clear', 'danger'),
  at('/exit', 'danger'),
  at('/rewind', 'danger'),
  at('/resume', 'start'),
  fill('/plan', 'start'),
  fill('/goal', 'start'),
  fill('/grill-me', 'start'),
  at('/diff', 'info'),
  at('/context', 'info'),
  at('/usage', 'info'),
  at('/model', 'info'),
  fill('/effort'),
  fill('/rename'),
  fill('/learn'),
  at('/tasks', 'info'),
  at('/agents', 'info'),
  at('/skills', 'info'),
  at('/permissions', 'info'),
  at('/hooks', 'info'),
  at('/mcp', 'info'),
  at('/config', 'info'),
  at('/help', 'info'),
];

export const SHELL_COMMANDS: Command[] = [
  at('exit', 'danger'),
  at('htop', 'info'),
  starts('claude', 'claude'),
  starts('claude -c', 'claude'),
  starts('claude --resume', 'claude'),
  starts('codex', 'codex'),
  starts('agy', 'antigravity'),
  starts('gemini', 'gemini'),
  at('git status', 'info'),
  at('git diff', 'info'),
  at('git log --oneline -20', 'info'),
  at('git pull'),
  at('git push'),
  at('git stash'),
  at('git stash pop'),
  at('make'),
  at('make test'),
  at('npm test'),
  at('npm run build'),
  at('docker ps', 'info'),
  at('tmux ls', 'info'),
  at('ls', 'info'),
  at('ls -la', 'info'),
  at('pwd', 'info'),
  at('cd ..'),
  at('clear'),
  at('history', 'info'),
  at('df -h', 'info'),
  at('free -h', 'info'),
];

const SHELLS = new Set(['bash', 'zsh', 'fish', 'sh', 'dash', 'ash', 'ksh', 'tcsh', 'csh']);

export function isShell(command: string): boolean {
  return SHELLS.has(command);
}

const LABEL = 24;

export function commandsFor(p: Pick<Pane, 'command' | 'title'>, recent: string[]): Row | null {
  const agent = describe(p).agent;
  if (agent === 'claude') return { kind: 'claude', commands: CLAUDE_COMMANDS };
  if (agent === 'codex') return { kind: 'codex', commands: CODEX_COMMANDS };
  if (agent === 'antigravity') return { kind: 'antigravity', commands: AGY_COMMANDS };
  if (!isShell(p.command)) return null;
  const extra = recent
    .filter((r) => !SHELL_COMMANDS.some((c) => c.text === r))
    .map((r) => ({
      label: r.length > LABEL ? r.slice(0, LABEL - 1) + '…' : r,
      text: r,
      send: true,
      tone: 'act' as const,
    }));
  return { kind: 'shell', commands: [...SHELL_COMMANDS, ...extra] };
}

// The last lines sent to a shell, newest first, kept by the browser.
const KEY = 'mx-recent';
export const RECENT_MAX = 8;
const LINE_MAX = 200;

let recent: string[] = load();
const listeners = new Set<() => void>();

function load(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

// A line that looks like it carries a secret: a credential word, a muxway
// token, or an upper-case NAME=value assignment, exported or not.
const SECRET_WORDS = /authorization|token|passw(or)?d|secret|mxt_|api[_-]?key/i;
const ASSIGNMENT = /(^|\s)(export\s+)?[A-Z_][A-Z0-9_]*=/;

export function looksSecret(line: string): boolean {
  return SECRET_WORDS.test(line) || ASSIGNMENT.test(line);
}

export function remember(line: string) {
  const t = line.trim();
  if (!t || t.length > LINE_MAX || looksSecret(t)) return;
  recent = [t, ...recent.filter((r) => r !== t)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(recent));
  } catch {
    // a browser without storage keeps the list for the page's life
  }
  listeners.forEach((l) => l());
}

export function forgetRecent() {
  recent = [];
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to forget
  }
  listeners.forEach((l) => l());
}

export function recentLines(): string[] {
  return recent;
}

export function useRecent(): string[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => recent,
  );
}
