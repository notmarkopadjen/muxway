import { describe, expect, it } from 'vitest';
import { mayWriteOn } from './grants';

describe('mayWriteOn', () => {
  it('matches the host segment of a write pattern', () => {
    expect(mayWriteOn(['*'], 'alice-laptop')).toBe(true);
    expect(mayWriteOn(['alice-laptop'], 'alice-laptop')).toBe(true);
    expect(mayWriteOn(['alice-laptop/work/*'], 'alice-laptop')).toBe(true);
    expect(mayWriteOn(['alice-*'], 'alice-laptop')).toBe(true);
    expect(mayWriteOn(['*-laptop/work'], 'alice-laptop')).toBe(true);
  });
  it('names no other host', () => {
    expect(mayWriteOn([], 'alice-laptop')).toBe(false);
    expect(mayWriteOn(['bob-desktop/*'], 'alice-laptop')).toBe(false);
    expect(mayWriteOn(['alice'], 'alice-laptop')).toBe(false);
    expect(mayWriteOn(['alice.laptop'], 'alice-laptop')).toBe(false);
  });
});
