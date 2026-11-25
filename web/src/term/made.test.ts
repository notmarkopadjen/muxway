import { beforeEach, describe, expect, it } from 'vitest';
import { forgetMade, madeLast, noteMade } from './made';

const pane = (address: string, pane_id: string) => ({ address, pane_id });

describe('made', () => {
  beforeEach(forgetMade);

  it('leaves the panes alone until one is made here', () => {
    const panes = [pane('a/w/0.0', '%1'), pane('a/w/0.1', '%2')];
    expect(madeLast(panes)).toBe(panes);
  });

  it('puts a pane made here last, wherever the listing has it', () => {
    noteMade('%9');
    const panes = [pane('a/w/0.0', '%1'), pane('a/w/0.1', '%9'), pane('a/w/0.2', '%2')];
    expect(madeLast(panes).map((p) => p.pane_id)).toEqual(['%1', '%2', '%9']);
  });

  it('follows the pane through a renumbering, since it goes by id', () => {
    noteMade('%9');
    const after = [pane('a/w/0.0', '%1'), pane('a/w/0.2', '%9'), pane('a/w/0.3', '%2')];
    expect(madeLast(after).map((p) => p.address)).toEqual(['a/w/0.0', 'a/w/0.3', 'a/w/0.2']);
  });

  it('keeps several in the order they were made', () => {
    noteMade('%8');
    noteMade('%9');
    const panes = [pane('a/w/0.0', '%9'), pane('a/w/0.1', '%1'), pane('a/w/0.2', '%8')];
    expect(madeLast(panes).map((p) => p.pane_id)).toEqual(['%1', '%8', '%9']);
  });

  it('lets the owner’s own order have the last word', () => {
    noteMade('%9');
    const panes = [pane('a/w/0.0', '%1'), pane('a/w/0.1', '%9'), pane('a/w/0.2', '%2')];
    expect(madeLast(panes, ['a/w/0.1']).map((p) => p.pane_id)).toEqual(['%1', '%9', '%2']);
  });

  it('says nothing of a pane that is gone', () => {
    noteMade('%9');
    const panes = [pane('a/w/0.0', '%1')];
    expect(madeLast(panes)).toBe(panes);
  });

  it('notes a pane once and keeps the last sixteen', () => {
    noteMade('%1');
    noteMade('%1');
    for (let i = 2; i <= 20; i++) noteMade(`%${i}`);
    const panes = [pane('a/w/0.0', '%1'), pane('a/w/0.1', '%20')];
    expect(madeLast(panes).map((p) => p.pane_id)).toEqual(['%1', '%20']);
  });
});
