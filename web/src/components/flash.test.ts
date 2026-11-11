import { describe, expect, it } from 'vitest';
import { FLASH_MS, isFlash, makeFlash } from './flash';

// A fake page: what is set, and timers run by hand.
function port() {
  const log: string[] = [];
  const timers = new Map<number, { at: number; f: () => void }>();
  let next = 1;
  let now = 0;
  return {
    log,
    port: {
      set: () => log.push('set'),
      clear: () => log.push('clear'),
      after: (ms: number, f: () => void) => {
        const id = next++;
        timers.set(id, { at: now + ms, f });
        return id;
      },
      cancel: (id: number) => {
        timers.delete(id);
        log.push('cancel');
      },
    },
    tick(ms: number) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.f();
        }
      }
    },
  };
}

describe('the rate-limit flash', () => {
  it('sets the flash once and clears it after its time', () => {
    const p = port();
    const flash = makeFlash(p.port);
    flash();
    expect(p.log).toEqual(['set']);
    p.tick(FLASH_MS - 1);
    expect(p.log).toEqual(['set']);
    p.tick(1);
    expect(p.log).toEqual(['set', 'clear']);
  });

  it('is one flash for a burst: a refusal during it starts the time again', () => {
    const p = port();
    const flash = makeFlash(p.port);
    flash();
    p.tick(1000);
    flash();
    p.tick(1000);
    // Two seconds in, the first flash would have ended; the second holds it.
    expect(p.log).toEqual(['set', 'cancel']);
    p.tick(800);
    expect(p.log).toEqual(['set', 'cancel', 'clear']);
    // After it ended, a new refusal is a new flash.
    flash();
    expect(p.log).toEqual(['set', 'cancel', 'clear', 'set']);
  });

  it('is only the rate limit; other refusals stay toasts', () => {
    expect(isFlash('refused', 'rate_limited')).toBe(true);
    expect(isFlash('refused', 'read_only')).toBe(false);
    expect(isFlash('gone', 'rate_limited')).toBe(false);
  });
});
