import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Pane } from '../api/types';
import { describe, label } from './describe';

// The Claude Code lens, as the Android client has it: a pane is waiting
// for its owner (the listing carries a notification), working (Claude
// Code's last event was `working`, or its content changed in the last
// ten seconds while a tile reads it), or quiet. The last event kind per
// pane comes from the shell's event stream, the change time from the
// tile that reads the pane. tmux's own activity flag is not used: it is
// the window's, shared by every pane in it.

export type Status = 'waiting' | 'working' | 'quiet';

export const RECENT_MS = 10_000;

export function status(
  p: Pick<Pane, 'command' | 'title' | 'attention'>,
  lastKind: string | undefined,
  changedAt: number | undefined,
  now: number,
): Status {
  if (p.attention) return 'waiting';
  const claude = describe(p).agent === 'claude';
  const recent = changedAt !== undefined && now - changedAt >= 0 && now - changedAt < RECENT_MS;
  if (claude && (lastKind === 'working' || recent)) return 'working';
  return 'quiet';
}

// One character for tabs, headers and rows; empty when there is nothing to say.
export function glyph(s: Status, kind?: string): string {
  if (s === 'working') return '⟳';
  if (s !== 'waiting') return '';
  switch (kind) {
    case 'question':
      return '?';
    case 'idle':
      return 'z';
    case 'done':
      return '✓';
    default:
      return '!';
  }
}

export function word(s: Status, kind?: string): string {
  if (s === 'working') return 'working';
  if (s === 'waiting') return kind ?? 'waiting';
  return '';
}

// A tab's name: what Claude wrote into the title, else what runs there.
export function tabName(p: Pick<Pane, 'command' | 'title'>): string {
  const d = describe(p);
  return d.agent ? d.status || d.name : label(p);
}

const kinds = new Map<string, string>();
const changes = new Map<string, number>();
const own = new Map<string, number>();

// How long after this client's own input or resize a change of content
// is the client's doing, not the program's.
export const OWN_MS = 3_000;
const listeners = new Set<() => void>();
let version = 0;

function bump() {
  version++;
  listeners.forEach((fn) => fn());
}

export function noteEvent(address: string, kind: string) {
  if (!address || !kind) return;
  kinds.set(address, kind);
  bump();
}

export function noteChange(address: string, at = Date.now()) {
  const mine = own.get(address);
  if (mine !== undefined && at - mine < OWN_MS) return;
  changes.set(address, at);
  bump();
}

// This client typed into or resized the pane: what changes next is its doing.
export function noteOwn(address: string, at = Date.now()) {
  own.set(address, at);
}

export function changedAt(address: string): number | undefined {
  return changes.get(address);
}

export function lastKind(address: string): string | undefined {
  return kinds.get(address);
}

export function resetLens() {
  kinds.clear();
  changes.clear();
  own.clear();
  bump();
}

// The lens as of now: re-renders on an event or a change, and every few
// seconds so a working mark ages out.
export function useLens() {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(t);
  }, []);
  return {
    now,
    status: (p: Pane) => status(p, kinds.get(p.address), changes.get(p.address), Date.now()),
  };
}
