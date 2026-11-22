// Raw → cooked ecology + mobility context. Reads var/raw/eco/osm-eco.json and var/raw/gbif/occ.json,
// writes public/data/eco.json. Pins only what has a stated position good to ≤ 50 m; the rest is counted, not pinned.
import { readFile, writeFile } from 'node:fs/promises';

const raw = async f => JSON.parse(await readFile(new URL(`../var/raw/${f}`, import.meta.url), 'utf8'));
const osm = await raw('eco/osm-eco.json');
const occ = await raw('gbif/occ.json');
const campus = JSON.parse(await readFile(new URL('../public/data/campus.json', import.meta.url), 'utf8')).campus;
const rings = campus.geometry.coordinates.map(p => p[0]);
const inRing = (pt, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
  const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c; } return c; };
export const inCampus = pt => rings.some(r => inRing(pt, r));
const pt = g => [+g.lon.toFixed(6), +g.lat.toFixed(6)];
const line = e => e.geometry.map(pt);
const closed = c => (c[0][0] === c.at(-1)[0] && c[0][1] === c.at(-1)[1] ? c : [...c, c[0]]);
const center = e => e.type === 'node' ? [e.lon, e.lat] : [e.geometry.reduce((s, p) => s + p.lon, 0) / e.geometry.length, e.geometry.reduce((s, p) => s + p.lat, 0) / e.geometry.length];

const water = [], green = [], roads = [], parking = [];
for (const e of osm.elements) {
  const t = e.tags ?? {};
  if (t.waterway && e.geometry && t.waterway !== 'weir')
    water.push({ type: 'Feature', properties: { k: t.waterway, name: t.name ?? null, osm: `way/${e.id}` }, geometry: { type: 'LineString', coordinates: line(e) } });
  else if (t.natural === 'water' && e.geometry?.length > 3)
    water.push({ type: 'Feature', properties: { k: 'pond', name: t.name ?? null, osm: `way/${e.id}` }, geometry: { type: 'Polygon', coordinates: [closed(line(e))] } });
  else if ((t.natural === 'wood' || t.landuse === 'grass' || t.leisure === 'garden') && e.geometry?.length > 3)
    green.push({ type: 'Feature', properties: { k: t.natural ?? t.landuse ?? t.leisure, name: t.name ?? null }, geometry: { type: 'Polygon', coordinates: [closed(line(e))] } });
  else if (t.highway && e.geometry)
    roads.push({ type: 'Feature', properties: { k: t.highway, name: t.name ?? null, ref: t.ref ?? null, lanes: t.lanes ? +t.lanes : null }, geometry: { type: 'LineString', coordinates: line(e) } });
  else if (/^(parking|bicycle_parking|motorcycle_parking|bicycle_rental)$/.test(t.amenity ?? '')) {
    const c = center(e).map(v => +v.toFixed(6));
    if (!inCampus(c) && t.amenity !== 'bicycle_rental') continue;
    parking.push({ type: 'Feature', properties: { k: t.amenity, name: t.name ?? null, capacity: t.capacity ? +t.capacity : null, osm: `${e.type}/${e.id}` }, geometry: { type: 'Point', coordinates: c } });
  }
}

// Biodiversity: GBIF records inside the campus polygon.
const recs = occ.filter(o => o.decimalLongitude && inCampus([o.decimalLongitude, o.decimalLatitude]) && o.species);
const species = new Map();
for (const o of recs) {
  const s = species.get(o.species) ?? { sci: o.species, vn: o.vernacularName ?? null, cls: o.class ?? null, n: 0, last: 0 };
  s.n++; s.last = Math.max(s.last, o.year ?? 0); if (!s.vn && o.vernacularName) s.vn = o.vernacularName; species.set(o.species, s);
}
const byClass = {};
for (const s of species.values()) byClass[s.cls ?? 'other'] = (byClass[s.cls ?? 'other'] ?? 0) + 1;
const precise = o => o.coordinateUncertaintyInMeters && o.coordinateUncertaintyInMeters <= 50 && !(o.issues ?? []).includes('COORDINATE_ROUNDED');
const pins = recs.filter(precise).map(o => ({ type: 'Feature', properties: { sp: o.species, vn: o.vernacularName ?? null, cls: o.class, y: o.year, u: o.coordinateUncertaintyInMeters, gbif: o.key },
  geometry: { type: 'Point', coordinates: [+o.decimalLongitude.toFixed(6), +o.decimalLatitude.toFixed(6)] } }));
const datasets = {};
for (const o of recs) { const k = o.datasetName ?? (o.datasetKey === 'e0b8cb67-6667-423d-ab71-08021b6485f3' ? 'Taiwan Moth Occurrence Data (TESRI)' : 'other'); datasets[k] = (datasets[k] ?? 0) + 1; }
const years = recs.map(o => o.year).filter(Boolean);

// Named water that touches the campus polygon (any vertex inside), for the panel. Names exactly as OSM has them.
const touches = f => (f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates).some(inCampus);
const onCampusWater = [...new Map(water.filter(f => f.properties.name && touches(f)).map(f => [f.properties.name, f.properties.k])).entries()].map(([name, k]) => ({ name, k }));
const fetchedAt = new Date().toISOString();
await writeFile(new URL('../public/data/eco.json', import.meta.url), JSON.stringify({
  meta: { source: 'OpenStreetMap contributors (ODbL) via Overpass; GBIF.org occurrence search (CC0/CC-BY per dataset)', tier: 'observed', fetchedAt },
  water: { type: 'FeatureCollection', features: water },
  onCampusWater,
  green: { type: 'FeatureCollection', features: green },
  roads: { type: 'FeatureCollection', features: roads },
  parking: { type: 'FeatureCollection', features: parking },
  bio: {
    records: recs.length, species: species.size, byClass, datasets, years: [Math.min(...years), Math.max(...years)],
    pinned: pins.length,
    pinRule: 'Pinned only when the record states a position good to ≤ 50 m and the coordinate is not rounded. eBird hotspot and moth-network records are counted, not pinned.',
    top: [...species.values()].sort((a, b) => b.n - a.n).slice(0, 12),
    pins: { type: 'FeatureCollection', features: pins },
  },
}));
console.log({ water: water.length, green: green.length, roads: roads.length, parking: parking.length, recs: recs.length, species: species.size, pins: pins.length, byClass });
