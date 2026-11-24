// Sentinel-2 L2A → 20 m NDVI grid over the campus, this autumn vs last autumn.
// Cells a cloud/shadow mask (SCL) rejects in either scene are dropped, never filled.
// Run: node pipeline/ndvi.mjs  → public/data/ndvi.json
import { fromUrl } from 'geotiff';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { toUtm, fromUtm } from './utm.mjs';

const ZONE = 51, BASE = 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/51/R/UH';
// Chosen by scoring every 2025/2026 autumn scene for clear sky over campus (SCL) — see context.md
export const SCENES = [
  { id: 'S2A_51RUH_20261117_0_L2A', date: '2026-11-17' },
  { id: 'S2B_51RUH_20251115_0_L2A', date: '2025-11-15' },
];
const CHECK_SCENE = { id: 'S2C_51RUH_20261105_0_L2A', date: '2026-11-05' };
const THRESHOLD = 0.15;
const GREEN = 0.4; // NDVI ≥ 0.4 counted as vegetated (common threshold for moderate–dense vegetation)
const VALID_SCL = new Set([4, 5, 6]); // vegetation, other land, water; excludes unclassified pixels and clouds/shadow

const campusJson = JSON.parse(await readFile(new URL('../public/data/campus.json', import.meta.url), 'utf8'));
const rings = campusJson.campus.geometry.coordinates;
const inRing = (pt, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
  const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c; } return c; };
const inCampus = pt => rings.some(([outer, ...holes]) => inRing(pt, outer) && !holes.some(hole => inRing(pt, hole)));

// 20 m grid aligned to the Sentinel-2 20 m pixel grid (tile origin is a multiple of 20 m)
const [x0, y0] = toUtm(121.1840, 24.9645, ZONE), [x1, y1] = toUtm(121.1977, 24.9723, ZONE);
const gx0 = Math.floor(x0 / 20) * 20, gx1 = Math.ceil(x1 / 20) * 20, gy0 = Math.floor(y0 / 20) * 20, gy1 = Math.ceil(y1 / 20) * 20;

function sceneUrl({ id }) {
  return `${BASE}/${id.slice(10, 14)}/${Number(id.slice(14, 16))}/${id}`;
}

async function band(url, res, signal) {
  const img = await (await fromUrl(url, {}, signal)).getImage();
  const [ox, oy] = img.getOrigin();
  const [rx, ry] = img.getResolution();
  const win = [(gx0 - ox) / res, (oy - gy1) / res, (gx1 - ox) / res, (oy - gy0) / res];
  if (img.getGeoKeys().ProjectedCSTypeGeoKey !== 32651 || rx !== res || ry !== -res || !win.every(Number.isInteger) || win[0] < 0 || win[1] < 0
      || win[2] > img.getWidth() || win[3] > img.getHeight()) {
    throw new Error(`Misaligned Sentinel-2 grid: ${url}`);
  }
  const [data] = await img.readRasters({ window: win, signal });
  return { data, w: win[2] - win[0] };
}

async function scene(s) {
  const url = sceneUrl(s);
  const signal = AbortSignal.timeout(60000);
  const response = await fetch(`${url}/${s.id}.json`, { signal });
  if (!response.ok) throw new Error(`STAC HTTP ${response.status}: ${s.id}`);
  const item = await response.json();
  const assets = item.assets ?? {};
  const names = ['red', 'nir', 'scl'];
  if (item.id !== s.id || item.properties?.['earthsearch:boa_offset_applied'] !== true
      || item.properties?.datetime?.slice(0, 10) !== s.date
      || names.some((name, i) => assets[name]?.href !== `${url}/${['B04', 'B08', 'SCL'][i]}.tif`)) {
    throw new Error(`Unverified harmonized COG metadata: ${s.id}`);
  }
  const [red, nir, scl] = await Promise.all(names.map((name, i) => band(assets[name].href, i === 2 ? 20 : 10, signal)));
  const W = scl.w, H = (gy1 - gy0) / 20;
  if (scl.data.length !== W * H || red.w !== 2 * W || nir.w !== 2 * W
      || red.data.length !== 4 * W * H || nir.data.length !== 4 * W * H) {
    throw new Error(`Unexpected Sentinel-2 crop dimensions: ${s.id}`);
  }
  const out = new Float32Array(W * H).fill(NaN);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (!VALID_SCL.has(scl.data[j * W + i])) continue;
    let rs = 0, ns = 0, valid = true;
    for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const k = (2 * j + dj) * red.w + 2 * i + di;
      if (red.data[k] === 0 || nir.data[k] === 0) { valid = false; break; }
      rs += red.data[k]; ns += nir.data[k];
    }
    if (valid && rs + ns > 0) out[j * W + i] = (ns - rs) / (ns + rs);
  }
  return { W, H, ndvi: out };
}

