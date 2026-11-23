#!/usr/bin/env node
// Relay Freeway Bureau VDLive.xml (Zhongli IC detectors) into Cloudflare KV `LIVE` key `road`.
// Cloudflare's edge gets HTTP 522 from tisvcloud.freeway.gov.tw; this runs cleanly from a local host every 5 min.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KV_ID = '2ce57fb11c484cc0b302fc6e36b1ba22';
const URL = 'https://tisvcloud.freeway.gov.tw/history/motc20/VDLive.xml';

const VDS = [
  { id: 'VD-N1-S-61.800-M-LOOP', label: ['N1 southbound, Zhongli IC', '國1南向・中壢交流道'], dir: 'S', kind: 'main', lon: 121.2038621, lat: 24.961097 },
  { id: 'VD-N1-N-61.580-M-LOOP', label: ['N1 northbound, Zhongli IC', '國1北向・中壢交流道'], dir: 'N', kind: 'main', lon: 121.2056189, lat: 24.9621239 },
  { id: 'VD-N1-S-62-O-NW-1-中壢', label: ['Zhongli exit, from north', '南向中壢出口匝道'], dir: 'S', kind: 'exit', lon: 121.2007372, lat: 24.9586613 },
  { id: 'VD-N1-N-62-O-SE-1-中壢', label: ['Zhongli exit, from south', '北向中壢出口匝道'], dir: 'N', kind: 'exit', lon: 121.199427, lat: 24.9561729 },
];

const tag = (b, t) => [...b.matchAll(new RegExp(`<${t}>([^<]*)</${t}>`, 'g'))].map(m => m[1]);

function parseVDLive(xml) {
  return VDS.flatMap(v => {
    const i = xml.indexOf(`<VDID>${v.id}</VDID>`);
    if (i < 0) return [];
    const b = xml.slice(i, xml.indexOf('</VDLive>', i));
    if (tag(b, 'Status')[0] !== '0') return [];
    const lanes = [...b.matchAll(/<Lane>([\s\S]*?)<\/Lane>/g)].map(m => m[1]);
    let vol = 0, sv = 0;
    for (const l of lanes) {
      const speed = +tag(l, 'Speed')[0];
      const n = tag(l, 'Volume').reduce((s, x) => s + (+x > 0 ? +x : 0), 0);
      if (speed > 0 && n > 0) { vol += n; sv += speed * n; }
    }
    const at = tag(b, 'DataCollectTime')[0];
    return [{ ...v, speed: vol ? Math.round(sv / vol) : null, vph: vol * 60, at }];
  });
}

async function fetchWithRetry(url, attempts = 2) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { 'user-agent': 'ncu-campus-twin/0.3-relay' } });
      if (!r.ok) throw new Error(`VDLive HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      lastErr = e;
      if (i + 1 < attempts) await new Promise(res => setTimeout(res, 5000));
    }
  }
  throw lastErr;
}

try {
  const xml = await fetchWithRetry(URL);
  const data = parseVDLive(xml);
  if (!data.length) throw new Error('Parsed 0 Zhongli VD detectors');

  const wrangler = join(ROOT, 'node_modules/.bin/wrangler');
  execFileSync(wrangler, ['kv', 'key', 'put', 'road', JSON.stringify(data), '--namespace-id', KV_ID, '--remote'], { cwd: ROOT, stdio: 'pipe' });
  console.log(new Date().toISOString(), 'pushed', data.length, 'detectors:', data.map(d => `${d.dir}:${d.kind}=${d.speed ?? '—'}km/h/${d.vph}vph`).join(', '));
} catch (e) {
  console.error(new Date().toISOString(), 'road-relay error:', e?.cause?.code || e?.message || String(e));
  process.exit(1);
}
