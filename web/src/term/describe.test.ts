import { describe as group, expect, it } from 'vitest';
import { aliasOf, describe, label } from './describe';

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

  it("goes by the owner's name first, what the program says as the status", () => {
    expect(describe({ command: 'claude', title: '✳ fixing the build', alias: 'review' })).toEqual({
      agent: 'claude',
      name: 'review',
      status: 'fixing the build',
    });
    expect(describe({ command: 'claude', title: 'claude', alias: 'review' })).toEqual({
      agent: 'claude',
      name: 'review',
      status: '',
    });
    expect(describe({ command: 'vim', title: 'notes.md', alias: 'notes' })).toEqual({
      name: 'notes',
      status: 'vim · notes.md',
    });
    expect(describe({ command: 'bash', title: 'bash', alias: 'build' })).toEqual({
      name: 'build',
      status: 'bash',
    });
    expect(label({ command: 'bash', title: 'bash', alias: 'build' })).toBe('build · bash');
    expect(describe({ command: 'bash', title: 'bash', alias: '' })).toEqual({
      name: 'bash',
      status: '',
    });
  });

  it('turns what is typed into an alias as it goes', () => {
    expect(aliasOf('Fix Tests')).toBe('fix-tests');
    expect(aliasOf('a_b')).toBe('a-b');
    expect(aliasOf('ü')).toBe('');
    expect(aliasOf('../x $(id)')).toBe('x-id');
    expect(aliasOf('a'.repeat(40))).toHaveLength(32);
  });
});

group('describe: the other harnesses', () => {
  it('names them by their command', () => {
    expect(describe({ command: 'codex', title: 'codex' })).toEqual({
      agent: 'codex',
      name: 'Codex',
      status: '',
    });
    expect(describe({ command: 'opencode', title: 'muxway' })).toEqual({
      agent: 'opencode',
      name: 'OpenCode',
      status: 'muxway',
    });
    expect(describe({ command: 'cursor-agent', title: '' }).agent).toBe('cursor');
    expect(describe({ command: 'agy', title: 'notes' })).toEqual({
      agent: 'antigravity',
      name: 'Antigravity',
      status: 'notes',
    });
    expect(label({ command: 'aider', title: 'aider' })).toBe('aider');
  });

  it('finds the ones under an interpreter by their title', () => {
    expect(describe({ command: 'node', title: 'Gemini - ~/work' })).toEqual({
      agent: 'gemini',
      name: 'Gemini',
      status: 'Gemini - ~/work',
    });
    expect(describe({ command: 'node', title: 'copilot' }).agent).toBe('copilot');
    expect(describe({ command: 'bash', title: 'gemini notes' }).agent).toBeUndefined();
    expect(describe({ command: 'node', title: 'server.js' }).agent).toBeUndefined();
  });
});
