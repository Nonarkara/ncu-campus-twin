import { afterEach, expect, it, vi } from 'vitest';
import sample from './fixtures/moenv-zhongli.json';
import worker from '../worker/index';
import { parseZhongli, stationFeed } from '../src/shared/station-aqi';
import { readStationAqi, STATION_AQI_KEY, updateStationAqi } from '../worker/station-aqi';

const sourceHour = Date.parse('2026-11-25T22:00:00+08:00');
const epoch = sourceHour + 20 * 60e3;
const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;

afterEach(() => vi.unstubAllGlobals());

function store() {
  const data = new Map<string, string>();
  const kv = {
    get: vi.fn(async (key: string, type?: string) => {
      const value = data.get(key) ?? null;
      return type === 'json' && value ? JSON.parse(value) : value;
    }),
    put: vi.fn(async (key: string, value: string) => { data.set(key, value); }),
  } as unknown as KVNamespace;
  return { data, kv };
}

it('accepts the captured Zhongli report, uses Taiwan time, and preserves zero and missing readings', () => {
  expect(parseZhongli(sample, sourceHour)).toEqual({ aqi: 48, publishedAt: '2026-11-25T14:00:00.000Z' });
  expect(parseZhongli([...sample, { AQI: '0' }], sourceHour)?.aqi).toBe(0);
  expect(parseZhongli([...sample, { AQI: '—' }], sourceHour)?.aqi).toBeNull();
  expect(parseZhongli([...sample, { AQI: 'warn' }], sourceHour)).toBeNull();
  expect(parseZhongli([...sample, { sitename: 'Fengshan' }], sourceHour)).toBeNull();
  expect(parseZhongli(sample, sourceHour + 3600e3)).toBeNull();
  expect(stationFeed(parseZhongli(sample, sourceHour), sourceHour - 1).meta.tier).toBe('unavailable');
  expect(stationFeed(parseZhongli(sample, sourceHour), sourceHour + 95 * 60e3).meta.tier).toBe('stale');
});

it('separates attempt, success and station times through errors and clears a missing published value', async () => {
  const { data, kv } = store();
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json(sample))
    .mockResolvedValueOnce(new Response('fixture-sensitive-token', { status: 429 }))
    .mockRejectedValueOnce(new Error('fixture-sensitive-token'))
    .mockResolvedValueOnce(Response.json([...sample, { date: '2026/11/25 23:00', AQI: '' }]));
  vi.stubGlobal('fetch', fetch);
  await updateStationAqi(kv, epoch);
  expect(fetch.mock.calls[0][0]).toContain('airlist_12_2026112521_en.json');
  await updateStationAqi(kv, epoch + 15 * 60e3);
  expect(fetch).toHaveBeenCalledTimes(1);
  const nextHour = epoch + 60 * 60e3;
  await updateStationAqi(kv, nextHour);
  expect(await readStationAqi(kv)).toMatchObject({
    observation: { aqi: 48 }, outcome: 'http', httpStatus: 429,
    lastSuccessAt: new Date(epoch).toISOString(), lastAttemptAt: new Date(nextHour).toISOString(),
  });
  await updateStationAqi(kv, nextHour + 5 * 60e3);
  expect(fetch).toHaveBeenCalledTimes(2);
  await updateStationAqi(kv, nextHour + 15 * 60e3);
  expect(data.get(STATION_AQI_KEY)).not.toContain('fixture-sensitive-token');
  await updateStationAqi(kv, nextHour + 30 * 60e3);
  expect((await readStationAqi(kv))?.observation).toEqual({ aqi: null, publishedAt: '2026-11-25T15:00:00.000Z' });
  await updateStationAqi(kv, epoch);
  expect(fetch).toHaveBeenCalledTimes(4);
});

it('keeps road readable when the station snapshot is corrupt', async () => {
  const { data, kv } = store();
  const at = new Date(Date.now() - 60_000).toISOString();
  data.set(STATION_AQI_KEY, '{invalid');
  data.set('road', JSON.stringify([{ at, id: 'fixture' }]));
  const env = { LIVE: kv } as Parameters<typeof worker.fetch>[1];
  const result = await worker.fetch(new Request('https://ncu.example/api/live'), env, ctx);
  await expect(result.json()).resolves.toMatchObject({
    road: { data: [{ at }], meta: { tier: 'live' } },
    stationAqi: { data: null, meta: { tier: 'unavailable' } },
  });
});
