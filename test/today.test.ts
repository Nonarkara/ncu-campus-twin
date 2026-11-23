import { describe, it, expect } from 'vitest';
import { buildToday, RULES, type Feed, type Forecast, type Air } from '../src/shared/today';
import { routes, scheduledRows, serviceDay, taipei, upcoming, type Row } from '../src/shared/transit';

const hours = (date: string) => Array.from({ length: 48 }, (_, i) => {
  const d = new Date(Date.parse(date + 'T00:00:00Z') + i * 3600e3); return d.toISOString().slice(0, 16); });
function fc(over: Partial<Forecast> = {}): Feed<Forecast> {
  const time = hours('2026-11-23'); const z = (v: number) => time.map(() => v);
  return { meta: { source: 't', tier: 'forecast', asOf: 'x' }, data: { time, precip: z(0), prob: z(0), temp: z(22), gust: z(5), uv: z(2), ...over } };
}
const air = (pm25: number): Feed<Air> => ({ meta: { source: 'a', tier: 'live', asOf: 'x' }, data: { pm25, n: 5, observedAt: 'x' } });
const MON_0900_TPE = new Date('2026-11-23T01:00:00Z');

describe('Today engine', () => {
  it('Taipei clock is UTC+8', () => expect(taipei(MON_0900_TPE)).toMatchObject({ date: '2026-11-23', hm: '09:00', weekend: false }));

  it('calm day → no exceptions, honest blank', () => {
    const t = buildToday(MON_0900_TPE, fc(), air(10));
    expect(t.items).toHaveLength(0);
    expect(t.steady.length).toBeGreaterThan(0);
  });

  it('heavy rain at the CWA threshold becomes an act item', () => {
    const f = fc(); f.data!.precip[12] = RULES.heavyRainHour.mm; // 12:00
    const t = buildToday(MON_0900_TPE, f, air(10));
    expect(t.items[0]).toMatchObject({ id: 'rain-heavy', level: 'act', by: '12:00' });
  });

  it('detects an intense hour in the second half of the forecast across midnight', () => {
    const f = fc(); f.data!.precip[25] = RULES.heavyRainHour.mm;
    expect(buildToday(MON_0900_TPE, f, air(10)).items).toContainEqual(expect.objectContaining({
      id: 'rain-heavy', by: '01:00', rule: RULES.heavyRainHour.src,
    }));
  });

  it('labels a 24-hour accumulation with the 24-hour rule', () => {
    const f = fc(); f.data!.precip.fill(4, 9, 29);
    expect(buildToday(MON_0900_TPE, f, air(10)).items).toContainEqual(expect.objectContaining({
      id: 'rain-heavy', rule: RULES.heavyRainDay.src,
    }));
  });

  it('omits an incomplete chart and total while retaining a known rain alert', () => {
    const f = fc(); f.data!.precip[9] = null; f.data!.temp[25] = null; f.data!.precip[25] = 40;
    const t = buildToday(MON_0900_TPE, f, air(10));
    expect(t.hourly).toEqual([]);
    expect(t.forecastMeta).toMatchObject({ tier: 'unavailable', asOf: null });
    expect(t.steady.map(s => s.id)).not.toContain('weather');
    expect(t.items.find(i => i.id === 'rain-heavy')?.detail[0]).toBe('40 mm/h at 01:00');
  });

  it('omits invalid air readings while accepting a real zero', () => {
    for (const invalid of [NaN, Infinity, -1]) {
      expect(buildToday(MON_0900_TPE, fc(), air(invalid)).steady.map(s => s.id)).not.toContain('air');
    }
    expect(buildToday(MON_0900_TPE, fc(), air(0)).steady.find(s => s.id === 'air')?.value[0]).toContain('0 µg/m³');
  });

  it('PM2.5 orange band triggers, just below does not', () => {
    expect(buildToday(MON_0900_TPE, fc(), air(35.5)).items.map(i => i.id)).toContain('pm25');
    expect(buildToday(MON_0900_TPE, fc(), air(35.4)).items.map(i => i.id)).not.toContain('pm25');
  });

  it('missing feeds never invent numbers', () => {
    const t = buildToday(MON_0900_TPE, { data: null, meta: { source: 's', tier: 'unavailable', asOf: null } },
      { data: null, meta: { source: 'a', tier: 'unavailable', asOf: null } });
    expect(t.steady.map(s => s.id)).not.toContain('weather');
    expect(t.steady.map(s => s.id)).not.toContain('air');
  });

  it('honesty envelope: every rendered value carries source and tier', () => {
    const f = fc(); f.data!.gust[11] = 20; f.data!.temp[13] = 37;
    const t = buildToday(MON_0900_TPE, f, air(50));
    for (const x of [...t.items, ...t.steady]) { expect(x.meta.source).toBeTruthy(); expect(x.meta.tier).toBeTruthy(); }
    expect(t.items.every(i => i.rule && i.owner)).toBe(true);
  });

  it('uses the published break pattern on campus break weekdays', () => {
    const rows: Row[] = [['132', '07:00', '07:20', 'wkday'], ['133', '07:40', '08:00', 'brk'], ['133', '07:45', '08:05', 'term'], ['132', '19:40', '20:00', 'wkend']];
    expect(scheduledRows(rows, 'term').map(r => r[2])).toEqual(['07:20', '08:05']);
    expect(scheduledRows(rows, 'break').map(r => r[2])).toEqual(['07:20', '08:00']);
    expect(scheduledRows(rows, 'weekend').map(r => r[2])).toEqual(['08:00', '20:00']);
  });

  it.each([
    ['2026-11-22T16:00:00Z', 'term'],
    ['2026-12-25T01:00:00Z', 'unverified'],
    ['2026-12-28T01:00:00Z', 'break'],
    ['2027-02-14T16:00:00Z', 'term'],
    ['2027-06-07T01:00:00Z', 'break'],
    ['2027-08-02T01:00:00Z', 'unverified'],
  ])('classifies Taipei service at %s as %s', (instant, day) => {
    expect(serviceDay(taipei(new Date(instant)))).toBe(day);
  });

  it('withholds departure claims on unverified days in Today', () => {
    const t = buildToday(new Date('2026-12-25T01:00:00Z'), fc(), air(10));
    expect(t.steady.find(row => row.id === 'taipei')).toMatchObject({
      value: ['Check operator timetable', '請查客運班表'], meta: { tier: 'unavailable' },
    });
  });

  it('uses the NCU departure column and stops counting after the last trip', () => {
    const { rows, col } = routes.toHSR;
    expect(upcoming(rows, col, '17:59', 'term').at(-1)?.[col]).toBe('18:00');
    expect(upcoming(rows, col, '18:01', 'term')).toEqual([]);
  });
});
