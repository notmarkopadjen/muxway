import { describe, expect, it } from 'vitest';
import { meter, resample, rms, wavFile } from './recorder';

describe('wavFile', () => {
  it('writes the 44-byte header the hub checks', () => {
    const pcm = new Int16Array([0, 1000, -1000, 32767]);
    const buf = wavFile(pcm, 16000);
    const v = new DataView(buf);
    const ascii = (at: number, n: number) => String.fromCharCode(...new Uint8Array(buf, at, n));
    expect(buf.byteLength).toBe(44 + 8);
    expect(ascii(0, 4)).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(36 + 8);
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(12, 4)).toBe('fmt ');
    expect(v.getUint32(16, true)).toBe(16);
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(28, true)).toBe(32000);
    expect(v.getUint16(32, true)).toBe(2);
    expect(v.getUint16(34, true)).toBe(16);
    expect(ascii(36, 4)).toBe('data');
    expect(v.getUint32(40, true)).toBe(8);
    expect(v.getInt16(46, true)).toBe(1000);
    expect(v.getInt16(48, true)).toBe(-1000);
    expect(v.getInt16(50, true)).toBe(32767);
  });
});

describe('resample', () => {
  it('turns a second at 48 kHz into a second at 16 kHz', () => {
    const out = resample(new Int16Array(48000), 48000, 16000);
    expect(out.length).toBe(16000);
  });
  it('interpolates between neighbours', () => {
    const out = resample(new Int16Array([0, 300, 600, 900]), 32000, 16000);
    expect(Array.from(out)).toEqual([0, 600]);
    const up = resample(new Int16Array([0, 100]), 8000, 16000);
    expect(Array.from(up)).toEqual([0, 50, 100, 100]);
  });
  it('is the same array at the same rate', () => {
    const pcm = new Int16Array([1, 2, 3]);
    expect(resample(pcm, 16000, 16000)).toBe(pcm);
  });
});

describe('rms and meter', () => {
  it('is 0 for silence and 1 for a loud frame', () => {
    expect(rms(new Int16Array(160))).toBe(0);
    expect(rms(new Int16Array(160).fill(16000))).toBe(1);
    expect(rms(new Int16Array(0))).toBe(0);
    const quiet = rms(new Int16Array(160).fill(2000));
    expect(quiet).toBeCloseTo(0.25);
  });
  it('draws the last frames as blocks, padded on the left', () => {
    expect(meter([])).toBe('▁▁▁▁▁▁▁▁');
    expect(meter([0, 0.5, 1])).toBe('▁▁▁▁▁▁▅█');
    expect(meter([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1])).toBe('▃▄▅▅▆▇██');
    expect(meter([0.5], 3)).toBe('▁▁▅');
  });
});
