import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error — plain ESM pipeline module
import { SOLAR, monthlyIrradiation } from '../pipeline/solar.mjs';

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

describe('solar season', () => {
  it('conserves annual irradiation and preserves the length of each month', () => {
    const season = JSON.parse(readFileSync(new URL('../public/data/solar-season.json', import.meta.url), 'utf8'));
    const months = season.months as { month: number; days: number; kwhM2: number }[];
    expect(months.map(m => m.month)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(months.map(m => m.days)).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
    expect(Math.round(months.reduce((sum, m) => sum + m.kwhM2, 0))).toBe(s.meta.assumptions.ghi_kwh_m2_yr);
  });

  it('turns 3.6 MJ/m² per day into 1 kWh/m² per day and rejects a missing reading', () => {
    const archive = {
      timezone: 'Asia/Taipei',
      daily_units: { shortwave_radiation_sum: 'MJ/m²' },
      daily: {
        time: Array.from({ length: 365 }, (_, i) => new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10)),
        shortwave_radiation_sum: Array.from<number | null>({ length: 365 }).fill(3.6),
      },
    };
    expect(monthlyIrradiation(archive, 2025)[1].kwhM2).toBeCloseTo(28);
    archive.daily.shortwave_radiation_sum[31] = null;
    expect(() => monthlyIrradiation(archive, 2025)).toThrow('2025-02-01');
  });
});
