import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { hourlyPvKw, todayPvKwh, simulateIslanding, annualCo2Tonnes, MICROGRID_LOI } from '../src/shared/microgrid';
import { CAMPUS_ANCHORS, SUBSTATION_ID, haversineMeters, polygonCentroid, nearestOnCampusStop, minutesUntil, type CampusData } from '../src/shared/campus';
import type { HourlyPoint } from '../src/shared/today';

const makeHourly = (ghi: number | null, n = 12): HourlyPoint[] =>
  Array.from({ length: n }, (_, i) => ({
    time: `2026-11-23T${String(8 + i).padStart(2, '0')}:00`,
    hm: `${String(8 + i).padStart(2, '0')}:00`,
    temp: 24, precip: 0, prob: 0, gust: 4, uv: 4, ghi,
  }));

describe('microgrid islanding physics', () => {
  it('computes PV kW using GHI and performance ratio, never negative', () => {
    expect(hourlyPvKw(250, 1000)).toBe(200); // 250 * 1.0 * 0.8
    expect(hourlyPvKw(250, 0)).toBe(0);
    expect(hourlyPvKw(250, null)).toBe(0);
    expect(hourlyPvKw(250, -20)).toBe(0);
  });

  it('returns null todayPvKwh when GHI is missing (never invents zero)', () => {
    expect(todayPvKwh(250, makeHourly(null, 8))).toBeNull();
    expect(todayPvKwh(250, makeHourly(500, 4))).toBe(400); // 100 kW * 4 h
  });

  it('nighttime 600 kW critical load on 3 MWh (90% usable = 2700 kWh) lasts 4.5 h and passes 4 h LOI', () => {
    const sim = simulateIslanding({ installedKwp: 250, criticalLoadKw: 600, hourly: makeHourly(0, 8) });
    expect(sim.enduranceHours).toBe(4.5);
    expect(sim.passes4h).toBe(true);
    expect(sim.inverterOverload).toBe(false);
  });

  it('nighttime 800 kW critical load lasts 3.4 h and fails 4 h LOI', () => {
    const sim = simulateIslanding({ installedKwp: 250, criticalLoadKw: 800, hourly: makeHourly(0, 8) });
    expect(sim.enduranceHours).toBe(3.4);
    expect(sim.passes4h).toBe(false);
  });

  it('daytime solar extends 800 kW critical load endurance past 4 h', () => {
    // 250 kWp at 800 W/m² → 160 kW PV → net battery draw 640 kW → 2700 / 640 = 4.2 h
    const sim = simulateIslanding({ installedKwp: 250, criticalLoadKw: 800, hourly: makeHourly(800, 8) });
    expect(sim.enduranceHours).toBeCloseTo(4.2, 1);
    expect(sim.passes4h).toBe(true);
  });

  it('flags inverter overload when net battery draw exceeds 1000 kW', () => {
    const sim = simulateIslanding({ installedKwp: 0, criticalLoadKw: 1100, hourly: makeHourly(0, 8) });
    expect(sim.inverterOverload).toBe(true);
    expect(sim.passes4h).toBe(false);
  });

  it('annual CO2e uses Taiwan MOEA 0.474 kg/kWh factor', () => {
    expect(annualCo2Tonnes(1_000_000)).toBeCloseTo(MICROGRID_LOI.co2KgPerKwh * 1000, 1);
  });
});

describe('campus spatial anchors', () => {
  const campus: CampusData = JSON.parse(readFileSync(new URL('../public/data/campus.json', import.meta.url), 'utf8'));

  it('every named CAMPUS_ANCHOR exists as a real OSM building in campus.json', () => {
    const ids = new Set(campus.buildings.features.map(f => f.properties.id));
    for (const id of Object.keys(CAMPUS_ANCHORS)) {
      expect(ids.has(id)).toBe(true);
    }
    expect(ids.has(SUBSTATION_ID)).toBe(true);
  });

  it('finds a real on-campus nearest bus stop within campus scale (<1000 m)', () => {
    const ee = campus.buildings.features.find(f => f.properties.id === 'way/268841454')!;
    const c = polygonCentroid(ee.geometry.coordinates[0]);
    const stop = nearestOnCampusStop(c, campus.stops.features);
    expect(stop).not.toBeNull();
    expect(stop!.distanceM).toBeGreaterThan(0);
    expect(stop!.distanceM).toBeLessThan(1000);
  });

  it('haversine and minutesUntil compute expected values', () => {
    expect(haversineMeters([121.19, 24.968], [121.19, 24.968])).toBe(0);
    expect(minutesUntil('11:45', '12:13')).toBe(28);
  });
});
