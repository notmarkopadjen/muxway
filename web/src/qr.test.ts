import { describe, expect, it } from 'vitest';
import { connectCode, qrModules } from './qr';
import { BIG, REAL, SMALL } from './qr.fixtures';

const TOKEN = 'mxt_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';
const LONG_HUB = `https://${'a'.repeat(118)}.example.com`;

const rows = (m: boolean[][] | null) =>
  m?.map((r) => r.map((v) => (v ? '1' : '0')).join('')).join('\n');

describe('connectCode', () => {
  it('builds the payload the phone app parses, encoded as the script does', () => {
    expect(connectCode('https://hub.example.com', TOKEN)).toBe(
      `muxway://connect?hub=https://hub.example.com&token=${TOKEN}`,
    );
    expect(connectCode('https://hub.example.com:8443/mux', 'mxt_a=b&c%d')).toBe(
      'muxway://connect?hub=https://hub.example.com:8443/mux&token=mxt_a%3Db%26c%25d',
    );
  });
});

describe('qrModules', () => {
  it('matches the script for a small code (version 2)', () => {
    expect(rows(qrModules(connectCode('https://h', 'mxt_a')))).toBe(SMALL.trim());
  });
  it('matches the script for a real code', () => {
    expect(rows(qrModules(connectCode('https://hub.example.com', TOKEN)))).toBe(REAL.trim());
  });
  it('matches the script for the largest code that fits (version 10, 213 bytes)', () => {
    const text = connectCode(LONG_HUB, TOKEN);
    expect(new TextEncoder().encode(text).length).toBe(213);
    expect(rows(qrModules(text))).toBe(BIG.trim());
  });
  it('is null when the text does not fit', () => {
    expect(qrModules(connectCode(`${LONG_HUB}x`, TOKEN))).toBeNull();
  });
});
