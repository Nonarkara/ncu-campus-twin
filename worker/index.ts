// Edge: static assets + /api/today. Fetches open feeds, wraps each in {source, tier, asOf}, runs the Today engine.
import { buildToday, type Feed, type Forecast, type Air } from '../src/shared/today';

interface Env { ASSETS: Fetcher }
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
    return { data: { pm25: j.current.pm2_5, n: 0, observedAt: j.current.time }, meta: { source, tier: 'modeled', asOf: j.current.time } };
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
    "connect-src 'self' https://wmts.nlsc.gov.tw", "worker-src 'self' blob:", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'",
  ].join('; '),
};
function secure(res: Response) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY)) r.headers.set(k, v);
  return r;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    if (url.protocol === 'http:' && url.hostname !== 'localhost') { url.protocol = 'https:'; return Response.redirect(url.toString(), 301); }
    if (url.pathname !== '/api/today') return secure(await env.ASSETS.fetch(req));
    return secure(await today(req, url, ctx));
  },
};

async function today(req: Request, url: URL, ctx: ExecutionContext): Promise<Response> {
  {
    const cache = (caches as unknown as { default: Cache }).default;
    const key = new Request(url.origin + '/api/today?v=3'); // bump when the payload shape changes
    const hit = await cache.match(key);
    if (hit) return hit;
    const [fc, aq] = await Promise.all([forecast(), air()]);
    const body = JSON.stringify(buildToday(new Date(), fc, aq));
    const res = new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' } });
    ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  }
}
