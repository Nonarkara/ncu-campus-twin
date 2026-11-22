#!/usr/bin/env node
// Harvest official measured building heights (BUILD_H) for NCU from Taiwan NLSC public 3D Tiles
// (桃園市分棟版建物模型, https://3dtiles.nlsc.gov.tw/building/tiles3d/37/tileset.json).
// Matches NLSC TWD97 TM2 (EPSG:3826) centroids strictly inside OSM building polygons in public/data/campus.json.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://3dtiles.nlsc.gov.tw/building/tiles3d/37/';

// WGS84 -> ECEF (m)
function toEcef(latDeg, lonDeg, h = 130) {
  const a = 6378137.0, f = 1 / 298.257223563, e2 = 2 * f - f * f;
  const lat = (latDeg * Math.PI) / 180, lon = (lonDeg * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return [(N + h) * Math.cos(lat) * Math.cos(lon), (N + h) * Math.cos(lat) * Math.sin(lon), (N * (1 - e2) + h) * Math.sin(lat)];
}

// TWD97 TM2 (EPSG:3826: GRS80, lon0=121E, k0=0.9999, FE=250000) -> WGS84 [lon, lat]
function twd97ToWgs84(x, y) {
  const a = 6378137.0, b = 6356752.314140356;
  const lon0 = (121 * Math.PI) / 180, k0 = 0.9999, dx = 250000;
  const e = Math.sqrt(1 - (b * b) / (a * a));
  const e2 = (e * e) / (1 - e * e);
  const X = x - dx;
  const M = y / k0;
  const mu = M / (a * (1 - (e ** 2) / 4 - (3 * e ** 4) / 64 - (5 * e ** 6) / 256));
  const e1 = (1 - Math.sqrt(1 - e * e)) / (1 + Math.sqrt(1 - e * e));
  const J1 = (3 * e1) / 2 - (27 * e1 ** 3) / 32;
  const J2 = (21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32;
  const J3 = (151 * e1 ** 3) / 96;
  const J4 = (1097 * e1 ** 4) / 512;
  const fp = mu + J1 * Math.sin(2 * mu) + J2 * Math.sin(4 * mu) + J3 * Math.sin(6 * mu) + J4 * Math.sin(8 * mu);
  const C1 = e2 * Math.cos(fp) ** 2;
  const T1 = Math.tan(fp) ** 2;
  const R1 = (a * (1 - e * e)) / Math.pow(1 - e * e * Math.sin(fp) ** 2, 1.5);
  const N1 = a / Math.sqrt(1 - e * e * Math.sin(fp) ** 2);
  const D = X / (N1 * k0);
  const Q1 = (N1 * Math.tan(fp)) / R1;
  const Q2 = (D * D) / 2;
  const Q3 = ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * e2) * D ** 4) / 24;
  const Q4 = ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 3 * C1 * C1 - 252 * e2) * D ** 6) / 720;
  const lat = fp - Q1 * (Q2 - Q3 + Q4);
  const Q5 = D;
  const Q6 = ((1 + 2 * T1 + C1) * D ** 3) / 6;
  const Q7 = ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * e2 + 24 * T1 * T1) * D ** 5) / 120;
  const lon = lon0 + (Q5 - Q6 + Q7) / Math.cos(fp);
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}

function inRing(pt, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function distMeters(a, b) {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (a[0] - b[0]) * Math.cos(lat) * 111320;
  const dy = (a[1] - b[1]) * 110540;
  return Math.hypot(dx, dy);
}

function distToPolygonEdgeMeters(pt, ring) {
  let best = Infinity;
  const lat = pt[1] * (Math.PI / 180);
  const kx = Math.cos(lat) * 111320, ky = 110540;
  const px = pt[0] * kx, py = pt[1] * ky;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0] * kx, ay = ring[j][1] * ky;
    const bx = ring[i][0] * kx, by = ring[i][1] * ky;
    const abx = bx - ax, aby = by - ay;
    const len2 = abx * abx + aby * aby;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2)) : 0;
    const d = Math.hypot(px - (ax + t * abx), py - (ay + t * aby));
    if (d < best) best = d;
  }
  return best;
}

function decodeGlbMetadata(buf) {
  if (buf.length < 28 || buf.toString('ascii', 0, 4) !== 'glTF') return [];
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  const pt = gltf.extensions?.EXT_structural_metadata?.propertyTables?.[0];
  if (!pt || !pt.count) return [];
  const binStart = 20 + jsonLen + 8;
  const bvs = gltf.bufferViews;
  const readStrings = prop => {
    const valBv = bvs[prop.values], offBv = bvs[prop.stringOffsets];
    const vals = buf.subarray(binStart + valBv.byteOffset, binStart + valBv.byteOffset + valBv.byteLength);
    const offs = buf.subarray(binStart + offBv.byteOffset, binStart + offBv.byteOffset + offBv.byteLength);
    const out = [];
    for (let i = 0; i < pt.count; i++) {
      out.push(vals.subarray(offs.readUInt32LE(i * 4), offs.readUInt32LE((i + 1) * 4)).toString('utf8'));
    }
    return out;
  };
  const rows = Array.from({ length: pt.count }, () => ({}));
  for (const [k, prop] of Object.entries(pt.properties)) {
    const arr = readStrings(prop);
    arr.forEach((v, i) => { rows[i][k] = v; });
  }
  return rows;
}

const campusPath = join(ROOT, 'public/data/campus.json');
const campus = JSON.parse(await readFile(campusPath, 'utf8'));

