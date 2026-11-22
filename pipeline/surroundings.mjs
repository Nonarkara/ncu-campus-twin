#!/usr/bin/env node
// Harvest surrounding Zhongli / Freeway 1 major roads, waterways, and off-campus urban buildings
// around NCU (bbox 24.955,121.174,24.979,121.212) into public/data/surroundings.json.
// Gives the campus twin real urban & motorway context (connecting directly to the Zhongli IC VD sensors).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BBOX = '24.955,121.174,24.979,121.212'; // S,W,N,E (~3.8 km × 2.7 km around NCU + Freeway 1 Zhongli IC)
const OVERPASS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

async function queryOverpass(ql) {
  let lastErr;
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'ncu-campus-twin/0.7' },
        body: 'data=' + encodeURIComponent(ql),
        signal: AbortSignal.timeout(45000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function inRing(pt, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

const roundPt = p => [+p.lon.toFixed(5), +p.lat.toFixed(5)];
const toRing = g => {
  const c = g.map(roundPt);
  if (c[0][0] !== c.at(-1)[0] || c[0][1] !== c.at(-1)[1]) c.push(c[0]);
  return c;
};
const centroid = g => [g.reduce((s, p) => s + p.lon, 0) / g.length, g.reduce((s, p) => s + p.lat, 0) / g.length];

const campus = JSON.parse(await readFile(join(ROOT, 'public/data/campus.json'), 'utf8'));
const inCampus = pt => campus.campus.geometry.coordinates.some(poly => inRing(pt, poly[0]));

// 1. Major roads + waterways in wider Zhongli / Freeway 1 bbox
const roadsQl = `[out:json][timeout:30];
(
  way["highway"="motorway"](${BBOX});
  way["highway"="motorway_link"](${BBOX});
  way["highway"="trunk"](${BBOX});
  way["highway"="primary"](${BBOX});
  way["highway"="secondary"](${BBOX});
  way["highway"="tertiary"](${BBOX});
  way["waterway"="river"](${BBOX});
  way["waterway"="canal"](${BBOX});
  way["waterway"="stream"](${BBOX});
);
out body geom;`;

// 2. Surrounding buildings in immediate urban ring around campus (tighter bbox to keep JSON compact)
const BLD_BBOX = '24.959,121.180,24.976,121.205';
const bldQl = `[out:json][timeout:35];
(
  way["building"](${BLD_BBOX});
);
out body geom;`;

console.log('Querying Overpass for wider Zhongli / Freeway 1 roads & waterways...');
const roadsData = await queryOverpass(roadsQl);
console.log(`Received ${roadsData.elements.length} road/waterway elements.`);

console.log('Querying Overpass for surrounding urban buildings...');
const bldData = await queryOverpass(bldQl);
console.log(`Received ${bldData.elements.length} building elements.`);

await mkdir(join(ROOT, 'var/raw/surroundings'), { recursive: true });
await writeFile(join(ROOT, 'var/raw/surroundings/roads.json'), JSON.stringify(roadsData));
await writeFile(join(ROOT, 'var/raw/surroundings/buildings.json'), JSON.stringify(bldData));

const roads = [];
const waters = [];
for (const e of roadsData.elements) {
  if (e.type !== 'way' || !e.geometry?.length) continue;
  const coords = e.geometry.map(roundPt);
  if (e.tags?.highway) {
    roads.push({
      type: 'Feature',
      properties: {
        k: e.tags.highway,
        name: e.tags.name ?? null,
        ref: e.tags.ref ?? null,
      },
      geometry: { type: 'LineString', coordinates: coords },
    });
  } else if (e.tags?.waterway) {
    waters.push({
      type: 'Feature',
      properties: { k: e.tags.waterway, name: e.tags.name ?? null },
      geometry: { type: 'LineString', coordinates: coords },
    });
  }
}

// Keep only off-campus buildings so we don't duplicate the 109 NCU campus buildings
const ctxBuildings = [];
for (const e of bldData.elements) {
  if (e.type !== 'way' || !e.tags?.building || (e.geometry?.length ?? 0) < 4) continue;
  if (inCampus(centroid(e.geometry))) continue;
  ctxBuildings.push({
    type: 'Feature',
    properties: { k: e.tags.building },
    geometry: { type: 'Polygon', coordinates: [toRing(e.geometry)] },
  });
}

// Also build curated label points for major named campus buildings (area >= 1200 m² or anchor)
const campusLabels = campus.buildings.features
  .filter(f => f.properties.name && (f.properties.area_m2 >= 1200 || f.properties.id === 'way/268824891' || f.properties.id === 'way/268561943'))
  .map(f => {
    const ring = f.geometry.coordinates[0];
    const n = ring.length - 1;
    const lon = ring.slice(0, n).reduce((s, c) => s + c[0], 0) / n;
    const lat = ring.slice(0, n).reduce((s, c) => s + c[1], 0) / n;
    return {
      type: 'Feature',
      properties: {
        id: f.properties.id,
        name: f.properties.name,
        name_en: f.properties.name_en,
        area: f.properties.area_m2,
      },
      geometry: { type: 'Point', coordinates: [+lon.toFixed(6), +lat.toFixed(6)] },
    };
  });

const out = {
  meta: {
    source: 'OpenStreetMap contributors (ODbL) via Overpass',
    tier: 'observed',
    fetchedAt: new Date().toISOString(),
    roads: roads.length,
    waters: waters.length,
    contextBuildings: ctxBuildings.length,
    campusLabels: campusLabels.length,
  },
  roads: { type: 'FeatureCollection', features: roads },
  waters: { type: 'FeatureCollection', features: waters },
  buildings: { type: 'FeatureCollection', features: ctxBuildings },
  labels: { type: 'FeatureCollection', features: campusLabels },
};

await writeFile(join(ROOT, 'public/data/surroundings.json'), JSON.stringify(out));
console.log('Wrote public/data/surroundings.json:', out.meta);
