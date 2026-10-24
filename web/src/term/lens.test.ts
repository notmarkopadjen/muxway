import { describe, expect, it } from 'vitest';
import { changedAt, glyph, noteChange, noteOwn, resetLens, status, tabName, word } from './lens';

const claude = { command: 'claude', title: '✳ fixing the build' };
const shell = { command: 'bash', title: 'bash' };
const now = 1_000_000;

describe('lens', () => {
  it('waits on a notification, whatever the pane', () => {
    const attention = { kind: 'permission' as const, at: 1 };
    expect(status({ ...shell, attention }, 'working', now, now)).toBe('waiting');
    expect(status({ ...claude, attention }, undefined, undefined, now)).toBe('waiting');
    // An idle notice while the screen still moves is background work, not a wait.
    const idle = { kind: 'idle' as const, at: 1 };
    expect(status({ ...claude, attention: idle }, undefined, now - 3_000, now)).toBe('working');
    expect(status({ ...claude, attention: idle }, undefined, now - 30_000, now)).toBe('waiting');
    expect(status({ ...shell, attention: idle }, undefined, now - 3_000, now)).toBe('waiting');
  });

  it('works on a working event or a recent change, for Claude only', () => {
    expect(status(claude, 'working', undefined, now)).toBe('working');
    expect(status(claude, undefined, now - 3_000, now)).toBe('working');
    expect(status(claude, undefined, now - 30_000, now)).toBe('quiet');
    expect(status(claude, 'done', undefined, now)).toBe('quiet');
    expect(status(shell, 'working', now, now)).toBe('quiet');
  });

  it('names the state', () => {
    expect(glyph('waiting', 'question')).toBe('?');
    expect(glyph('waiting', 'permission')).toBe('!');
    expect(glyph('waiting', 'idle')).toBe('z');
    expect(glyph('waiting', 'done')).toBe('✓');
    expect(glyph('working')).toBe('⟳');
    expect(glyph('quiet')).toBe('');
    expect(word('waiting', 'permission')).toBe('permission');
    expect(word('working')).toBe('working');
    expect(word('quiet')).toBe('');
  });

  it('names a tab by what Claude wrote, else by what runs there', () => {
    expect(tabName(claude)).toBe('fixing the build');
    expect(tabName({ command: 'claude', title: '✳' })).toBe('Claude');
    expect(tabName(shell)).toBe('bash');
    expect(tabName({ command: 'vim', title: 'notes.md' })).toBe('vim · notes.md');
  });

  it('does not count a change right after this client typed or resized', () => {
    resetLens();
    const a = 'alice-laptop/work/0.0';
    noteOwn(a, now);
    noteChange(a, now + 1_000);
    expect(changedAt(a)).toBeUndefined();
    noteChange(a, now + 4_000);
    expect(changedAt(a)).toBe(now + 4_000);
  });
});
