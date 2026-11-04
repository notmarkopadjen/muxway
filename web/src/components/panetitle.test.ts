import { describe, expect, it } from 'vitest';
import { paneTooltip, SLOW_MAX_MS, SLOW_MIN_MS, slowSecond } from './PaneTitle';
import type { Pane } from '../api/types';

const pane = {
  address: 'alice-laptop/work/1.0',
  command: 'claude',
  title: '✳ drafting the plan',
  alias: 'review',
  width: 126,
  height: 55,
  mode: 'write',
  cwd: '/home/alice/src/project',
} as Pane;

describe('the header under the pointer', () => {
  it('says what the program says, the place, the size, the mode and the folder', () => {
    expect(paneTooltip(pane)).toBe(
      'Claude · drafting the plan\nalice-laptop/work/1.0 · 126×55 · write\n/home/alice/src/project',
    );
    expect(paneTooltip({ ...pane, cwd: undefined, alias: undefined })).toBe(
      'Claude · drafting the plan\nalice-laptop/work/1.0 · 126×55 · write',
    );
  });

  it('takes a slow second click, not a double-click nor a forgotten one', () => {
    expect(slowSecond(undefined, 10_000)).toBe(false);
    expect(slowSecond(10_000, 10_000 + SLOW_MIN_MS - 1)).toBe(false);
    expect(slowSecond(10_000, 10_000 + SLOW_MIN_MS)).toBe(true);
    expect(slowSecond(10_000, 10_000 + SLOW_MAX_MS)).toBe(true);
    expect(slowSecond(10_000, 10_000 + SLOW_MAX_MS + 1)).toBe(false);
  });
});
