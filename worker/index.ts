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

interface Env { ASSETS: Fetcher; LIVE: KVNamespace; DEV?: string }
const LAT = 24.9684, LON = 121.1916; // OSM relation/18727079 centre

async function getJson(url: string, ms = 12000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'user-agent': 'ncu-campus-twin/0.1' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json() as Promise<any>;
}

async function forecast(): Promise<Feed<Forecast>> {
  const source = 'Open-Meteo forecast';
  try {
    const j = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&timezone=Asia%2FTaipei&forecast_days=2` +
      '&hourly=precipitation,precipitation_probability,temperature_2m,wind_gusts_10m,uv_index,shortwave_radiation&wind_speed_unit=ms');
    const h = j.hourly;
    return { meta: { source, tier: 'forecast', asOf: new Date().toISOString() },
      data: { time: h.time, precip: h.precipitation, prob: h.precipitation_probability, temp: h.temperature_2m, gust: h.wind_gusts_10m, uv: h.uv_index, ghi: h.shortwave_radiation } };
  } catch { return { data: null, meta: { source, tier: 'unavailable', asOf: null } }; }
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Civil IoT micro-sensors within ~3 km (service ends 2026-12-01), else CAMS model. Never zero-fills. */
async function air(): Promise<Feed<Air>> {
  try {
    const f = encodeURIComponent(`geo.distance(Locations/location,geography'POINT(${LON} ${LAT})') lt 0.03`);
    const e = encodeURIComponent("Datastreams($filter=name eq 'PM2.5';$expand=Observations($top=1;$orderby=phenomenonTime desc))");
    const j = await getJson(`https://sta.colife.org.tw/STA_AirQuality_EPAIoT/v1.0/Things?$filter=${f}&$expand=${e}&$top=100`);
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
    "connect-src 'self' https://wmts.nlsc.gov.tw https://apis.youbike.com.tw", "worker-src 'self' blob:", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'",
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
    if (url.protocol === 'http:' && url.hostname !== 'localhost' && !env.DEV) { url.protocol = 'https:'; return Response.redirect(url.toString(), 301); }
    if (url.pathname === '/api/live') return secure(await live(env));
    if (url.pathname === '/api/news') return secure(await news(env, url, ctx));
    if (url.pathname !== '/api/today') return secure(await env.ASSETS.fetch(req));
    return secure(await today(req, url, ctx));
  },
};

const NEWS_SRC = 'Google News RSS (NCU + Taoyuan)';

interface NewsStore { updatedAt: string; items: NewsItem[] }

async function pullNews(env: Env): Promise<NewsStore> {
  const nowIso = new Date().toISOString();
  const prevRaw = await env.LIVE.get('news_db');
  const prev: NewsItem[] = prevRaw ? (JSON.parse(prevRaw) as NewsStore).items ?? [] : [];
  const fetched = await Promise.allSettled(
    NEWS_FEEDS.map(async f => {
      const r = await fetch(f.url, { signal: AbortSignal.timeout(12000), headers: { 'user-agent': 'ncu-campus-twin/0.6' } });
      if (!r.ok) throw new Error(`${r.status}`);
      return parseGoogleNewsRss(await r.text(), f.defaultScope, f.lang, nowIso, 25);
    }),
  );
  const incoming = fetched.flatMap(res => (res.status === 'fulfilled' ? res.value : []));
  const merged = mergeNewsCorpus(prev, incoming, 300);
  const store: NewsStore = { updatedAt: nowIso, items: merged };
  if (merged.length) await env.LIVE.put('news_db', JSON.stringify(store));
  return store;
}

async function news(env: Env, url: URL, ctx: ExecutionContext): Promise<Response> {
  const raw = await env.LIVE.get('news_db', { cacheTtl: 120 });
  let store: NewsStore | null = raw ? (JSON.parse(raw) as NewsStore) : null;
  const stale = !store || !store.items.length || Date.now() - Date.parse(store.updatedAt) > 15 * 60e3;
  if (!store || !store.items.length) {
    try { store = await pullNews(env); } catch { store = { updatedAt: new Date().toISOString(), items: [] }; }
  } else if (stale) {
    ctx.waitUntil(pullNews(env).catch(() => {}));
  }

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
    meta: { source: NEWS_SRC, tier: store.items.length ? 'live' : 'unavailable', asOf: store.items.length ? store.updatedAt : null },
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

/** Last good detector reading. Its own collection time travels with it, so the page shows its real age. */
async function live(env: Env): Promise<Response> {
  const all: Live['road']['data'] = JSON.parse((await env.LIVE.get('road', { cacheTtl: 60 })) ?? '[]');
  // Older than 30 min is not "live": drop it rather than show a stale speed as current.
  const data = all.filter(f => Date.now() - Date.parse(f.at) < 30 * 60e3);
  const lastError = await env.LIVE.get('road_err', { cacheTtl: 60 });
  const body: Pick<Live, 'road'> & { lastError?: string } = {
    lastError: lastError ?? undefined,
    road: { data, meta: { source: ROAD_SRC, tier: data.length ? 'live' : 'unavailable', asOf: data.map(f => f.at).sort().at(-1) ?? null } },
  };
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' } });
}

async function today(req: Request, url: URL, ctx: ExecutionContext): Promise<Response> {
  {
    const cache = (caches as unknown as { default: Cache }).default;
    // 5-minute bucket in the key: a cached payload can never outlive its slot, whatever the cache does with max-age.
    // (Seen 2026-11-22: an edge served a 3.5 h old payload.) Bump v when the payload shape changes.
    const key = new Request(`${url.origin}/api/today?v=4&t=${Math.floor(Date.now() / 300000)}`);
    const hit = await cache.match(key);
    if (hit) return hit;
    const [fc, aq] = await Promise.all([forecast(), air()]);
    const body = JSON.stringify(buildToday(new Date(), fc, aq));
    const res = new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' } });
    ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  }
}
