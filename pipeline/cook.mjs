// Raw → cooked. Reads var/raw (OSM, Open-Meteo archive), writes public/data/*.json.
// Every cooked file carries meta {source, tier, fetchedAt|asOf, assumptions}.
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOLAR, roofSolar, monthlyIrradiation } from './solar.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = async f => JSON.parse(await readFile(join(ROOT, 'var/raw', f), 'utf8'));
const out = (f, o) => writeFile(join(ROOT, 'public/data', f), JSON.stringify(o));

// planar area of a lon/lat ring in m² (equirectangular around ring centroid — fine at campus scale)
function ringArea(coords) {
  const lat0 = coords.reduce((s, c) => s + c[1], 0) / coords.length * Math.PI / 180;
  const R = 6371008.8, kx = Math.cos(lat0) * Math.PI / 180 * R, ky = Math.PI / 180 * R;
  let a = 0;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++)
    a += (coords[j][0] * kx) * (coords[i][1] * ky) - (coords[i][0] * kx) * (coords[j][1] * ky);
  return Math.abs(a / 2);
}
const ring = g => { const c = g.map(p => [+p.lon.toFixed(6), +p.lat.toFixed(6)]); if (c[0][0] !== c.at(-1)[0] || c[0][1] !== c.at(-1)[1]) c.push(c[0]); return c; };

const osm = await raw('osm-ncu.json');
const ctx = await raw('osm-context.json');
const ghi = await raw('openmeteo-ghi-2025.json');
const ghiYear = monthlyIrradiation(ghi, 2025).reduce((sum, month) => sum + month.kwhM2, 0); // kWh/m²/yr

const campusRel = osm.elements.find(e => e.type === 'relation' && e.id === 18727079);
const campus = {
  type: 'Feature', properties: { name: campusRel.tags.name, name_en: campusRel.tags['name:en'], osm: 'relation/18727079' },
  geometry: { type: 'MultiPolygon', coordinates: campusRel.members.filter(m => m.role === 'outer' && m.geometry).map(m => [ring(m.geometry)]) },
};

// keep only buildings whose centroid lies inside the OSM campus outer ring(s)
function inRing(pt, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
  const [xi, yi] = r[i], [xj, yj] = r[j];
  if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c; } return c; }
const inCampus = pt => campus.geometry.coordinates.some(poly => inRing(pt, poly[0]));
const centroid = g => [g.reduce((s, p) => s + p.lon, 0) / g.length, g.reduce((s, p) => s + p.lat, 0) / g.length];
const all = osm.elements.filter(e => e.type === 'way' && e.tags?.building && e.geometry?.length > 3);
const buildings = all.filter(e => inCampus(centroid(e.geometry))).map(e => {
  const coords = ring(e.geometry);
  const area = ringArea(coords);
  const levels = e.tags['building:levels'] ? Number(e.tags['building:levels']) : null;
  const s = roofSolar(area);
  return {
    type: 'Feature',
    properties: {
      id: `way/${e.id}`, name: e.tags.name ?? null, name_en: e.tags['name:en'] ?? null, kind: e.tags.building,
      area_m2: Math.round(area), levels, height_m: levels ? +(levels * SOLAR.storeyM).toFixed(1) : null,
      kwp: s.kwp, kwh_yr: Math.round(s.kwp * ghiYear * SOLAR.pr),
    },
    geometry: { type: 'Polygon', coordinates: [coords] },
  };
});

const lines = ctx.elements.filter(e => e.type === 'way' && e.geometry).map(e => {
  const t = e.tags; const c = e.geometry.map(p => [+p.lon.toFixed(6), +p.lat.toFixed(6)]);
  const area = t.natural === 'water' || t.leisure;
  return { type: 'Feature', properties: { k: t.highway ?? t.natural ?? t.leisure, name: t.name ?? null },
    geometry: area && c.length > 3 ? { type: 'Polygon', coordinates: [ring(e.geometry)] } : { type: 'LineString', coordinates: c } };
});

const stops = osm.elements.filter(e => e.type === 'node' && e.tags?.highway === 'bus_stop').map(e => ({
  type: 'Feature', properties: { name: e.tags.name ?? null, osm: `node/${e.id}` }, geometry: { type: 'Point', coordinates: [e.lon, e.lat] } }));

const fetchedAt = new Date().toISOString();
const osmMeta = { source: 'OpenStreetMap contributors (ODbL) via Overpass', tier: 'live-snapshot', fetchedAt };
await out('campus.json', { meta: osmMeta, campus, buildings: { type: 'FeatureCollection', features: buildings },
  context: { type: 'FeatureCollection', features: lines }, stops: { type: 'FeatureCollection', features: stops } });

const totKwp = +buildings.reduce((s, b) => s + b.properties.kwp, 0).toFixed(1);
const totKwh = buildings.reduce((s, b) => s + b.properties.kwh_yr, 0);
await out('solar.json', {
  meta: { source: 'OSM footprints × Open-Meteo ERA5 archive (2025 GHI)', tier: 'modeled', fetchedAt,
    assumptions: { ...SOLAR, ghi_kwh_m2_yr: Math.round(ghiYear),
      note: 'Flat-roof, horizontal irradiance, no shading, no structural check. Upper-bound screening estimate, not a design.' } },
  total_kwp: totKwp, total_kwp_low: +(totKwp * SOLAR.usableRoofLow / SOLAR.usableRoof).toFixed(1), total_kwh_yr: totKwh, planned_kwp: 250,
  planned_source: 'NCU × Taipower letter of intent, 2026-03-13 (1 MW / 3 MWh storage, 250 kWp PV)',
  buildings: buildings.filter(b => b.properties.kwp > 0).map(b => b.properties).sort((a, b) => b.kwp - a.kwp),
});
console.log('in bbox', all.length, 'in campus', buildings.length, 'named', buildings.filter(b => b.properties.name).length,
  'campus kWp', totKwp, 'MWh/yr', Math.round(totKwh / 1000), 'GHI', Math.round(ghiYear));
