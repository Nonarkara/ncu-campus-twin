// Twin lens: what the campus holds and what flows through it — green cover, water, wildlife, docks, roads, built volume.
// Every row carries its source, tier and age; a feed that fails renders no row.
import { Fragment } from 'react';
import type { Meta } from './shared/today';
import type { Live } from './shared/live';
import { SLOW_KMH, DOCK_EN } from './shared/live';
import type { CampusData } from './shared/campus';
import type { Directory } from './FindLens';
import { NbsGallery, type NbsDataset } from './NbsInspector';

import type { FeatureCollection, Polygon } from 'geojson';

type L = 'en' | 'zh';
export type Layer = 'green' | 'water' | 'bio' | 'flow' | 'b3d' | 'nbs';
export const LAYERS: { k: Layer; t: [string, string] }[] = [
  { k: 'b3d', t: ['3D', '立體'] },
  { k: 'nbs', t: ['NbS', '自然解方'] },
  { k: 'green', t: ['Green', '綠覆'] },
  { k: 'water', t: ['Water', '水系'] },
  { k: 'flow', t: ['Flow', '交通'] },
  { k: 'bio', t: ['Wildlife', '物種'] },
];

const pick = (p: readonly [string, string], l: L) => (l === 'en' ? p[0] : p[1]);
const TIER: Record<string, string> = { live: '即時', observed: '觀測', fetched: '擷取', snapshot: '快照', checked: '查核', modeled: '模式', unavailable: '無資料', 'live-snapshot': '快照' };
const age = (iso: string | null, l: L) => {
  if (!iso) return '—';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (Number.isNaN(m)) return iso;
  if (m < 1) return l === 'en' ? 'now' : '剛剛';
  if (m < 120) return l === 'en' ? `${m}m ago` : `${m} 分前`;
  if (m < 2880) return l === 'en' ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 60)} 時前`;
  return iso.slice(0, 10);
};
// Relative age ('5m ago') only for values meant to be current. Snapshots, records and surveys show their own date.
const REL = new Set(['live', 'forecast', 'modeled']);
const M = ({ m, l }: { m: { source: string; tier: string; asOf: string | null }; l: L }) => (
  <span>{m.source} · {l === 'en' ? m.tier : TIER[m.tier] ?? m.tier} ·{' '}
    <span className="nb">{REL.has(m.tier) ? age(m.asOf, l) : (m.asOf ?? '—').slice(0, 10)}</span>
  </span>
);
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
type Variation = 'higher' | 'lower' | 'other';
type CellCounts = { comparable: number; higher: number; lower: number; other: number };
export type VegetationView = 'latest' | 'repeat';
export interface Ndvi {
  meta: Meta & { scenes: { id: string; date: string; sourceUrl?: string }[]; repeatScene?: { id: string; date: string; sourceUrl?: string }; threshold?: number };
  green_share_now: number;
  green_share_prev: number;
  cells_in_campus: number;
  cells_compared: number;
  latest?: CellCounts;
  repeat?: CellCounts;
  grid: FeatureCollection<Polygon, { v: number; p: number; d: number; shift?: Variation; repeated?: Variation | null }>;
}

export function TwinLens({ eco, ndvi, vegetationView, onVegetationView, live, campus, dir, nbs, selectedNbsId, onSelectNbs, layers, onToggle, onFocusCoord, l }: {
  eco: Eco | null; ndvi: Ndvi | null; vegetationView: VegetationView; onVegetationView: (view: VegetationView) => void;
  live: Live | null; campus: CampusData | null; dir: Directory | null;
  nbs: NbsDataset | null; selectedNbsId: string | null; onSelectNbs: (id: string) => void;
  layers: Set<Layer>; onToggle: (k: Layer) => void; onFocusCoord?: (coord: [number, number]) => void; l: L;
}) {
  const delta = ndvi ? Math.round((ndvi.green_share_now - ndvi.green_share_prev) * 10) / 10 : null;
  const ndviShift = ndvi?.[vegetationView];
  const repeatScene = ndvi?.meta.repeatScene;
  const blds = campus?.buildings.features ?? [];
  const measured = blds.filter(b => b.properties.height_tier === 'observed').length;
  const modeledH = blds.filter(b => b.properties.height_tier === 'modeled').length;
  const flatBlds = blds.filter(b => b.properties.height_m === null).length;
  const maxH = blds.reduce((m, b) => Math.max(m, b.properties.height_m ?? 0), 0);
  const hMeta = campus?.meta.heights
    ? { source: campus.meta.heights.source, tier: 'observed', asOf: surveyMonth(blds) ?? campus.meta.heights.fetchedAt }
    : campus ? { source: 'OpenStreetMap', tier: campus.meta.tier, asOf: campus.meta.fetchedAt } : null;
  const ecoMeta = eco ? { source: 'OpenStreetMap', tier: 'snapshot', asOf: eco.meta.fetchedAt ?? null } : null;
  const main = live?.road.data.filter(f => f.kind === 'main') ?? [];
  const exits = live?.road.data.filter(f => f.kind === 'exit') ?? [];
  const lots = eco?.parking.features.filter(f => f.properties.k !== 'bicycle_rental') ?? [];
  const cap = lots.filter(f => f.properties.capacity !== null);
  const seats = (dir?.categories.flatMap(c => c.entries) ?? [])
    .filter(e => e.capacity?.unit === 'seats' && !(e.note ?? '').startsWith('STALE')).sort((a, b) => b.capacity!.value - a.capacity!.value);
  const bioMeta = eco ? { source: 'GBIF', tier: 'observed', asOf: `${eco.bio.years[0]}–${eco.bio.years[1]}` } : null;
  const dirMeta = dir ? { source: 'ncu.edu.tw', tier: 'checked', asOf: dir.meta.asOf } : null;
  const classes = eco ? Object.entries(eco.bio.byClass).filter(([k]) => CLASS[k]).sort((a, b) => b[1] - a[1]).slice(0, 4) : [];

  return (
    <>
      {ndvi && (
        <div className="hero">
          <b>{ndvi.green_share_now}<small>%</small></b>
          <p>
            {l === 'en' ? 'of compared cells meet the vegetation threshold, ' : '有效網格達植被門檻，'}
            <span className={delta !== null && delta <= -2 ? 'act' : ''}>
              {delta !== null && (delta > 0 ? '+' : '')}{delta}{' '}
              {l === 'en'
                ? <>pts vs <span className="nb">{ndvi.meta.scenes[1].date}</span></>
                : <>個百分點（對比 <span className="nb">{ndvi.meta.scenes[1].date}</span>）</>}
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
      {ndvi && ndviShift && (
        <div className="ndvi-bar">
          {repeatScene && layers.has('green') && (
            <div className="seg" role="group" aria-label={l === 'en' ? 'Vegetation comparison' : '植被比較'}>
              <button aria-pressed={vegetationView === 'latest'} onClick={() => onVegetationView('latest')}>{l === 'en' ? 'Latest pass' : '最新影像'}</button>
              <button aria-pressed={vegetationView === 'repeat'} onClick={() => onVegetationView('repeat')}>{l === 'en' ? 'Repeat change' : '重複變化'}</button>
            </div>
          )}
          <div className="ndvi-track" aria-hidden="true">
            <span className="ndvi-g" style={{ width: `${(ndviShift.higher / ndviShift.comparable) * 100}%` }} />
            <span className="ndvi-s" style={{ width: `${(ndviShift.other / ndviShift.comparable) * 100}%` }} />
            <span className="ndvi-l" style={{ width: `${(ndviShift.lower / ndviShift.comparable) * 100}%` }} />
          </div>
          <p className="meta">
            {l === 'en'
              ? `↑ ${ndviShift.higher} higher · ${ndviShift.other} other · ↓ ${ndviShift.lower} lower`
              : `↑ ${ndviShift.higher} 上升・${ndviShift.other} 其他・↓ ${ndviShift.lower} 下降`}
            {' · '}{l === 'en' ? `${n0(ndviShift.comparable)}/${n0(ndvi.cells_in_campus)} cells` : `${n0(ndviShift.comparable)}/${n0(ndvi.cells_in_campus)} 格`}
            <br />
            {l === 'en' ? '20 m cells · NDVI change ≥ ' : '20 公尺網格・NDVI 變化量 ≥ '}{ndvi.meta.threshold}
            {vegetationView === 'repeat' && repeatScene && <>
              {' · '}{l === 'en' ? 'both 2026 passes' : '兩次 2026 年影像'}{' '}
              <span className="nb">{repeatScene.date}</span> / <span className="nb">{ndvi.meta.asOf}</span>
            </>}
          </p>
        </div>
      )}
      <a className="tomap" href="#map">{l === 'en' ? 'Show campus map ↓' : '查看校園地圖 ↓'}</a>

      {(main.length > 0 || exits.length > 0 || (live && live.docks.data.length > 0)) && live && (
        <>
          <h2 className="h">{l === 'en' ? 'Live sensors (click to focus)' : '即時感測（點選定位）'}</h2>
          <div className="kpi-grid">
            {main.length > 0 && (
              <div className="kpi">
                <span className="kpi-lbl">{l === 'en' ? 'Freeway 1 · Zhongli IC' : '國道 1 號・中壢'}</span>
                <div className="kpi-val">
                  {main.map((f, i) => (
                    <Fragment key={f.id}>
                      {i > 0 && ' · '}
                      <button className={`inline-jump ${f.speed !== null && f.speed < SLOW_KMH ? 'act' : ''}`}
                        onClick={() => onFocusCoord?.([f.lon, f.lat])}>
                        {f.dir === 'S' ? (l === 'en' ? 'S ' : '南 ') : (l === 'en' ? 'N ' : '北 ')}{f.speed ?? '—'}
                      </button>
                    </Fragment>
                  ))} <small className="kpi-meta">km/h</small>
                </div>
                <span className="kpi-meta"><M m={live.road.meta} l={l} /></span>
              </div>
            )}
            {exits.length > 0 && (
              <div className="kpi">
                <span className="kpi-lbl">{l === 'en' ? 'Zhongli exit ramps' : '中壢出口匝道'}</span>
                <div className="kpi-val">
                  {exits.map((f, i) => (
                    <Fragment key={f.id}>
                      {i > 0 && ' + '}
                      <button className="inline-jump" onClick={() => onFocusCoord?.([f.lon, f.lat])}>
                        {n0(Math.round(f.vph / 60))}
                      </button>
                    </Fragment>
                  ))} <small className="kpi-meta">{l === 'en' ? 'veh/min' : '輛/分'}</small>
                </div>
                <span className="kpi-meta">{l === 'en' ? 'Last 1 min · Zhongli area' : '近 1 分鐘・中壢區'}</span>
              </div>
            )}
            {live.docks.data.length > 0 && (
              <div className="kpi wide">
                <span className="kpi-lbl">{l === 'en' ? 'YouBike bikes / docks' : '校內 YouBike 車輛／車柱'}</span>
                <div className="kpi-val sm">
                  {live.docks.data.map((d, i) => (
                    <Fragment key={d.id}>
                      {i > 0 && ' · '}
                      <button className={`inline-jump ${d.bikes <= 2 ? 'act' : ''}`} onClick={() => onFocusCoord?.([d.lon, d.lat])}>
                        {l === 'en' ? DOCK_EN[d.id] ?? d.en : d.zh.replace('中央大學', '')} {d.bikes}/{d.capacity}
                      </button>
                    </Fragment>
                  ))}
                </div>
                <span className="kpi-meta"><M m={live.docks.meta} l={l} /></span>
              </div>
            )}
          </div>
        </>
      )}

      <h2 className="h">{l === 'en' ? 'Campus inventory' : '校園基線盤點'}</h2>
      <dl className="rows">
        {campus && hMeta && (
          <div>
            <dt>{l === 'en' ? '3D volume' : '建物量體'}</dt>
            <dd>
              <b>{blds.length}</b> {l === 'en' ? 'buildings' : '棟'} · {measured} {l === 'en' ? 'NLSC LiDAR' : '棟光達實測'}{modeledH ? ` + ${modeledH} OSM` : ''} · max {maxH.toFixed(1)} m ({flatBlds} {l === 'en' ? 'flat' : '平面'})
              <small><M m={hMeta} l={l} /></small>
            </dd>
          </div>
        )}
        {eco && ecoMeta && (
          <div>
            <dt>{l === 'en' ? 'Waterways' : '校內水系'}</dt>
            <dd>
              {eco.onCampusWater.map(w => w.name).join(' · ')}
              <small><M m={ecoMeta} l={l} /></small>
            </dd>
          </div>
        )}
        {eco && bioMeta && (
          <div>
            <dt>{l === 'en' ? 'Wildlife' : '生態物種'}</dt>
            <dd>
              <b>{n0(eco.bio.species)}</b> {l === 'en' ? 'species' : '種'} · {classes.slice(0, 3).map(([k, v]) => `${v} ${pick(CLASS[k], l)}`).join(' · ')}
              <small><M m={bioMeta} l={l} /> · {n0(eco.bio.records)} {l === 'en' ? 'records' : '筆'} ({eco.bio.pinned} {l === 'en' ? 'pinned' : '標點'})</small>
            </dd>
          </div>
        )}
        {seats.length > 0 && dirMeta && (
          <div>
            <dt>{l === 'en' ? 'Seating' : '公開座位'}</dt>
            <dd>
              {seats.slice(0, 3).map(e => `${(e.zh ?? '').replace(/\s*\(.*\)$/, '')} ${n0(e.capacity!.value)}`).join(' · ')}
              <small><M m={dirMeta} l={l} /></small>
            </dd>
          </div>
        )}
        {eco && ecoMeta && (
          <div>
            <dt>{l === 'en' ? 'Parking' : '停車區'}</dt>
            <dd>
              {lots.length} {l === 'en' ? 'areas' : '處'} · {n0(cap.reduce((s, f) => s + (f.properties.capacity ?? 0), 0))} {l === 'en' ? 'bike spaces' : '自行車位'}
              <small><M m={ecoMeta} l={l} /></small>
            </dd>
          </div>
        )}
      </dl>

      {nbs && <NbsGallery dataset={nbs} selectedId={selectedNbsId} onSelect={onSelectNbs} l={l} />}

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
      {ndvi && (
        <p className="note">
          {l === 'en'
            ? 'NDVI measures a vegetation signal. The cover threshold is 0.4. Repeat change uses two 2026 passes against the same 2025 reference. Check the site before assigning a cause.'
            : 'NDVI 反映植被訊號，植被門檻為 0.4。重複變化為兩次 2026 年影像對比同一張 2025 年影像。成因須現地查證。'}{' '}
          <a href="https://sentiwiki.copernicus.eu/web/s2-processing" target="_blank" rel="noopener noreferrer">{l === 'en' ? 'Sentinel-2 method' : 'Sentinel-2 處理方法'}</a>
          {[...ndvi.meta.scenes, ...(repeatScene ? [repeatScene] : [])]
            .filter(scene => scene.sourceUrl).sort((a, b) => a.date.localeCompare(b.date)).map(scene => (
              <Fragment key={scene.id}>{' · '}<a href={scene.sourceUrl} target="_blank" rel="noopener noreferrer">{scene.date}</a></Fragment>
            ))}
        </p>
      )}
    </>
  );
}
