// Raw → cooked directory. Validates every entry (name + http(s) URL), links an entry to an OSM footprint
// only when its building label equals an OSM building name exactly. No fuzzy matching: a wrong link is worse than none.
import { readFile, writeFile } from 'node:fs/promises';
import { tels } from './tels.mjs';
const dir = JSON.parse(await readFile(new URL('../var/raw/directory/directory.json', import.meta.url), 'utf8'));
const crosswalk = JSON.parse(await readFile(new URL('../data/campus-crosswalk.json', import.meta.url), 'utf8'));
const campus = JSON.parse(await readFile(new URL('../public/data/campus.json', import.meta.url), 'utf8'));
const byName = new Map();
for (const b of campus.buildings.features) if (b.properties.name) byName.set(b.properties.name.trim(), b.properties.id);
// Hand-checked equivalences (official map label → OSM name). Each pair names the same building; extend only by reading both.
const ALIAS = {
  '學生男三舍': '男三舍', '學生男五舍': '男五舍', '學生男六舍': '男六舍', '學生男七舍': '男七舍', '學生男九舍': '男九舍',
  '學生男十一舍': '男十一舍', '學生男十二舍': '男十二舍', '學生男十三舍': '男13舍', '學生女一舍': '女一舍', '學生女二舍': '女二舍',
  '學生女三舍': '女三舍', '學生女四舍': '女四舍', '學生女十四舍': '女十四舍', '教職員單一舍': '單一舍', '教職員單二舍': '單二舍',
  '教職員單四舍': '單四舍', '桃園市中大國民運動中心': '中大國民運動中心', '科學二館': '科學二館(理學院大樓)',
};
const facilities = dir.categories.find(c => c.key === 'facility').entries;
for (const identity of crosswalk.buildings) {
  if (dir.categories.some(c => c.entries.some(e => byName.get(ALIAS[e.building] ?? e.building) === identity.id))) continue;
  const building = campus.buildings.features.find(f => f.properties.id === identity.id);
  if (building) facilities.push({ zh: identity.zh, en: identity.en, url: crosswalk.sourceUrl, building: building.properties.name });
}
let linked = 0, dropped = 0, labelled = 0;
const categories = dir.categories.map(c => ({ key: c.key, entries: c.entries.filter(e => {
  const ok = (e.zh || e.en) && /^https?:\/\//.test(e.url ?? ''); if (!ok) dropped++; return ok;
}).map(e => {
  if (e.building) labelled++;
  // An entry whose own note says its building is assumed is not linked to a footprint (GSH: no unverified pins).
  const assumed = /assum|verify/i.test(e.note ?? '');
  const osm = e.building && !assumed ? byName.get(ALIAS[e.building.trim()] ?? e.building.trim()) ?? null : null; if (osm) linked++;
  const stale = (e.note ?? '').startsWith('STALE') ? ((e.zh ?? '') + (e.note ?? '')).match(/20\d\d/)?.[0] ?? 'old' : null;
  return { zh: e.zh ?? null, en: e.en ?? null, url: e.url, phone: e.phone ?? null, tels: tels(e.phone), capacity: e.capacity ? { ...e.capacity, stale } : null, building: e.building ?? null, osm, note: e.note ?? null };
}) }));
// English building names: only where the directory entry IS the building (a dorm, or an entry whose own name is the
// building's name), never a unit housed inside it. Existing OSM name:en wins. Run after cook.mjs and heights.mjs.
const strip = s => (s ?? '').replace(/\s*\(.*\)$/, '').trim();
let named = 0;
// OSM name:en values that name a unit inside the building, not the building: drop them rather than mislabel the footprint.
const UNIT_NOT_BUILDING = new Set(['鴻經館', '綜教館(語言中心)']);
for (const f of campus.buildings.features) if (UNIT_NOT_BUILDING.has(f.properties.name)) f.properties.name_en = null;
for (const c of categories) for (const e of c.entries) {
  if (!e.osm || !e.en || !(c.key === 'housing' || strip(e.zh) === strip(e.building))) continue;
  const f = campus.buildings.features.find(b => b.properties.id === e.osm);
  if (f && !f.properties.name_en) { f.properties.name_en = strip(e.en); named++; }
}
await writeFile(new URL('../public/data/campus.json', import.meta.url), JSON.stringify(campus));
console.log({ named_en: named });
await writeFile(new URL('../public/data/directory.json', import.meta.url), JSON.stringify({
  meta: { source: 'ncu.edu.tw official pages (each entry links its page)', tier: 'observed', asOf: dir.asOf }, categories }));
console.log({ entries: categories.reduce((s, c) => s + c.entries.length, 0), dropped, labelled, linked });
