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

it('reports live vs degraded operational loops on /api/health', async () => {
  const freshIso = new Date().toISOString();
  const kvStore: Record<string, string | null> = {
    road: JSON.stringify([{ id: 'VD-1', at: freshIso, speed: 92, vph: 2000 }]),
    road_err: '2026-11-23T00:00:00.000Z 522',
    news_db: JSON.stringify({ updatedAt: freshIso, items: [{ id: 'a' }, { id: 'b' }] }),
  };
  const env = {
    LIVE: { get: vi.fn(async (k: string) => kvStore[k] ?? null) },
  } as unknown as Parameters<typeof worker.fetch>[1];
  const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
  const res = await worker.fetch(new Request('https://ncu.example/api/health'), env, ctx);
  const body = await res.json() as any;

  expect(res.status).toBe(200);
  expect(body.status).toBe('ok');
  expect(body.loops.road).toMatchObject({ tier: 'live', detectors: 1 });
  expect(body.loops.news).toMatchObject({ tier: 'live', articles: 2 });
  expect(res.headers.get('cache-control')).toBe('no-store');
});

it('keeps the last successful news snapshot through an upstream outage', async () => {
  const success = new Date(Date.now() - 120 * 60e3).toISOString();
  const article = {
    id: 'ncu-library', title: 'Library hours', url: 'https://www.ncu.edu.tw/',
    source: 'NCU', publishedAt: success, firstSeenAt: success,
    scope: 'ncu', topic: 'campus', lang: 'en',
  };
  const values: Record<string, string> = {
    news_db: JSON.stringify({ updatedAt: success, items: [article] }),
  };
  const env = {
    BUILD: 'fixture-build',
    LIVE: {
      get: vi.fn(async (key: string) => values[key] ?? null),
      put: vi.fn(async (key: string, value: string) => { values[key] = value; }),
    },
  } as unknown as Parameters<typeof worker.fetch>[1];
  const wait = vi.fn();
  const ctx = { waitUntil: wait } as unknown as ExecutionContext;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));

  const news = await worker.fetch(new Request('https://ncu.example/api/news'), env, ctx);
  await Promise.all(wait.mock.calls.map(([promise]) => promise));
  expect(JSON.parse(values.news_db)).toMatchObject({ updatedAt: success, items: [article] });
  expect(values.news_attempt).toEqual(expect.any(String));
  expect(env.LIVE.put).not.toHaveBeenCalledWith('news_db', expect.anything());
  await expect(news.json()).resolves.toMatchObject({ meta: { tier: 'stale', asOf: success }, items: [article] });
  const health = await worker.fetch(new Request('https://ncu.example/api/health'), env, ctx);
  await expect(health.json()).resolves.toMatchObject({
    status: 'degraded', build: 'fixture-build', loops: { news: { tier: 'stale', asOf: success } },
  });
});

it('keeps corrupt KV and future detector timestamps out of live readings', async () => {
  const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
  const previous = new Date(Date.now() - 60 * 60e3).toISOString();
  const future = new Date(Date.now() + 60 * 60e3).toISOString();
  const results = [
    ['{bad snapshot', 'unavailable', null],
    [JSON.stringify([{ id: 'bad', at: future }, { id: 'previous', at: previous }]), 'stale', previous],
  ] as const;
  for (const [road, tier, asOf] of results) {
    const env = { LIVE: { get: vi.fn(async (key: string) => key === 'road' ? road : '{broken') } } as unknown as Parameters<typeof worker.fetch>[1];
    const live = await worker.fetch(new Request('https://ncu.example/api/live'), env, ctx);
    await expect(live.json()).resolves.toMatchObject({ road: { data: [], meta: { tier, asOf } } });
    const health = await worker.fetch(new Request('https://ncu.example/api/health'), env, ctx);
    await expect(health.json()).resolves.toMatchObject({
      status: 'degraded', loops: { road: { asOf }, news: { tier: 'unavailable', asOf: null } },
    });
  }
});
