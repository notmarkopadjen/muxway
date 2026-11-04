import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { keys, knownPane } from './queries';
import type { Pane, PaneContent, Tree } from './types';

const pane = (address: string, extra: Partial<Pane> = {}): Pane =>
  ({ address, host: address.split('/')[0], mode: 'write', ...extra }) as Pane;

describe('knownPane', () => {
  it('takes the open view first, then the list, then the tree', () => {
    const qc = new QueryClient();
    const a = 'alice-laptop/work/0.0';
    expect(knownPane(qc, a)).toBeUndefined();
    qc.setQueryData<Tree>(keys.tree('alice-laptop'), {
      sessions: [{ name: 'work', windows: [{ index: 0, panes: [pane(a, { title: 'tree' })] }] }],
    } as unknown as Tree);
    expect(knownPane(qc, a)?.title).toBe('tree');
    qc.setQueryData<Pane[]>(keys.panesOf(), [pane(a, { title: 'list' })]);
    expect(knownPane(qc, a)?.title).toBe('list');
    qc.setQueryData<PaneContent>(keys.pane(a), { pane: pane(a, { title: 'open' }) } as PaneContent);
    expect(knownPane(qc, a)?.title).toBe('open');
  });

  it('names another hub pane as this page does', () => {
    const qc = new QueryClient();
    const bare = 'bob-desktop/work/0.0';
    const a = `lab~${bare}`;
    qc.setQueryData<Tree>(keys.tree('bob-desktop', 'lab'), {
      sessions: [{ name: 'work', windows: [{ index: 0, panes: [pane(bare)] }] }],
    } as unknown as Tree);
    expect(knownPane(qc, a)).toMatchObject({ address: a, hub: 'lab' });
    expect(knownPane(qc, bare)).toBeUndefined();
  });
});