const [now, prev, check] = await Promise.all([...SCENES, CHECK_SCENE].map(scene));
const r3 = v => Math.round(v * 1000) / 1000;
const features = [];
const repeat = { comparable: 0, higher: 0, lower: 0, other: 0 };
const latest = { comparable: 0, higher: 0, lower: 0, other: 0 };
let n = 0, gNow = 0, gPrev = 0, maskedNow = 0, maskedPrev = 0, inside = 0;
for (let j = 0; j < now.H; j++) for (let i = 0; i < now.W; i++) {
  const cx = gx0 + i * 20, cy = gy1 - j * 20; // top-left corner
  const c = fromUtm(cx + 10, cy - 10, ZONE);
  if (!inCampus(c)) continue;
  inside++;
  const a = now.ndvi[j * now.W + i], b = prev.ndvi[j * now.W + i];
  if (Number.isNaN(a)) maskedNow++;
  if (Number.isNaN(b)) maskedPrev++;
  if (Number.isNaN(a) || Number.isNaN(b)) continue; // only cells clear in BOTH scenes are compared
  n++; if (a >= GREEN) gNow++; if (b >= GREEN) gPrev++;
  const ring = [[cx, cy], [cx + 20, cy], [cx + 20, cy - 20], [cx, cy - 20], [cx, cy]].map(([x, y]) => fromUtm(x, y, ZONE).map(v => +v.toFixed(6)));
  const d = r3(a - b);
  const r = Number.isFinite(check.ndvi[j * now.W + i]) ? r3(check.ndvi[j * now.W + i] - b) : null;
  const shift = d >= THRESHOLD ? 'higher' : d <= -THRESHOLD ? 'lower' : 'other';
  const repeated = r === null ? null
    : shift === 'higher' && r >= THRESHOLD ? 'higher'
    : shift === 'lower' && r <= -THRESHOLD ? 'lower'
    : 'other';
  latest.comparable++;
  latest[shift]++;
  if (repeated !== null) {
    repeat.comparable++;
    repeat[repeated]++;
  }
  features.push({ type: 'Feature', properties: { v: r3(a), p: r3(b), d, r, shift, repeated }, geometry: { type: 'Polygon', coordinates: [ring] } });
}

if (!inside || n / inside < 0.9 || repeat.comparable / inside < 0.9) {
  throw new Error(`Insufficient campus coverage: latest ${n}/${inside}, repeat ${repeat.comparable}/${inside}`);
}
const pct = x => Math.round(x / n * 1000) / 10;
const publishedScene = s => ({ ...s, sourceUrl: `${sceneUrl(s)}/${s.id}.json` });
const result = {
  meta: { source: 'Sentinel-2 L2A (ESA)', tier: 'observed', asOf: SCENES[0].date,
    scenes: SCENES.map(publishedScene), repeatScene: publishedScene(CHECK_SCENE), resolutionM: 20, threshold: THRESHOLD,
    method: `NDVI=(B08−B04)/(B08+B04) at 20 m; SCL classes 4–6; vegetation threshold NDVI ≥ ${GREEN}. Repeat differences use the same 2025 reference.`,
    caveat: 'Season, management, weather or construction may affect the signal. Check the site before attributing a cause.' },
  latest, repeat,
  cells_in_campus: inside, cells_compared: n, masked_now: maskedNow, masked_prev: maskedPrev,
  green_share_now: pct(gNow), green_share_prev: pct(gPrev), area_m2_compared: n * 400,
  grid: { type: 'FeatureCollection', features },
};
const output = new URL('../public/data/ndvi.json', import.meta.url);
const temp = new URL(`../public/data/.ndvi-${process.pid}.tmp`, import.meta.url);
await writeFile(temp, JSON.stringify(result));
await rename(temp, output);
console.log({ inside, n, maskedNow, maskedPrev, latest, repeat, now: result.green_share_now, prev: result.green_share_prev });
