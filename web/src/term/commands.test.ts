import { beforeEach, describe as group, expect, it } from 'vitest';
import {
  CLAUDE_COMMANDS,
  commandsFor,
  forgetRecent,
  isShell,
  looksSecret,
  RECENT_MAX,
  recentLines,
  remember,
  SHELL_COMMANDS,
} from './commands';

group('commands', () => {
  beforeEach(() => forgetRecent());

  it('gives Claude Code its slash commands, each sent whole or filled with a space', () => {
    const row = commandsFor({ command: 'node', title: '✳ building' }, []);
    expect(row?.kind).toBe('claude');
    for (const c of CLAUDE_COMMANDS) {
      expect(c.text.startsWith('/')).toBe(true);
      if (c.send) expect(c.text).toBe(c.text.trim());
      else expect(c.text).toMatch(/^\S+ $/);
    }
    expect(CLAUDE_COMMANDS.find((c) => c.label === '/rename')?.send).toBe(false);
  });

  it('gives a shell its commands, exit first, and nothing to another program', () => {
    expect(isShell('bash')).toBe(true);
    expect(isShell('zsh')).toBe(true);
    expect(isShell('vim')).toBe(false);
    expect(commandsFor({ command: 'bash', title: 'bash' }, [])?.kind).toBe('shell');
    expect(SHELL_COMMANDS[0].text).toBe('exit');
    expect(SHELL_COMMANDS.every((c) => c.send)).toBe(true);
    expect(commandsFor({ command: 'vim', title: 'notes.md' }, [])).toBeNull();
    expect(commandsFor({ command: 'claude', title: 'claude' }, [])?.kind).toBe('claude');
    expect(commandsFor({ command: 'codex', title: 'codex' }, [])?.kind).toBe('codex');
    expect(commandsFor({ command: 'agy', title: 'notes' }, [])).toBeNull();
    expect(SHELL_COMMANDS.find((c) => c.text === 'codex')?.agent).toBe('codex');
    expect(SHELL_COMMANDS.find((c) => c.text === 'agy')?.agent).toBe('antigravity');
    expect(SHELL_COMMANDS.find((c) => c.text === 'htop')?.agent).toBeUndefined();
  });

  it('adds the lines sent recently after the fixed ones, newest first, without repeats', () => {
    remember('make lint');
    remember('  ls  ');
    remember('git status');
    remember('make lint');
    remember('');
    const row = commandsFor({ command: 'bash', title: 'bash' }, recentLines());
    const extra = row!.commands.slice(SHELL_COMMANDS.length).map((c) => c.text);
    expect(extra).toEqual(['make lint']);
    const long = 'x'.repeat(40);
    const r2 = commandsFor({ command: 'bash', title: 'bash' }, [long]);
    const last = r2!.commands[r2!.commands.length - 1];
    expect(last.text).toBe(long);
    expect(last.label.length).toBe(24);
    expect(last.label.endsWith('…')).toBe(true);
  });

  it('does not keep a line that looks like it carries a secret', () => {
    for (const line of [
      'curl -H "Authorization: Bearer abc" https://hub.example.com',
      'muxway hub token create alice',
      'echo mxt_abcdef',
      'mysql -u root --password=hunter2',
      'cat /etc/passwd',
      'vault read secret/db',
      'export API_KEY=abc',
      'OPENAI_API_KEY=abc node x.js',
      'FOO=bar make',
      ' export  HOME_DIR=/tmp ls',
    ])
      expect(looksSecret(line), line).toBe(true);
    for (const line of ['make test', 'git log --oneline', 'ls -la', 'echo a=b', 'cd notes'])
      expect(looksSecret(line), line).toBe(false);
    remember('export API_KEY=abc');
    remember('make test');
    expect(recentLines()).toEqual(['make test']);
  });

  it('keeps a bounded list and drops a line too long to be a command', () => {
    for (let i = 0; i < RECENT_MAX + 3; i++) remember(`cmd ${i}`);
    remember('y'.repeat(201));
    const row = commandsFor({ command: 'sh', title: '' }, recentLines());
    const extra = row!.commands.slice(SHELL_COMMANDS.length).map((c) => c.text);
    expect(extra).toHaveLength(RECENT_MAX);
    expect(extra[0]).toBe(`cmd ${RECENT_MAX + 2}`);
  });
});
