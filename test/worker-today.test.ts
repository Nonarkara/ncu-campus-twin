import { afterEach, expect, it, vi } from 'vitest';
import pkg from '../package.json';
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
  expect(body.version).toBe(pkg.version);
  expect(typeof body.build).toBe('string');
  expect(body.build.length).toBeGreaterThan(0);
  expect(body.edgeCronNote).toContain('tisvcloud');
  expect(body.loops.road).toMatchObject({ tier: 'live', detectors: 1 });
  expect(body.loops.news).toMatchObject({ tier: 'live', articles: 2 });
  expect(res.headers.get('cache-control')).toBe('no-store');
});

it('returns explicit 404 for unknown API and non-asset paths while serving /', async () => {
  const env = {
    ASSETS: {
      fetch: vi.fn(async (req: Request) => {
        const path = new URL(req.url).pathname;
        if (path === '/') return new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } });
        return new Response('missing', { status: 404 });
      }),
    },
  } as unknown as Parameters<typeof worker.fetch>[1];
  const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;

  const rootRes = await worker.fetch(new Request('https://ncu.example/'), env, ctx);
  expect(rootRes.status).toBe(200);
  expect(rootRes.headers.get('x-content-type-options')).toBe('nosniff');

  const nopeRes = await worker.fetch(new Request('https://ncu.example/nope'), env, ctx);
  expect(nopeRes.status).toBe(404);
  expect(await nopeRes.text()).toBe('Not found');
  expect(nopeRes.headers.get('cache-control')).toBe('no-store');
  expect(nopeRes.headers.get('x-frame-options')).toBe('DENY');

  const apiNopeRes = await worker.fetch(new Request('https://ncu.example/api/nope'), env, ctx);
  expect(apiNopeRes.status).toBe(404);
  expect(await apiNopeRes.json()).toEqual({ error: 'Not found' });
  expect(apiNopeRes.headers.get('cache-control')).toBe('no-store');
});
