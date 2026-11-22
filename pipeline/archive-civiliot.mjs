// Raw archive of Civil IoT Taiwan SensorThings observations near NCU.
// The service ends 2026-12-01; this keeps an append-only raw record (raw, never cooked here).
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'var', 'civiliot');
const CENTER = 'POINT(121.192 24.968)';
const RADIUS_DEG = 0.06; // ~6 km — campus has no sensor inside its footprint
const SERVICES = ['STA_AirQuality_EPAIoT', 'STA_RainSewer', 'STA_WaterResource_v2'];

async function fetchAll(service) {
  const filter = `geo.distance(Locations/location,geography'${CENTER}') lt ${RADIUS_DEG}`;
  let url = `https://sta.colife.org.tw/${service}/v1.0/Things?$filter=${encodeURIComponent(filter)}` +
    `&$expand=${encodeURIComponent('Locations,Datastreams($expand=Observations($top=1;$orderby=phenomenonTime desc))')}&$top=200`;
  const things = [];
  while (url && things.length < 2000) {
    const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`${service} HTTP ${r.status}`);
    const j = await r.json();
    things.push(...(j.value ?? []));
    url = j['@iot.nextLink'];
  }
  return things;
}

await mkdir(OUT, { recursive: true });
const fetchedAt = new Date().toISOString();
const day = fetchedAt.slice(0, 10);
for (const s of SERVICES) {
  try {
    const things = await fetchAll(s);
    const rows = things.flatMap(t => (t.Datastreams ?? []).flatMap(ds => (ds.Observations ?? []).map(o => ({
      fetchedAt, service: s, thing: t.name, thingId: t['@iot.id'],
      lon: t.Locations?.[0]?.location?.coordinates?.[0], lat: t.Locations?.[0]?.location?.coordinates?.[1],
      stream: ds.name, unit: ds.unitOfMeasurement?.symbol, t: o.phenomenonTime, v: o.result,
    }))));
    await appendFile(join(OUT, `${s}_${day}.jsonl`), rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
    console.log(fetchedAt, s, things.length, 'things', rows.length, 'obs');
  } catch (e) {
    console.error(fetchedAt, s, 'FAILED', e.message);
  }
}
