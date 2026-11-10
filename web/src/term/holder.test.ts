import { describe, expect, it } from 'vitest';
import { browserLabel } from './client';
import { heldWords, holderOf, refitOnTouch, REFIT_GAP_MS } from './holder';

describe('holder', () => {
  const web = { token: 'web', client: 'Chrome', at: 1, mine: true };
  it('nobody holds a pane the listing says nothing about: an older agent, never fitted, released', () => {
    expect(holderOf(undefined, 'Chrome')).toEqual({ kind: 'none' });
    expect(heldWords({ kind: 'none' })).toBe('held');
  });
  it('this very client holds it: mine and the same label', () => {
    expect(holderOf(web, 'Chrome')).toEqual({ kind: 'self' });
    expect(heldWords({ kind: 'self' })).toBe('held');
  });
  it('another principal, or the same one from another client, is another', () => {
    expect(holderOf({ ...web, mine: false, token: 'phone', client: 'Pixel 9' }, 'Chrome')).toEqual({
      kind: 'other',
      token: 'phone',
      client: 'Pixel 9',
    });
    expect(holderOf({ ...web, client: 'Firefox' }, 'Chrome')).toEqual({
      kind: 'other',
      token: 'web',
      client: 'Firefox',
    });
    expect(heldWords({ kind: 'other', token: 'phone', client: 'Pixel 9' })).toBe(
      'held by phone · Pixel 9',
    );
    expect(heldWords({ kind: 'other', token: 'phone', client: '' })).toBe('held by phone');
  });
  it('an interaction refits only against another, two seconds apart', () => {
    const other = { kind: 'other' as const, token: 'phone', client: 'Pixel 9' };
    expect(refitOnTouch(other, 0, REFIT_GAP_MS)).toBe(true);
    expect(refitOnTouch(other, 1000, 1000 + REFIT_GAP_MS - 1)).toBe(false);
    expect(refitOnTouch({ kind: 'self' }, 0, 10_000)).toBe(false);
    expect(refitOnTouch({ kind: 'none' }, 0, 10_000)).toBe(false);
  });
  it('the label is the browser family', () => {
    expect(
      browserLabel(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36',
      ),
    ).toBe('Chrome');
    expect(
      browserLabel('Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0'),
    ).toBe('Firefox');
    expect(
      browserLabel(
        'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      ),
    ).toBe('Safari');
    expect(browserLabel('Mozilla/5.0 Chrome/120.0 Safari/537.36 Edg/120.0')).toBe('Edge');
    expect(browserLabel('curl/8.0')).toBe('browser');
  });
});