// Traverse NLSC tileset for leaves within 800 m of NCU centre
const ncuEcef = toEcef(24.9684, 121.1916, 130);
const root = await (await fetch(BASE + 'tileset.json', { signal: AbortSignal.timeout(20000) })).json();
const leafUris = [];
function walk(node) {
  const s = node.boundingVolume?.sphere;
  if (s) {
    if (!(s[3] > 0)) return;
    if (Math.hypot(s[0] - ncuEcef[0], s[1] - ncuEcef[1], s[2] - ncuEcef[2]) > s[3] + 750) return;
  }
  const kids = node.children ?? [];
  if (!kids.length) {
    for (const c of node.contents ?? (node.content ? [node.content] : [])) {
      if (c.uri?.endsWith('.glb')) leafUris.push(c.uri);
    }
  } else {
    for (const k of kids) walk(k);
  }
}
walk(root.root);
console.log(`Traversing ${leafUris.length} NLSC leaf tiles around NCU...`);

const byId = new Map();
const CONC = 10;
let idx = 0;
async function worker() {
  while (idx < leafUris.length) {
    const uri = leafUris[idx++];
    try {
      const r = await fetch(BASE + uri, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) continue;
      const rows = decodeGlbMetadata(Buffer.from(await r.arrayBuffer()));
      for (const row of rows) {
        const h = Number(row.BUILD_H);
        const e97 = Number(row.CENT_E_97);
        const n97 = Number(row.CENT_N_97);
        if (!(h > 0) || !Number.isFinite(e97) || !Number.isFinite(n97)) continue;
        const [lon, lat] = twd97ToWgs84(e97, n97);
        if (lon < 121.183 || lon > 121.199 || lat < 24.963 || lat > 24.974) continue;
        const id = row.BUILD_ID || `${e97}_${n97}`;
        if (!byId.has(id)) {
          byId.set(id, {
            id,
            height_m: +h.toFixed(1),
            floors: Number(row.BUILD_NO) > 0 ? Number(row.BUILD_NO) : null,
            h_source: row.H_SOURCE,
            mdate: row.MDATE || null,
            m_mdate: row.M_MDATE || null,
            source_des: row.SOURCE_DES || null,
            lon: +lon.toFixed(6),
            lat: +lat.toFixed(6),
          });
        }
      }
    } catch { /* skip transient tile error */ }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

const nlscBuildings = [...byId.values()];
await mkdir(join(ROOT, 'var/raw/heights/nlsc'), { recursive: true });
await writeFile(join(ROOT, 'var/raw/heights/nlsc/ncu-nlsc-buildings.json'), JSON.stringify({
  fetchedAt: new Date().toISOString(),
  source: 'NLSC 桃園市分棟版建物模型 (3dtiles.nlsc.gov.tw/building/tiles3d/37)',
  count: nlscBuildings.length,
  buildings: nlscBuildings,
}, null, 2));
console.log(`Extracted ${nlscBuildings.length} unique NLSC measured buildings in NCU bbox.`);

// Match NLSC measured heights to our 109 OSM campus buildings (point-in-polygon first, then <=6 m edge fallback)
let matchedInside = 0, matchedNear = 0, keptOsm = 0, unknown = 0;
for (const feat of campus.buildings.features) {
  const ring = feat.geometry.coordinates[0];
  const inside = nlscBuildings.filter(b => inRing([b.lon, b.lat], ring));
  let hits = inside;
  let mode = 'inside';
  if (!hits.length) {
    // Check for centroid within 6 m of polygon boundary (handles L-shaped/courtyard buildings whose centroid sits just outside)
    const near = nlscBuildings
      .map(b => ({ b, d: distToPolygonEdgeMeters([b.lon, b.lat], ring) }))
      .filter(x => x.d <= 6)
      .sort((a, b) => a.d - b.d);
    if (near.length) {
      hits = [near[0].b];
      mode = 'near';
    }
  }
  if (hits.length) {
    // Pick the tallest measured section for buildings with multiple NLSC sub-blocks
    const best = hits.reduce((a, b) => (b.height_m > a.height_m ? b : a));
    feat.properties.height_m = best.height_m;
    if (best.floors && !feat.properties.levels) feat.properties.levels = best.floors;
    feat.properties.height_source = 'NLSC 3D Building Model';
    feat.properties.height_tier = 'observed';
    feat.properties.height_mdate = best.mdate;
    if (mode === 'inside') matchedInside++;
    else matchedNear++;
  } else if (feat.properties.levels) {
    feat.properties.height_source = 'OSM building:levels × 3.5 m';
    feat.properties.height_tier = 'modeled';
    feat.properties.height_mdate = null;
    keptOsm++;
  } else {
    feat.properties.height_m = null;
    feat.properties.height_source = null;
    feat.properties.height_tier = null;
    feat.properties.height_mdate = null;
    unknown++;
  }
}

campus.meta.heights = {
  source: 'NLSC 桃園市分棟版建物模型 (3D Tiles)',
  tier: 'observed',
  fetchedAt: new Date().toISOString(),
  matched_nlsc: matchedInside + matchedNear,
  matched_osm_floors: keptOsm,
  unknown,
};

await writeFile(campusPath, JSON.stringify(campus));
console.log(`Updated public/data/campus.json: NLSC measured=${matchedInside + matchedNear} (inside=${matchedInside}, <=6m=${matchedNear}), OSM floors=${keptOsm}, unknown=${unknown}`);
console.log('Sample named buildings with NLSC heights:');
for (const f of campus.buildings.features.filter(x => x.properties.name && x.properties.height_tier === 'observed').slice(0, 12)) {
  const p = f.properties;
  console.log(`  ${p.name}: ${p.height_m} m (${p.levels ?? '?'}F, ${p.height_mdate})`);
}
