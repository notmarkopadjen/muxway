import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { keys, knownPane, takeFrame } from './queries';
import type { Pane, PaneContent, Tree, WindowContent } from './types';

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

describe('takeFrame', () => {
  const frame = (address: string, id: string, content: string): PaneContent => ({
    pane: pane(address, { pane_id: id, title: 'after' }),
    content,
    trimmed: 2,
  });

  it('sets the pane query and patches the pane in the window query that holds it, by id', () => {
    const qc = new QueryClient();
    const a = 'alice-laptop/work/0.0';
    const b = 'alice-laptop/work/0.1';
    qc.setQueryData<WindowContent>(keys.window('alice-laptop', 'work', '0'), {
      host: 'alice-laptop',
      session: 'work',
      window: { index: 0, name: 'w', layout: '', active: true },
      panes: [frame(a, '%1', 'before a'), frame(b, '%2', 'before b')],
    });
    qc.setQueryData<WindowContent>(keys.window('alice-laptop', 'work', '1'), {
      host: 'alice-laptop',
      session: 'work',
      window: { index: 1, name: 'x', layout: '', active: false },
      panes: [frame('alice-laptop/work/1.0', '%3', 'other')],
    });
    takeFrame(qc, a, frame(a, '%1', 'after a'));
    expect(qc.getQueryData<PaneContent>(keys.pane(a))?.content).toBe('after a');
    const w = qc.getQueryData<WindowContent>(keys.window('alice-laptop', 'work', '0'));
    expect(w?.panes.map((p) => p.content)).toEqual(['after a', 'before b']);
    expect(w?.panes[0].pane.title).toBe('after');
    expect(
      qc.getQueryData<WindowContent>(keys.window('alice-laptop', 'work', '1'))?.panes[0].content,
    ).toBe('other');
  });

  it("names another hub's pane as this page does and leaves the window queries alone", () => {
    const qc = new QueryClient();
    const a = 'work~alice-laptop/work/0.0';
    qc.setQueryData<WindowContent>(keys.window('alice-laptop', 'work', '0'), {
      host: 'alice-laptop',
      session: 'work',
      window: { index: 0, name: 'w', layout: '', active: true },
      panes: [frame('alice-laptop/work/0.0', '%1', 'before')],
    });
    takeFrame(qc, a, frame('alice-laptop/work/0.0', '%1', 'after'));
    const got = qc.getQueryData<PaneContent>(keys.pane(a));
    expect(got?.pane.address).toBe(a);
    expect(got?.pane.hub).toBe('work');
    expect(
      qc.getQueryData<WindowContent>(keys.window('alice-laptop', 'work', '0'))?.panes[0].content,
    ).toBe('before');
  });
});
