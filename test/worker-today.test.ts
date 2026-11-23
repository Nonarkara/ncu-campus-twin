import { afterEach, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import type { Today } from '../src/shared/today';

afterEach(() => vi.unstubAllGlobals());

it('serves schedules when upstream weather and air responses are malformed', async () => {
  vi.stubGlobal('caches', { default: { match: vi.fn(), put: vi.fn() } });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('https://api.open-meteo.com/')) {
      return Response.json({ hourly: { time: [] } });
    }
    if (url.startsWith('https://air-quality-api.open-meteo.com/')) {
      return Response.json({ current: { time: '2026-11-23T12:00', pm2_5: null } });
    }
    return new Response(null, { status: 503 });
  }));

  const env = {} as Parameters<typeof worker.fetch>[1];
  const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
  const response = await worker.fetch(new Request('https://ncu.example/api/today'), env, ctx);
  const today = await response.json() as Today;

  expect(response.status).toBe(200);
  expect(today.forecastMeta).toMatchObject({ tier: 'unavailable', asOf: null });
  expect(today.hourly).toEqual([]);
  expect(today.steady.map(row => row.id)).toEqual(['taipei', 'hsr', 'inbound']);
});
