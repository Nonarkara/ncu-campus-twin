// Edge: static assets + /api/today. Fetches open feeds, wraps each in {source, tier, asOf}, runs the Today engine.
import { buildToday, type Feed, type Forecast, type Air } from '../src/shared/today';
import { parseVDLive, type Live } from '../src/shared/live';
import {
  NEWS_FEEDS,
  mergeNewsCorpus,
  parseGoogleNewsRss,
  summarizeNews,
  toCsv,
  toJsonl,
  type NewsItem,
  type NewsPayload,
} from '../src/shared/news';

interface Env { ASSETS: Fetcher; LIVE: KVNamespace; DEV?: string; BUILD?: string }
const LAT = 24.9684, LON = 121.1916; // OSM relation/18727079 centre

async function getJson(url: string, ms = 12000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'user-agent': 'ncu-campus-twin/0.1' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json() as Promise<any>;
}

async function forecast(now: Date): Promise<Feed<Forecast>> {
  const source = 'Open-Meteo forecast';
  try {
    const j = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&timezone=Asia%2FTaipei&forecast_days=2` +
      '&hourly=precipitation,precipitation_probability,temperature_2m,wind_gusts_10m,uv_index,shortwave_radiation&wind_speed_unit=ms');
    const h = j.hourly;
    if (![h.time, h.precipitation, h.precipitation_probability, h.temperature_2m, h.wind_gusts_10m, h.uv_index].every(Array.isArray)) {
      throw new Error('Incomplete hourly forecast');
    }
    // asOf = the forecast hour the 'now' values come from (Asia/Taipei slot), not the request time
    const slot = new Date(now.getTime() + 8 * 3600e3).toISOString().slice(0, 13) + ':00';
    const asOf = (h.time as string[]).includes(slot) ? `${slot}:00+08:00` : null;
    return { meta: { source, tier: 'forecast', asOf },
      data: { time: h.time, precip: h.precipitation, prob: h.precipitation_probability, temp: h.temperature_2m, gust: h.wind_gusts_10m, uv: h.uv_index, ghi: h.shortwave_radiation } };
  } catch { return { data: null, meta: { source, tier: 'unavailable', asOf: null } }; }
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Civil IoT micro-sensors within ~3 km (service ends 2026-12-01), else CAMS model. Never zero-fills. */
async function air(): Promise<Feed<Air>> {
  try {
    const f = encodeURIComponent(`geo.distance(Locations/location,geography'POINT(${LON} ${LAT})') lt 0.03`);
    const e = encodeURIComponent("Datastreams($filter=name eq 'PM2.5';$expand=Observations($top=1;$orderby=phenomenonTime desc))");
    const j = await getJson(`https://sta.colife.org.tw/STA_AirQuality_EPAIoT/v1.0/Things?$filter=${f}&$expand=${e}&$top=100`, 1800);
    const cutoff = Date.now() - 2 * 3600e3;
    const obs = (j.value as any[]).flatMap(t => t.Datastreams ?? []).flatMap((d: any) => d.Observations ?? [])
      .filter((o: any) => typeof o.result === 'number' && o.result > 0 && Date.parse(o.phenomenonTime) > cutoff);
    if (obs.length >= 3) {
      const latest = obs.map((o: any) => o.phenomenonTime).sort().at(-1);
      return { data: { pm25: median(obs.map((o: any) => o.result)), n: obs.length, observedAt: latest },
        meta: { source: 'Civil IoT micro-sensors ≤3 km', tier: 'live', asOf: latest } };
    }
  } catch { /* fall through to model */ }
  const source = 'Open-Meteo CAMS model';
  try {
    const j = await getJson(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${LAT}&longitude=${LON}&current=pm2_5&timezone=Asia%2FTaipei`);
    const t = `${j.current.time}:00+08:00`; // Open-Meteo returns local time (timezone=Asia/Taipei) without an offset
    return { data: { pm25: j.current.pm2_5, n: 0, observedAt: t }, meta: { source, tier: 'modeled', asOf: t } };
  } catch { return { data: null, meta: { source, tier: 'unavailable', asOf: null } }; }
}

const SECURITY: Record<string, string> = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com", "img-src 'self' data: blob: https://wmts.nlsc.gov.tw",
    "connect-src 'self' https://wmts.nlsc.gov.tw https://apis.youbike.com.tw https://tiles.openfreemap.org", "worker-src 'self' blob:", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'",
  ].join('; '),
};
function secure(res: Response) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY)) r.headers.set(k, v);
  return r;
}

export default {
  async scheduled(_e: ScheduledController, env: Env, ctx: ExecutionContext) {
    // Record why a pull failed so /api/live can say so; the last good reading stays in place.
    ctx.waitUntil(pullRoad(env).catch(e => env.LIVE.put('road_err', `${new Date().toISOString()} ${String((e as Error)?.message ?? e).slice(0, 160)}`)));
    // Refresh NCU & Taoyuan news corpus every 15 min (on 00, 15, 30, 45)
    if (new Date().getMinutes() % 15 < 5) {
      ctx.waitUntil(pullNews(env).catch(() => {}));
    }
  },
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol === 'http:' && !local && !env.DEV) {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === '/api/health') return secure(await health(env));
    if (url.pathname === '/api/live') return secure(await live(env));
    if (url.pathname === '/api/news') return secure(await news(env, url, ctx));
    if (url.pathname !== '/api/today') return secure(await env.ASSETS.fetch(req));
    return secure(await today(url, ctx));
  },
};

const NEWS_SRC = 'Google News RSS (NCU + Taoyuan)';
const NEWS_REFRESH_MS = 15 * 60e3;
const NEWS_STALE_MS = 60 * 60e3;
const ROAD_STALE_MS = 30 * 60e3;

function decodeKV(raw: string | null): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function elapsed(at: string | null, now = Date.now()): number {
  const age = at ? now - Date.parse(at) : NaN;
  return Number.isFinite(age) && age >= 0 ? age : Infinity;
}

function roadSnapshot(raw: string | null, now = Date.now()): Live['road']['data'] {
  const rows = decodeKV(raw);
  return Array.isArray(rows) ? rows.filter(r => r && typeof r.at === 'string' && Number.isFinite(elapsed(r.at, now))) : [];
}

interface NewsStore { updatedAt: string | null; items: NewsItem[] }

function newsSnapshot(raw: string | null): NewsStore | null {
  const value = decodeKV(raw) as NewsStore | null;
  return value && Array.isArray(value.items) && (value.updatedAt === null || typeof value.updatedAt === 'string') ? value : null;
}

function newsTier(store: NewsStore | null, now = Date.now()) {
  if (!store?.items.length) return 'unavailable';
  return elapsed(store.updatedAt, now) < NEWS_STALE_MS ? 'live' : 'stale';
}

async function pullNews(env: Env): Promise<NewsStore> {
  const nowIso = new Date().toISOString();
  await env.LIVE.put('news_attempt', nowIso);
  const fetched = await Promise.allSettled(
    NEWS_FEEDS.map(async f => {
      const r = await fetch(f.url, { signal: AbortSignal.timeout(12000), headers: { 'user-agent': 'ncu-campus-twin/0.6' } });
      if (!r.ok) throw new Error(`${r.status}`);
      return parseGoogleNewsRss(await r.text(), f.defaultScope, f.lang, nowIso, 25);
    }),
  );
  const incoming = fetched.flatMap(res => (res.status === 'fulfilled' ? res.value : []));
  const previous = newsSnapshot(await env.LIVE.get('news_db'));
  if (!incoming.length) return previous ?? { updatedAt: null, items: [] };
  const store: NewsStore = { updatedAt: new Date().toISOString(), items: mergeNewsCorpus(previous?.items ?? [], incoming, 300) };
  await env.LIVE.put('news_db', JSON.stringify(store));
  return store;
}

async function news(env: Env, url: URL, ctx: ExecutionContext): Promise<Response> {
  const [raw, attempt] = await Promise.all([
    env.LIVE.get('news_db', { cacheTtl: 120 }),
    env.LIVE.get('news_attempt', { cacheTtl: 60 }),
  ]);
  let store = newsSnapshot(raw);
  if (elapsed(attempt ?? store?.updatedAt ?? null) > NEWS_REFRESH_MS) {
    if (store) ctx.waitUntil(pullNews(env).catch(() => {}));
    else store = await pullNews(env).catch(() => null);
  }
  store ??= { updatedAt: null, items: [] };

  const fmt = url.searchParams.get('format');
  if (fmt === 'jsonl') {
    return new Response(toJsonl(store.items), {
      headers: {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'content-disposition': 'attachment; filename="ncu-taoyuan-news.jsonl"',
        'cache-control': 'public, max-age=120',
      },
    });
  }
  if (fmt === 'csv') {
    return new Response(toCsv(store.items), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="ncu-taoyuan-news.csv"',
        'cache-control': 'public, max-age=120',
      },
    });
  }

  const payload: NewsPayload = {
    meta: { source: NEWS_SRC, tier: newsTier(store), asOf: store.updatedAt },
    items: store.items,
    stats: summarizeNews(store.items),
  };
  return new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=120' },
  });
}

const ROAD_SRC = 'Freeway Bureau VD (MOTC)';

/** Cron, every 5 min: fetch the ~5 MB detector file once, keep the last good reading in KV (global).
 *  Some edge locations cannot reach the source, so requests never fetch it themselves. */
async function pullRoad(env: Env) {
  const r = await fetch('https://tisvcloud.freeway.gov.tw/history/motc20/VDLive.xml', { signal: AbortSignal.timeout(25000), headers: { 'user-agent': 'ncu-campus-twin/0.3' } });
  if (!r.ok) throw new Error(String(r.status));
  const data = parseVDLive(await r.text());
  if (data.length) await env.LIVE.put('road', JSON.stringify(data));
}

/** Operational loop health check: reports live freshness & counts for KV-backed loops without leaking secrets. */
async function health(env: Env): Promise<Response> {
  const nowMs = Date.now();
  const [roadRaw, roadErr, newsRaw, newsAttempt] = await Promise.all([
    env.LIVE.get('road', { cacheTtl: 30 }),
    env.LIVE.get('road_err', { cacheTtl: 30 }),
    env.LIVE.get('news_db', { cacheTtl: 30 }),
    env.LIVE.get('news_attempt', { cacheTtl: 30 }),
  ]);
  const roadAll = roadSnapshot(roadRaw, nowMs);
  const roadAsOf = roadAll.map(f => f.at).sort().at(-1) ?? null;
  const roadAgeMin = roadAsOf ? Math.round((nowMs - Date.parse(roadAsOf)) / 60000) : null;
  const roadFresh = elapsed(roadAsOf, nowMs) < ROAD_STALE_MS;

  const newsStore = newsSnapshot(newsRaw);
  const newsAsOf = newsStore?.updatedAt ?? null;
  const newsAge = elapsed(newsAsOf, nowMs);
  const newsAgeMin = Number.isFinite(newsAge) ? Math.round(newsAge / 60000) : null;
  const newsState = newsTier(newsStore, nowMs);
  const newsFresh = newsState === 'live';

  const status = roadFresh && newsFresh ? 'ok' : 'degraded';
  return new Response(
    JSON.stringify({
      status,
      checkedAt: new Date(nowMs).toISOString(),
      build: env.BUILD ?? null,
      loops: {
        road: { tier: roadFresh ? 'live' : 'stale', asOf: roadAsOf, ageMin: roadAgeMin, detectors: roadAll.length },
        news: { tier: newsState, asOf: newsAsOf, lastAttemptAt: Number.isFinite(elapsed(newsAttempt, nowMs)) ? newsAttempt : null, ageMin: newsAgeMin, articles: newsStore?.items?.length ?? 0 },
      },
      edgeCronNote: roadErr ? 'Edge cron cannot reach tisvcloud (expected 522); Mac relay owns KV updates.' : null,
    }),
    { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } },
  );
}

/** Last good detector reading. Its own collection time travels with it, so the page shows its real age. */
async function live(env: Env): Promise<Response> {
  const now = Date.now();
  const all = roadSnapshot(await env.LIVE.get('road', { cacheTtl: 60 }), now);
  // After expiry, suppress stale speeds and retain the time of the last observation.
  const data = all.filter(f => elapsed(f.at, now) < ROAD_STALE_MS);
  const body: Pick<Live, 'road'> = {
    road: { data, meta: { source: ROAD_SRC, tier: data.length ? 'live' : all.length ? 'stale' : 'unavailable', asOf: (data.length ? data : all).map(f => f.at).sort().at(-1) ?? null } },
  };
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' } });
}

async function today(url: URL, ctx: ExecutionContext): Promise<Response> {
  {
    const cache = (caches as unknown as { default: Cache }).default;
    // 5-minute bucket in the key: a cached payload can never outlive its slot, whatever the cache does with max-age.
    // (Seen 2026-11-22: an edge served a 3.5 h old payload.) Bump v when the payload shape changes.
    const now = new Date();
    const key = new Request(`${url.origin}/api/today?v=6&t=${Math.floor(now.getTime() / 300000)}`);
    const hit = await cache.match(key);
    if (hit) return hit;
    const [fc, aq] = await Promise.all([forecast(now), air()]);
    const body = JSON.stringify(buildToday(now, fc, aq));
    const res = new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' } });
    ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  }
}
