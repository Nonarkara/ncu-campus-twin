import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error — plain ESM pipeline module
import { SOLAR } from '../pipeline/solar.mjs';

const s = JSON.parse(readFileSync(new URL('../public/data/solar.json', import.meta.url), 'utf8'));
describe('solar conservation law', () => {
  it('campus total equals the sum over buildings', () => {
    const sum = s.buildings.reduce((a: number, b: any) => a + b.kwp, 0);
    expect(Math.abs(sum - s.total_kwp)).toBeLessThan(0.5);
  });
  it('no building exceeds footprint × usable share × module density', () => {
    for (const b of s.buildings) expect(b.kwp).toBeLessThanOrEqual(b.area_m2 * SOLAR.usableRoof * SOLAR.kwpPerM2 + 0.1);
  });
  it('low case is the declared ratio of the high case', () => {
    expect(s.total_kwp_low / s.total_kwp).toBeCloseTo(SOLAR.usableRoofLow / SOLAR.usableRoof, 3);
  });
  it('ships its assumptions and tier', () => {
    expect(s.meta.tier).toBe('modeled'); expect(s.meta.assumptions.note).toMatch(/not a design/);
  });
});
