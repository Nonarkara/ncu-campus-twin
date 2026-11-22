// Twin lens: what the campus holds and what flows through it — green cover, water, wildlife, docks, roads, built volume.
// Every row carries its source, tier and age; a feed that fails renders no row.
import type { Meta } from './shared/today';
import type { Live } from './shared/live';
import { SLOW_KMH } from './shared/live';
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
const TIER: Record<string, string> = { live: '即時', observed: '觀測', modeled: '模式', unavailable: '無資料', 'live-snapshot': '快照' };
const age = (iso: string | null, l: L) => {
  if (!iso) return '—';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (Number.isNaN(m)) return iso;
  if (m < 1) return l === 'en' ? 'now' : '剛剛';
  if (m < 120) return l === 'en' ? `${m}m ago` : `${m} 分前`;
  if (m < 2880) return l === 'en' ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 60)} 時前`;
  return iso.slice(0, 10);
};
const M = ({ m, l }: { m: Meta; l: L }) => <span className="nb">{m.source} · {l === 'en' ? m.tier : TIER[m.tier] ?? m.tier} · {age(m.asOf, l)}</span>;
const DOCK_EN: Record<string, string> = { '500304001': 'Library', '500304032': 'Yiren Hall', '500305053': 'Sports Center' };
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
export interface Ndvi { meta: Meta & { scenes: { date: string }[]; caveat: string; method: string }; green_share_now: number; green_share_prev: number; cells_compared: number; area_m2_compared: number }

export function TwinLens({ eco, ndvi, live, campus, dir, layers, onToggle, l }: {
  eco: Eco | null; ndvi: Ndvi | null; live: Live | null; campus: CampusData | null; dir: Directory | null;
  layers: Set<Layer>; onToggle: (k: Layer) => void; l: L;
}) {
  const delta = ndvi ? Math.round((ndvi.green_share_now - ndvi.green_share_prev) * 10) / 10 : null;
  const blds = campus?.buildings.features ?? [];
  const tall = blds.filter(b => b.properties.height_m !== null).length;
  const ecoMeta = eco ? { source: 'OpenStreetMap', tier: 'observed', asOf: eco.meta.fetchedAt ?? null } : null;
  const main = live?.road.data.filter(f => f.kind === 'main') ?? [];
  const exits = live?.road.data.filter(f => f.kind === 'exit') ?? [];
  const lots = eco?.parking.features.filter(f => f.properties.k !== 'bicycle_rental') ?? [];
  const cap = lots.filter(f => f.properties.capacity !== null);
  const seats = (dir?.categories.flatMap(c => c.entries) ?? [])
    .filter(e => e.capacity?.unit === 'seats' && !(e.note ?? '').startsWith('STALE')).sort((a, b) => b.capacity!.value - a.capacity!.value);
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

      <ul className="steady">
        {main.length > 0 && live && (
          <li>
            <span>{l === 'en' ? 'Freeway 1 at Zhongli exit' : '國道 1 號・中壢交流道'}</span>
            <b>{main.map(f => (
              <span key={f.id} className={f.speed !== null && f.speed < SLOW_KMH ? 'act' : ''}>
                {f.dir === 'S' ? (l === 'en' ? 'S ' : '南 ') : (l === 'en' ? ' N ' : ' 北 ')}{f.speed ?? '—'}
              </span>))} km/h</b>
            <small><M m={live.road.meta} l={l} /></small>
          </li>
        )}
        {exits.length > 0 && live && (
          <li>
            <span>{l === 'en' ? 'Leaving at Zhongli (toward NCU)' : '中壢出口下交流道車流'}</span>
            <b>{exits.map(f => n0(f.vph)).join(' + ')} {l === 'en' ? 'veh/h' : '輛/時'}</b>
            <small><M m={live.road.meta} l={l} /></small>
          </li>
        )}
        {live && live.docks.data.length > 0 && (
          <li>
            <span>{l === 'en' ? 'YouBike bikes / docks' : 'YouBike 車輛／車柱'}</span>
            <b>{live.docks.data.map((d, i) => (
              <span key={d.id} className={d.bikes <= 2 ? 'act' : ''}>{i ? ' · ' : ''}{l === 'en' ? DOCK_EN[d.id] ?? d.en : d.zh.replace('中央大學', '')} {d.bikes}/{d.capacity}</span>))}</b>
            <small><M m={live.docks.meta} l={l} /></small>
          </li>
        )}
        {eco && ecoMeta && (
          <li>
            <span>{l === 'en' ? 'Water on campus' : '校內水體'}</span>
            <b>{eco.onCampusWater.map(w => w.name).join(' · ')}</b>
            <small>{l === 'en' ? 'Campus sits in the 石門大圳 irrigation network; 老街溪 drains east.' : '校區位於石門大圳灌溉水網內，東側為老街溪。'} OSM</small>
          </li>
        )}
        {eco && (
          <li>
            <span>{l === 'en' ? 'Wildlife recorded on campus' : '校內物種紀錄'}</span>
            <b>{n0(eco.bio.species)} {l === 'en' ? 'species' : '種'} · {classes.map(([k, v]) => `${v} ${pick(CLASS[k], l)}`).join(' · ')}</b>
            <small>GBIF · {n0(eco.bio.records)} {l === 'en' ? 'records' : '筆'} {eco.bio.years[0]}–{eco.bio.years[1]} · {l === 'en' ? `${eco.bio.pinned} with ≤50 m position are pinned; the rest are counted, not pinned` : `${eco.bio.pinned} 筆定位 ≤50 m 者標點，其餘僅計數`}</small>
          </li>
        )}
        {seats.length > 0 && (
          <li>
            <span>{l === 'en' ? 'Published seating' : '公開座位數'}</span>
            <b>{seats.slice(0, 4).map(e => `${(e.zh ?? '').replace(/\s*\(.*\)$/, '')} ${n0(e.capacity!.value)}`).join(' · ')}</b>
            <small>{l === 'en' ? 'Official NCU pages; each source is linked in Find. Dorm bed counts are not published.' : '來源為中大官方頁面，於「查詢」逐筆連結。宿舍床位未公開。'}</small>
          </li>
        )}
        {eco && ecoMeta && (
          <li>
            <span>{l === 'en' ? 'Parking areas mapped' : '已標示停車區'}</span>
            <b>{lots.length} {l === 'en' ? 'areas' : '處'} · {l === 'en' ? `capacity known for ${cap.length}` : `${cap.length} 處有容量`} ({n0(cap.reduce((s, f) => s + (f.properties.capacity ?? 0), 0))} {l === 'en' ? 'bike spaces' : '自行車位'})</b>
            <small>{l === 'en' ? 'No current official car or scooter count is published (last: 2014–2020); live counts need 總務處 gate data.' : '現行汽機車格數未公開（最近公布為 2014–2020 年），即時數需總務處柵欄資料。'} OSM</small>
          </li>
        )}
        {campus && (
          <li>
            <span>{l === 'en' ? 'Built volume' : '建物量體'}</span>
            <b>{blds.length} {l === 'en' ? 'buildings' : '棟'} · {l === 'en' ? `${tall} with stated floors drawn in 3D` : `${tall} 棟有樓層資料以立體呈現`}</b>
            <small>{l === 'en'
              ? 'Others are drawn as footprints, never guessed. Measured heights: NLSC 3D building model (by application).'
              : '其餘僅畫平面輪廓，不推估高度。實測高度需向國土測繪中心申請三維建物模型。'}</small>
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
