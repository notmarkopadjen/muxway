import { describe, expect, it } from 'vitest';
import { hostState } from './hoststate';

describe('the word on a host line', () => {
  it('says offline whatever the listing holds', () => {
    expect(hostState(false, true, 0, false)).toBe('offline');
    expect(hostState(false, false, 3, false)).toBe('offline');
  });
  it('says nothing exposed for an online host whose listing has no pane', () => {
    expect(hostState(true, true, 0, false)).toBe('nothing exposed');
  });
  it('stays online while the listing is on its way, with panes, or under a filter', () => {
    expect(hostState(true, false, 0, false)).toBe('online');
    expect(hostState(true, true, 2, false)).toBe('online');
    expect(hostState(true, true, 0, true)).toBe('online');
  });
});
