import { describe, expect, it } from 'vitest';
import { spared } from './spare';

describe('spared', () => {
  const ask = { cols: 42, rows: 29 };
  it('a pane the listing has at its ask is spared; another size is sent', () => {
    expect(spared({ cols: 42, rows: 29 }, ask, false, false)).toBe(true);
    expect(spared({ cols: 28, rows: 29 }, ask, false, false)).toBe(false);
    expect(spared({ cols: 42, rows: 30 }, ask, false, false)).toBe(false);
  });
  it('a pane the listing does not have is sent', () => {
    expect(spared(undefined, ask, false, false)).toBe(false);
    expect(spared(undefined, ask, true, true)).toBe(false);
  });
  it('a zoom is spared only when the listing has the pane zoomed at that size', () => {
    expect(spared({ cols: 135, rows: 29, zoomed: true }, { cols: 135, rows: 29 }, true, true)).toBe(
      true,
    );
    expect(spared({ cols: 135, rows: 29 }, { cols: 135, rows: 29 }, true, false)).toBe(false);
  });
  it('the fit back from a zoom made here is sent whatever the listing says', () => {
    // The poll answered before the zoom: the pane at its old ask.
    expect(spared({ cols: 42, rows: 29 }, ask, false, true)).toBe(false);
    // The poll caught up: zoomed and wide.
    expect(spared({ cols: 135, rows: 29, zoomed: true }, ask, false, true)).toBe(false);
  });
});
