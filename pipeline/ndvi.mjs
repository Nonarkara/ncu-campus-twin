// Sentinel-2 L2A → 20 m NDVI grid over the campus, this autumn vs last autumn.
// Cells a cloud/shadow mask (SCL) rejects in either scene are dropped, never filled.
// Run: node pipeline/ndvi.mjs  → public/data/ndvi.json
import { fromUrl } from 'geotiff';
import { readFile, writeFile } from 'node:fs/promises';
import { toUtm, fromUtm } from './utm.mjs';

const ZONE = 51, BASE = 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/51/R/UH';
// Chosen by scoring every 2025/2026 autumn scene for clear sky over campus (SCL) — see context.md
export const SCENES = [
  { id: 'S2A_51RUH_20261117_0_L2A', date: '2026-11-17' },
  { id: 'S2B_51RUH_20251115_0_L2A', date: '2025-11-15' },
];
const GREEN = 0.4; // NDVI ≥ 0.4 counted as vegetated (common threshold for moderate–dense vegetation)
const VALID_SCL = new Set([4, 5, 6, 7]); // vegetation, bare, water, unclassified; rejects shadow/cloud/cirrus

const campusJson = JSON.parse(await readFile(new URL('../public/data/campus.json', import.meta.url), 'utf8'));
const rings = campusJson.campus.geometry.coordinates.map(p => p[0]);
const inRing = (pt, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
  const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c; } return c; };
const inCampus = pt => rings.some(r => inRing(pt, r));

// 20 m grid aligned to the Sentinel-2 20 m pixel grid (tile origin is a multiple of 20 m)
const [x0, y0] = toUtm(121.1840, 24.9645, ZONE), [x1, y1] = toUtm(121.1977, 24.9723, ZONE);
const gx0 = Math.floor(x0 / 20) * 20, gx1 = Math.ceil(x1 / 20) * 20, gy0 = Math.floor(y0 / 20) * 20, gy1 = Math.ceil(y1 / 20) * 20;

async function band(id, name, res) {
  const img = await (await fromUrl(`${BASE}/${id.slice(10, 14)}/${+id.slice(14, 16)}/${id}/${name}.tif`)).getImage();
  const [ox, oy] = img.getOrigin();
  const win = [Math.round((gx0 - ox) / res), Math.round((oy - gy1) / res), Math.round((gx1 - ox) / res), Math.round((oy - gy0) / res)];
  const [data] = await img.readRasters({ window: win });
  return { data, w: win[2] - win[0], res };
}

async function scene(s) {
  const [red, nir, scl] = await Promise.all([band(s.id, 'B04', 10), band(s.id, 'B08', 10), band(s.id, 'SCL', 20)]);
  const W = scl.w, H = (gy1 - gy0) / 20, out = new Float32Array(W * H).fill(NaN);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (!VALID_SCL.has(scl.data[j * W + i])) continue;
    let rs = 0, ns = 0;
    for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const k = (2 * j + dj) * red.w + 2 * i + di; rs += red.data[k]; ns += nir.data[k]; }
    if (rs + ns > 0) out[j * W + i] = (ns - rs) / (ns + rs);
  }
  return { W, H, ndvi: out };
}

const [now, prev] = await Promise.all(SCENES.map(scene));
const r3 = v => Math.round(v * 1000) / 1000;
const features = []; let n = 0, gNow = 0, gPrev = 0, maskedNow = 0, maskedPrev = 0, inside = 0;
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
  features.push({ type: 'Feature', properties: { v: r3(a), p: r3(b), d: r3(a - b) }, geometry: { type: 'Polygon', coordinates: [ring] } });
}

const pct = x => Math.round(x / n * 1000) / 10;
const result = {
  meta: { source: 'Sentinel-2 L2A (ESA)', tier: 'observed', asOf: SCENES[0].date,
    scenes: SCENES, method: `NDVI=(B08−B04)/(B08+B04) at 20 m; SCL classes 4–7 kept; vegetated = NDVI ≥ ${GREEN}; compared only where both scenes are clear`,
    caveat: `Scenes are ${SCENES[1].date} and ${SCENES[0].date}: both fully clear over campus and 2 days apart in the calendar, so season explains little; mowing, crops or works can still show as change.` },
  cells_in_campus: inside, cells_compared: n, masked_now: maskedNow, masked_prev: maskedPrev,
  green_share_now: pct(gNow), green_share_prev: pct(gPrev), area_m2_compared: n * 400,
  grid: { type: 'FeatureCollection', features },
};
await writeFile(new URL('../public/data/ndvi.json', import.meta.url), JSON.stringify(result));
console.log({ inside, n, maskedNow, maskedPrev, now: result.green_share_now, prev: result.green_share_prev });
