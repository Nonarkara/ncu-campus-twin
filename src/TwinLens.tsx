// Twin lens: what the campus holds and what flows through it — green cover, water, wildlife, docks, roads, built volume.
// Every row carries its source, tier and age; a feed that fails renders no row.
import { Fragment } from 'react';
import type { Meta } from './shared/today';
import type { Live } from './shared/live';
import { SLOW_KMH, DOCK_EN } from './shared/live';
import type { CampusData } from './shared/campus';
import type { Directory } from './FindLens';

type L = 'en' | 'zh';
export type Layer = 'green' | 'water' | 'bio' | 'flow' | 'b3d';
export const LAYERS: { k: Layer; t: [string, string] }[] = [
  { k: 'b3d', t: ['3D', '立體'] },
  { k: 'green', t: ['Green', '綠覆'] },
  { k: 'water', t: ['Water', '水系'] },
  { k: 'flow', t: ['Flow', '交通'] },
  { k: 'bio', t: ['Wildlife', '物種'] },
];

const pick = (p: readonly [string, string], l: L) => (l === 'en' ? p[0] : p[1]);
const TIER: Record<string, string> = { live: '即時', observed: '觀測', fetched: '擷取', modeled: '模式', unavailable: '無資料', 'live-snapshot': '快照' };
const age = (iso: string | null, l: L) => {
  if (!iso) return '—';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (Number.isNaN(m)) return iso;
  if (m < 1) return l === 'en' ? 'now' : '剛剛';
  if (m < 120) return l === 'en' ? `${m}m ago` : `${m} 分前`;
  if (m < 2880) return l === 'en' ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 60)} 時前`;
  return iso.slice(0, 10);
};
const M = ({ m, l }: { m: { source: string; tier: string; asOf: string | null }; l: L }) => <span className="nb">{m.source} · {l === 'en' ? m.tier : TIER[m.tier] ?? m.tier} · {age(m.asOf, l)}</span>;
/** Newest NLSC survey month (MDATE YYYYMM) among measured footprints, as an ISO date: the age of the heights, not of our download. */
const surveyMonth = (blds: CampusData['buildings']['features']) => {
  const m = blds.map(b => b.properties.height_mdate).filter((x): x is string => !!x && /^\d{6}$/.test(x)).sort().at(-1);
  return m ? `${m.slice(0, 4)}-${m.slice(4)}-01` : null;
};
const n0 = (v: number) => v.toLocaleString('en-US');

const CLASS: Record<string, [string, string]> = {
  Insecta: ['insects', '昆蟲'], Aves: ['birds', '鳥類'], Magnoliopsida: ['flowering plants', '雙子葉植物'], Liliopsida: ['monocots', '單子葉植物'],
  Polypodiopsida: ['ferns', '蕨類'], Arachnida: ['spiders', '蛛形'], Gastropoda: ['snails', '螺貝'], Amphibia: ['amphibians', '兩生類'], Testudines: ['turtles', '龜鱉'],
};

export interface Eco {
  meta: Meta & { fetchedAt?: string };
  onCampusWater: { name: string; k: string }[];
  parking: { features: { properties: { k: string; capacity: number | null } }[] };
  bio: { records: number; species: number; byClass: Record<string, number>; datasets: Record<string, number>; years: [number, number]; pinned: number; pinRule: string;
    top: { sci: string; vn: string | null; n: number }[] };
}
export interface Ndvi {
  meta: Meta & { scenes: { date: string }[]; caveat: string; method: string };
  green_share_now: number;
  green_share_prev: number;
  cells_compared: number;
  area_m2_compared: number;
  grid?: { features: { properties: { v: number; p: number; d: number } }[] };
}

export function TwinLens({ eco, ndvi, live, campus, dir, layers, onToggle, onFocusCoord, l }: {
  eco: Eco | null; ndvi: Ndvi | null; live: Live | null; campus: CampusData | null; dir: Directory | null;
  layers: Set<Layer>; onToggle: (k: Layer) => void; onFocusCoord?: (coord: [number, number]) => void; l: L;
}) {
  const delta = ndvi ? Math.round((ndvi.green_share_now - ndvi.green_share_prev) * 10) / 10 : null;
  const ndviShift = (() => {
    const feats = ndvi?.grid?.features;
    if (!feats?.length) return null;
    let gained = 0, lost = 0, steady = 0;
    for (const f of feats) {
      const d = f.properties.d;
      if (d >= 0.05) gained++;
      else if (d <= -0.05) lost++;
      else steady++;
    }
    const tot = feats.length;
    return { gained, lost, steady, tot, pctGained: Math.round((gained / tot) * 100), pctLost: Math.round((lost / tot) * 100) };
  })();
  const blds = campus?.buildings.features ?? [];
  const measured = blds.filter(b => b.properties.height_tier === 'observed').length;
  const modeledH = blds.filter(b => b.properties.height_tier === 'modeled').length;
  const flatBlds = blds.filter(b => b.properties.height_m === null).length;
  const maxH = blds.reduce((m, b) => Math.max(m, b.properties.height_m ?? 0), 0);
  const hMeta = campus?.meta.heights
    ? { source: campus.meta.heights.source, tier: 'observed', asOf: surveyMonth(blds) ?? campus.meta.heights.fetchedAt }
    : campus ? { source: 'OpenStreetMap', tier: campus.meta.tier, asOf: campus.meta.fetchedAt } : null;
  const ecoMeta = eco ? { source: 'OpenStreetMap', tier: 'fetched', asOf: eco.meta.fetchedAt ?? null } : null;
  const main = live?.road.data.filter(f => f.kind === 'main') ?? [];
  const exits = live?.road.data.filter(f => f.kind === 'exit') ?? [];
  const lots = eco?.parking.features.filter(f => f.properties.k !== 'bicycle_rental') ?? [];
  const cap = lots.filter(f => f.properties.capacity !== null);
  const seats = (dir?.categories.flatMap(c => c.entries) ?? [])
    .filter(e => e.capacity?.unit === 'seats' && !(e.note ?? '').startsWith('STALE')).sort((a, b) => b.capacity!.value - a.capacity!.value);
  const bioMeta = eco ? { source: 'GBIF', tier: 'fetched', asOf: eco.meta.fetchedAt ?? null } : null;
  const dirMeta = dir ? { source: 'ncu.edu.tw', tier: 'fetched', asOf: dir.meta.asOf } : null;
  const classes = eco ? Object.entries(eco.bio.byClass).filter(([k]) => CLASS[k]).sort((a, b) => b[1] - a[1]).slice(0, 4) : [];

  return (
    <>
      {ndvi && (
        <div className="hero">
          <b>{ndvi.green_share_now}<small>%</small></b>
          <p>
            {l === 'en' ? 'of campus is vegetated, ' : '校園植被覆蓋率，'}
            <span className={delta !== null && delta <= -2 ? 'act' : ''}>
              {delta !== null && (delta > 0 ? '+' : '')}{delta} {l === 'en' ? `pts vs ${ndvi.meta.scenes[1].date}` : `個百分點（對比 ${ndvi.meta.scenes[1].date}）`}
            </span>
            <br /><small className="meta">{ndvi.meta.source} · {l === 'en' ? 'observed' : '觀測'} · {ndvi.meta.asOf}</small>
          </p>
        </div>
      )}

      <div className="chips" role="group" aria-label={l === 'en' ? 'Map layers' : '圖層'}>
        {LAYERS.map(x => (
          <button key={x.k} aria-pressed={layers.has(x.k)} onClick={() => onToggle(x.k)}>{pick(x.t, l)}</button>
        ))}
      </div>
      <a className="tomap" href="#map">{l === 'en' ? '3D campus map ↓' : '立體校園地圖 ↓'}</a>

      {ndvi && ndviShift && (
        <div className="ndvi-bar" aria-label={l === 'en' ? 'NDVI year-on-year cell change' : 'NDVI 年變化分布'}>
          <div className="ndvi-track">
            <span className="ndvi-g" style={{ width: `${(ndviShift.gained / ndviShift.tot) * 100}%` }} />
            <span className="ndvi-s" style={{ width: `${(ndviShift.steady / ndviShift.tot) * 100}%` }} />
            <span className="ndvi-l" style={{ width: `${(ndviShift.lost / ndviShift.tot) * 100}%` }} />
          </div>
          <div className="meta">
            {l === 'en'
              ? `${ndviShift.gained} cells greener (≥+0.05) · ${ndviShift.steady} steady · ${ndviShift.lost} drier (≤−0.05) across ${n0(ndvi.cells_compared)} × 20 m cells`
              : `${ndviShift.gained} 格變綠（≥+0.05）・${ndviShift.steady} 格持平・${ndviShift.lost} 格轉弱（≤−0.05），共 ${n0(ndvi.cells_compared)} 格 20 m 網格`}
          </div>
        </div>
      )}

      <ul className="steady">
        {main.length > 0 && live && (
          <li>
            <span>{l === 'en' ? 'Freeway 1 at Zhongli exit' : '國道 1 號・中壢交流道'}</span>
            <b>{main.map((f, i) => (
              <Fragment key={f.id}>
                {i > 0 && ' · '}
                <button className={`inline-jump ${f.speed !== null && f.speed < SLOW_KMH ? 'act' : ''}`}
                  onClick={() => onFocusCoord?.([f.lon, f.lat])}>
                  {f.dir === 'S' ? (l === 'en' ? 'S ' : '南 ') : (l === 'en' ? 'N ' : '北 ')}{f.speed ?? '—'}
                </button>
              </Fragment>))} km/h</b>
            <small><M m={live.road.meta} l={l} /></small>
          </li>
        )}
        {exits.length > 0 && live && (
          <li>
            <span>{l === 'en' ? 'Zhongli exit ramps' : '中壢出口匝道'}</span>
            <b>{exits.map((f, i) => (
              <Fragment key={f.id}>
                {i > 0 && ' + '}
                <button className="inline-jump" onClick={() => onFocusCoord?.([f.lon, f.lat])}>
                  {n0(Math.round(f.vph / 60))}
                </button>
              </Fragment>))} {l === 'en' ? 'veh/min' : '輛/分'}</b>
            <small><M m={live.road.meta} l={l} /> · {l === 'en' ? 'counted over the last minute; serves all of Zhongli' : '最近一分鐘計數；服務整個中壢'}</small>
          </li>
        )}
        {live && live.docks.data.length > 0 && (
          <li>
            <span>{l === 'en' ? 'YouBike bikes / docks' : 'YouBike 車輛／車柱'}</span>
            <b>{live.docks.data.map((d, i) => (
              <Fragment key={d.id}>
                {i > 0 && ' · '}
                <button className={`inline-jump ${d.bikes <= 2 ? 'act' : ''}`} onClick={() => onFocusCoord?.([d.lon, d.lat])}>
                  {l === 'en' ? DOCK_EN[d.id] ?? d.en : d.zh.replace('中央大學', '')} {d.bikes}/{d.capacity}
                </button>
              </Fragment>))}</b>
            <small><M m={live.docks.meta} l={l} /></small>
          </li>
        )}
        {eco && ecoMeta && (
          <li>
            <span>{l === 'en' ? 'Water on campus' : '校內水體'}</span>
            <b>{eco.onCampusWater.map(w => w.name).join(' · ')}</b>
            <small>{l === 'en' ? 'Campus sits in the 石門大圳 irrigation network; 老街溪 drains east.' : '校區位於石門大圳灌溉水網內，東側為老街溪。'}<br /><M m={ecoMeta} l={l} /></small>
          </li>
        )}
        {eco && bioMeta && (
          <li>
            <span>{l === 'en' ? 'Wildlife recorded on campus' : '校內物種紀錄'}</span>
            <b>{n0(eco.bio.species)} {l === 'en' ? 'species' : '種'} · {classes.map(([k, v]) => `${v} ${pick(CLASS[k], l)}`).join(' · ')}</b>
            <small><M m={bioMeta} l={l} /> · {n0(eco.bio.records)} {l === 'en' ? 'records' : '筆'} {eco.bio.years[0]}–{eco.bio.years[1]}, {l === 'en' ? `${n0(eco.bio.datasets.eBird ?? 0)} of them eBird hotspot lists` : `其中 ${n0(eco.bio.datasets.eBird ?? 0)} 筆為 eBird 熱點清單`} · {l === 'en' ? `${eco.bio.pinned} with ≤50 m position are pinned; the rest are counted, not pinned` : `${eco.bio.pinned} 筆定位 ≤50 m 者標點，其餘僅計數`}</small>
          </li>
        )}
        {seats.length > 0 && dirMeta && (
          <li>
            <span>{l === 'en' ? 'Published seating' : '公開座位數'}</span>
            <b>{seats.slice(0, 4).map(e => `${(e.zh ?? '').replace(/\s*\(.*\)$/, '')} ${n0(e.capacity!.value)}`).join(' · ')}</b>
            <small>{l === 'en' ? 'Official NCU pages; each source is linked in Find. Dorm bed counts are not published.' : '來源為中大官方頁面，於「查詢」逐筆連結。宿舍床位未公開。'}<br /><M m={dirMeta} l={l} /></small>
          </li>
        )}
        {eco && ecoMeta && (
          <li>
            <span>{l === 'en' ? 'Parking areas mapped' : '已標示停車區'}</span>
            <b>{lots.length} {l === 'en' ? 'areas' : '處'} · {l === 'en' ? `capacity known for ${cap.length}` : `${cap.length} 處有容量`} ({n0(cap.reduce((s, f) => s + (f.properties.capacity ?? 0), 0))} {l === 'en' ? 'bike spaces' : '自行車位'})</b>
            <small>{l === 'en' ? 'No current official car or scooter count is published (last: 2014–2020); live counts need 總務處 gate data.' : '現行汽機車格數未公開（最近公布為 2014–2020 年），即時數需總務處柵欄資料。'}<br /><M m={ecoMeta} l={l} /></small>
          </li>
        )}
        {campus && hMeta && (
          <li>
            <span>{l === 'en' ? 'Built volume (3D)' : '建物量體（3D）'}</span>
            <b>
              {blds.length} {l === 'en' ? 'buildings' : '棟'} ·{' '}
              {l === 'en'
                ? `${measured} NLSC measured${modeledH ? ` + ${modeledH} OSM floors` : ''} · max ${maxH.toFixed(1)} m`
                : `${measured} 棟國土測繪實測${modeledH ? ` + ${modeledH} 棟 OSM 樓層` : ''}・最高 ${maxH.toFixed(1)} m`}
            </b>
            <small>{l === 'en'
              ? `LiDAR heights (BUILD_H) from NLSC Taoyuan 3D Tiles, used only when the NLSC block sits inside the footprint; a footprint with several roof sections takes the tallest. ${flatBlds} footprints with no block inside stay flat, never guessed.`
              : `採國土測繪中心桃園市分棟三維建物 LiDAR 實測高度（BUILD_H），僅在建物塊位於輪廓內時採用；多個屋頂分區取最高。其餘 ${flatBlds} 棟無對應維持平面，絕不推估。`}<br /><M m={hMeta} l={l} /></small>
          </li>
        )}
      </ul>

      {eco && (
        <details className="off">
          <summary>{l === 'en' ? 'Most-recorded species ›' : '紀錄最多的物種 ›'}</summary>
          <ul className="steady">
            {eco.bio.top.slice(0, 8).map(s => (
              <li key={s.sci}><span>{s.vn ?? s.sci} <i>{s.sci}</i></span><b>{s.n}</b></li>
            ))}
          </ul>
        </details>
      )}
      {ndvi && <p className="note">{ndvi.meta.method}. {ndvi.meta.caveat}</p>}
    </>
  );
}
