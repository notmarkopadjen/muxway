import { describe, expect, it } from 'vitest';
import type { Host, Me, Pane } from '../api/types';
import { addRows } from './addmenu';

function pane(address: string, mode: 'read' | 'write' = 'write'): Pane {
  const [host, session, rest] = address.split('/');
  const [w, p] = rest.split('.').map(Number);
  return {
    host,
    address,
    session_id: '$1',
    session,
    window_id: `@${w}`,
    window_index: w,
    window: 'shell',
    window_layout: '',
    window_active: true,
    pane_id: `%${w}${p}`,
    pane_index: p,
    pane_active: p === 0,
    width: 80,
    height: 24,
    title: 'bash',
    command: 'bash',
    activity: 0,
    mode,
  };
}

const BUILD = pane('alice-laptop/work/0.0');
const DEPLOY = pane('alice-laptop/work/0.1', 'read');
const LOGS = pane('alice-laptop/work/1.0');
const HTOP = pane('bob-server/ops/0.0', 'read');
const HUBLOG = pane('bob-server/ops/1.0', 'read');
const PANES = [BUILD, DEPLOY, LOGS, HTOP, HUBLOG];
const HOSTS: Host[] = [
  { name: 'alice-laptop', online: true, sessions: true },
  { name: 'bob-server', online: true },
];
const ME: Me = {
  id: 't1',
  name: 'alice',
  method: 'token',
  read: ['*'],
  write: ['alice-laptop/*'],
  expires: 0,
};

describe('addRows', () => {
  it('leaves out the focused pane and the open tiles, minimised first, the rest by host and session', () => {
    const rows = addRows({
      panes: PANES,
      hosts: HOSTS,
      me: ME,
      open: [BUILD.address, LOGS.address],
      minimised: [DEPLOY.address],
      focused: BUILD,
    });
    expect(rows.pane).toEqual({ on: true });
    expect(rows.session).toEqual({ on: true });
    expect(rows.minimised).toEqual([DEPLOY]);
    expect(rows.groups.map((g) => [g.host, g.session, g.panes.map((p) => p.address)])).toEqual([
      ['bob-server', 'ops', [HTOP.address, HUBLOG.address]],
    ]);
    expect(rows.full).toBe(false);
  });

  it('keeps the listing order and splits groups at a session', () => {
    const rows = addRows({
      panes: PANES,
      hosts: HOSTS,
      me: ME,
      open: [HTOP.address],
      minimised: [],
      focused: HTOP,
    });
    expect(rows.groups.map((g) => g.key)).toEqual(['~alice-laptop/work', '~bob-server/ops']);
    expect(rows.groups[0].panes).toEqual([BUILD, DEPLOY, LOGS]);
    expect(rows.groups[1].panes).toEqual([HUBLOG]);
    expect(rows.groups[0].hub).toBeUndefined();
  });

  it('groups by hub first when the listing has more than one', () => {
    const far = { ...HTOP, address: 'work~' + HTOP.address, hub: 'work' };
    const rows = addRows({
      panes: [BUILD, far, LOGS],
      hosts: [...HOSTS, { name: 'bob-server', online: true, sessions: true, hub: 'work' }],
      me: ME,
      open: [BUILD.address],
      minimised: [],
      focused: BUILD,
    });
    expect(rows.groups.map((g) => [g.hub, g.host, g.panes.map((p) => p.address)])).toEqual([
      ['work', 'bob-server', [far.address]],
      ['', 'alice-laptop', [LOGS.address]],
    ]);
    // + session looks at the focused pane's own hub's host.
    const there = addRows({
      panes: [BUILD, far],
      hosts: [{ name: 'bob-server', online: true, sessions: true, hub: 'work' }],
      me: { ...ME, write: ['bob-server/*'] },
      open: [far.address],
      minimised: [],
      focused: far,
    });
    expect(there.session).toEqual({ on: true });
  });

  it('dims + pane on a read-only pane and + session where the host or the grant lacks', () => {
    const onBob = addRows({
      panes: PANES,
      hosts: HOSTS,
      me: ME,
      open: [HTOP.address],
      minimised: [],
      focused: HTOP,
    });
    expect(onBob.pane).toEqual({ on: false, why: 'read only' });
    expect(onBob.session).toEqual({ on: false, why: 'no sessions here' });
    const reader = addRows({
      panes: PANES,
      hosts: HOSTS,
      me: { ...ME, write: [] },
      open: [BUILD.address],
      minimised: [],
      focused: { ...BUILD, mode: 'read' },
    });
    expect(reader.pane.on).toBe(false);
    expect(reader.session).toEqual({ on: false, why: 'no sessions here' });
    expect(reader.groups.flatMap((g) => g.panes)).toHaveLength(4);
  });

  it('says four open, and drops a minimised address the listing no longer has', () => {
    const rows = addRows({
      panes: PANES,
      hosts: HOSTS,
      me: ME,
      open: [BUILD.address, DEPLOY.address, LOGS.address, HTOP.address],
      minimised: ['alice-laptop/work/9.9'],
      focused: BUILD,
    });
    expect(rows.full).toBe(true);
    expect(rows.minimised).toEqual([]);
    expect(rows.groups.flatMap((g) => g.panes)).toEqual([HUBLOG]);
  });

  it('has nothing to say without a focused pane', () => {
    const rows = addRows({
      panes: [],
      hosts: [],
      me: undefined,
      open: [],
      minimised: [],
      focused: undefined,
    });
    expect(rows.pane.on).toBe(false);
    expect(rows.session.on).toBe(false);
    expect(rows.groups).toEqual([]);
  });
});
