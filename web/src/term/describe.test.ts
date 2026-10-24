import { describe as group, expect, it } from 'vitest';
import { describe, label } from './describe';

group('describe', () => {
  it('names a plain program by its command and keeps a title that adds something', () => {
    expect(describe({ command: 'bash', title: 'bash' })).toEqual({ name: 'bash', status: '' });
    expect(describe({ command: 'vim', title: 'notes.md' })).toEqual({
      name: 'vim',
      status: 'notes.md',
    });
    expect(label({ command: 'vim', title: 'notes.md' })).toBe('vim · notes.md');
  });

  it('recognises Claude Code by its command', () => {
    expect(describe({ command: 'claude', title: '✳ fixing the build' })).toEqual({
      agent: 'claude',
      name: 'Claude',
      status: 'fixing the build',
    });
    expect(describe({ command: 'claude', title: 'claude' })).toEqual({
      agent: 'claude',
      name: 'Claude',
      status: '',
    });
  });

  it('recognises Claude Code by its title when it runs under another command', () => {
    expect(describe({ command: 'node', title: '✳ muxway' })).toEqual({
      agent: 'claude',
      name: 'Claude',
      status: 'muxway',
    });
    expect(label({ command: 'node', title: '✳' })).toBe('Claude');
  });

  it('leaves a spark in the middle of a title alone', () => {
    expect(describe({ command: 'bash', title: 'a ✳ b' }).agent).toBeUndefined();
  });
});
