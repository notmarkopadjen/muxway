import { describe, expect, it } from 'vitest';
import { apply, watch, type Reg } from './sw';

function fakeReg(waiting = false) {
  const handlers: Record<string, (() => void)[]> = {};
  const messages: unknown[] = [];
  const reg: Reg & { fire: (ev: string) => void; messages: unknown[] } = {
    waiting: waiting ? { postMessage: (m) => messages.push(m) } : null,
    installing: null,
    addEventListener: (ev, fn) => (handlers[ev] ??= []).push(fn),
    fire: (ev) => handlers[ev]?.forEach((fn) => fn()),
    messages,
  };
  return reg;
}

describe("the service worker's update", () => {
  it('says nothing on a first install, where no worker controls the page', () => {
    const reg = fakeReg();
    let told = 0;
    watch(
      reg,
      () => false,
      () => told++,
    );
    const states: (() => void)[] = [];
    reg.installing = { state: 'installing', addEventListener: (_e, fn) => states.push(fn) };
    reg.fire('updatefound');
    reg.installing.state = 'installed';
    states.forEach((fn) => fn());
    expect(told).toBe(0);
  });

  it('tells of a worker that waits, at once or when its install ends', () => {
    const now = fakeReg(true);
    let told = 0;
    watch(
      now,
      () => true,
      () => told++,
    );
    expect(told).toBe(1);
    const later = fakeReg();
    watch(
      later,
      () => true,
      () => told++,
    );
    const states: (() => void)[] = [];
    later.installing = { state: 'installing', addEventListener: (_e, fn) => states.push(fn) };
    later.fire('updatefound');
    states.forEach((fn) => fn());
    expect(told).toBe(1);
    later.installing.state = 'installed';
    states.forEach((fn) => fn());
    expect(told).toBe(2);
  });

  it('asks the waiting worker to take over and reloads when it does', () => {
    const reg = fakeReg(true);
    let reloaded = 0;
    let onChange: (() => void) | null = null;
    apply(
      reg,
      () => reloaded++,
      (fn) => (onChange = fn),
    );
    expect(reg.messages).toEqual(['mx-skip-waiting']);
    expect(reloaded).toBe(0);
    onChange!();
    expect(reloaded).toBe(1);
  });
});
