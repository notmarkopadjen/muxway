import { useSyncExternalStore } from 'react';
import type { Pane } from '../api/types';
import { describe } from './describe';

// The command row under the key bar: what the program in the focused pane
// is driven with, one button each. Claude Code takes slash commands; a
// shell takes the commands a person starts things with, then the last
// lines sent to a shell from this browser. A command either goes at once,
// followed by Enter, or fills the input line and waits for the rest.

export interface Command {
  label: string;
  text: string;
  send: boolean;
}

export interface Row {
  kind: 'claude' | 'shell';
  commands: Command[];
}

const at = (text: string): Command => ({ label: text, text, send: true });
const fill = (text: string): Command => ({ label: text, text: text + ' ', send: false });

export const CLAUDE_COMMANDS: Command[] = [
  at('/clear'),
  at('/compact'),
  fill('/rename'),
  at('/model'),
  at('/resume'),
  at('/usage'),
  at('/context'),
  at('/help'),
];

export const SHELL_COMMANDS: Command[] = [
  at('exit'),
  at('htop'),
  at('claude'),
  at('claude -c'),
  at('codex'),
  at('gemini'),
  at('git status'),
  at('ls'),
  at('clear'),
];

const SHELLS = new Set(['bash', 'zsh', 'fish', 'sh', 'dash', 'ash', 'ksh', 'tcsh', 'csh']);

export function isShell(command: string): boolean {
  return SHELLS.has(command);
}

const LABEL = 24;

export function commandsFor(p: Pick<Pane, 'command' | 'title'>, recent: string[]): Row | null {
  if (describe(p).agent === 'claude') return { kind: 'claude', commands: CLAUDE_COMMANDS };
  if (!isShell(p.command)) return null;
  const extra = recent
    .filter((r) => !SHELL_COMMANDS.some((c) => c.text === r))
    .map((r) => ({
      label: r.length > LABEL ? r.slice(0, LABEL - 1) + '…' : r,
      text: r,
      send: true,
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

export function remember(line: string) {
  const t = line.trim();
  if (!t || t.length > LINE_MAX) return;
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
