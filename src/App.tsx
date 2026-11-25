import { AQI_MONITOR, stationFeed, ZHONGLI_STATION } from './shared/station-aqi';
import type { CampusLayers } from './shared/campus-layers';
import { initialAppearance, saveAppearance } from './shared/appearance';
import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { Today, Meta } from './shared/today';
import { CHECK_OPERATOR, SERVICE_LABELS, routes, scheduledRows, serviceDay, taipei, upcoming } from './shared/transit';
import {
  MICROGRID_LOI,
  annualCo2Tonnes,
  simulateIslanding,
  todayPvKwh,
} from './shared/microgrid';
import {
  BUILDING_IDENTITIES,
  CAMPUS_ANCHORS,
  CAMPUS_MAP_SOURCE,
  LAB_PRESET_IDS,
  ON_CAMPUS_STOPS,
  SUBSTATION_ID,
  haversineMeters,
  minutesUntil,
  nearestOnCampusStop,
  polygonCentroid,
  type BuildingFeature,
  type CampusData,
} from './shared/campus';
import timetable from '../data/timetable.json';
import serviceCalendar from '../data/service-calendar.json';
import { TwinLens, type Eco, type Ndvi, type Layer, type VegetationView } from './TwinLens';
import { FindLens, type Directory } from './FindLens';
import type { Lens } from './CampusMap';
import { MapBoundary } from './MapBoundary';
import { DOCK_EN, SLOW_KMH, parseYouBike, type Live } from './shared/live';
import type { NewsPayload } from './shared/news';
import { HeadwayStrip, HourlyStrip, IslandChart, SolarSeasons, type SolarSeason, type MetricKey } from './Charts';
import { NewsCorpusPanel, NewsTicker } from './NewsWire';
import { NbsInspector, type NbsDataset } from './NbsInspector';

async function fetchFeed<T>(url: string, signal: AbortSignal, cache?: RequestCache): Promise<T> {
  const response = await fetch(url, { cache, signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
  if (!response.ok) throw new Error(`Feed returned ${response.status}`);
  return response.json() as Promise<T>;
}

function pollFeed<T>(load: (signal: AbortSignal) => Promise<T>, apply: (data: T) => void, fail: () => void) {
  const lifetime = new AbortController();
  let pending = false;
  const refresh = () => {
    if (document.hidden || pending) return;
    pending = true;
    void load(lifetime.signal)
      .then(data => { if (!lifetime.signal.aborted) apply(data); })
      .catch(() => { if (!lifetime.signal.aborted) fail(); })
      .finally(() => { pending = false; });
  };
  refresh();
  const timer = setInterval(refresh, 300000);
  document.addEventListener('visibilitychange', refresh);
  return () => {
    lifetime.abort();
    clearInterval(timer);
    document.removeEventListener('visibilitychange', refresh);
  };
}

const CampusMap = lazy(() => import('./CampusMap').then(m => ({ default: m.CampusMap })));

type L = 'en' | 'zh';

const T = {
  today: ['Today', '今日'],
  twin: ['Twin', '孿生'],
  find: ['Find', '查詢'],
  power: ['Microgrid', '微電網'],
  move: ['Move', '交通'],
  needs: ['need a decision today', '項需今日決策'],
  none: ['No exceptions in available feeds.', '現有資料未顯示異常。'],
  steady: ['Campus pulse', '校園即時脈動'],
  off: ['internal feeds not connected yet', '項校內系統尚未串接'],
  by: ['by', '於'],
  owner: ['Owner', '負責'],
  rule: ['Rule', '規則'],
  loading: ['Loading open feeds…', '讀取開放資料中…'],
  err: ['Feeds unreachable. Nothing shown is guessed.', '資料源無法連線，不顯示任何推估值。'],
} as const;

const tr = (k: keyof typeof T, l: L) => T[k][l === 'en' ? 0 : 1];
const pick = (p: readonly [string, string] | string, l: L) => (typeof p === 'string' ? p : l === 'en' ? p[0] : p[1]);
const TIER: Record<string, string> = { live: '即時', forecast: '預報', modeled: '模式', schedule: '班表', unavailable: '無資料', stale: '已過時' };

function age(iso: string | null, l: L) {
  if (!iso) return '—';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (Number.isNaN(m)) return iso;
  if (m < 1) return l === 'en' ? 'now' : '剛剛';
  if (m < 120) return l === 'en' ? `${m}m ago` : `${m} 分前`;
  if (m < 2880) return l === 'en' ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 60)} 時前`;
  return iso.slice(0, 10);
}

const MetaLine = ({ m, l }: { m: Meta; l: L }) => (
  <span className="nb">{m.source} · {l === 'en' ? m.tier : TIER[m.tier] ?? m.tier} · {age(m.asOf, l)}</span>
);

const OPERATOR_TIMETABLES = {
  taipei: 'https://www.tpebus.com.tw/image/9025.pdf',
  hsr: 'https://ebus.tycg.gov.tw/ebus/',
  inbound: 'https://ebus.tycg.gov.tw/ebus/',
};

function revealInspector() {
  if (window.innerWidth >= 900) return;
  requestAnimationFrame(() => document.querySelector('.inspector')?.scrollIntoView({
    block: 'start',
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  }));
}

function fmtCountdown(mins: number, l: L) {
  if (mins <= 0) return l === 'en' ? 'now' : '即將到站';
  if (mins < 60) return l === 'en' ? `in ${mins}m` : `${mins} 分後`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return l === 'en' ? `in ${h}h ${m}m` : `${h} 時 ${m} 分後`;
}

function BuildingInspector({
  building,
  campus,
  today,
  dir,
  inPortfolio,
  onTogglePortfolio,
  onClose,
  l,
}: {
  building: BuildingFeature;
  campus: CampusData;
  today: Today | null;
  dir: Directory | null;
  inPortfolio: boolean;
  onTogglePortfolio: (id: string) => void;
  onClose: () => void;
  l: L;
}) {
  const p = building.properties;
  const anchor = CAMPUS_ANCHORS[p.id];
  const identity = BUILDING_IDENTITIES.get(p.id);
  const zh = identity?.zh ?? p.name;
  const en = identity?.en ?? p.name_en;
  const center = polygonCentroid(building.geometry.coordinates[0]);
  const subFeat = campus.buildings.features.find(f => f.properties.id === SUBSTATION_ID);
  const subDist = subFeat && p.id !== SUBSTATION_ID
    ? haversineMeters(center, polygonCentroid(subFeat.geometry.coordinates[0]))
    : null;
  const nearStop = nearestOnCampusStop(center, campus.stops.features);
  const todayKwh = today && p.kwp > 0 ? todayPvKwh(p.kwp, today.hourly) : null;
  const lowKwp = +(p.kwp * 0.5).toFixed(1);
  const co2 = p.kwh_yr > 0 ? annualCo2Tonnes(p.kwh_yr) : 0;
  const UNIT_ZH: Record<string, string> = { seats: '席', beds: '床', spaces: '格' };
  const fmtUnit = (u: string) => (l === 'en' ? u : UNIT_ZH[u] ?? u);
  const units = useMemo(
    () => (dir ? dir.categories.flatMap(c => c.entries).filter(e => e.osm === p.id && e.url !== CAMPUS_MAP_SOURCE.sourceUrl) : []),
    [dir, p.id],
  );

  return (
    <aside className="inspector" aria-label={l === 'en' ? 'Building dossier' : '建物資訊'}>
      <div className="insp-head">
        <div>
          <strong>{(l === 'en' ? en ?? zh : zh) ?? (l === 'en' ? 'Unnamed building' : '未命名建物')}</strong>
          {zh && en && l === 'en' && <span className="subname"> {zh}</span>}
          {anchor && <span className="tag">{pick(anchor.tag, l)}</span>}
        </div>
        <button className="xbtn" onClick={onClose} aria-label={l === 'en' ? 'Close inspector' : '關閉'}>×</button>
      </div>
      {anchor && <p className="insp-note">{pick(anchor.note, l)}</p>}
      <dl className="kv">
        <div>
          <dt>{l === 'en' ? 'Footprint / height' : '投影面積／高度'}</dt>
          <dd>
            {p.area_m2.toLocaleString()} m² ·{' '}
            {p.height_m !== null
              ? <>
                  {p.height_m} m{p.levels ? ` (${p.levels}F)` : ''}
                  <small>
                    {p.height_tier === 'observed'
                      ? (l === 'en' ? 'NLSC LiDAR' : '國土測繪光達')
                        + (p.height_mdate ? ` · ${p.height_mdate.slice(0, 4)}-${p.height_mdate.slice(4)}` : '')
                        + ((p.nlsc_n ?? 0) > 0
                          ? (l === 'en' ? ` · ${p.nlsc_n} roof ${p.nlsc_n === 1 ? 'section' : 'sections'}` : `・${p.nlsc_n} 個屋頂分區`)
                            + ((p.nlsc_n ?? 0) > 1 ? ` · ${p.nlsc_min}–${p.height_m} m` : '')
                          : '')
                      : (l === 'en' ? 'OSM floors × 3.5 m (modeled)' : 'OSM 樓層 × 3.5 m（模式）')}
                  </small>
                </>
              : (l === 'en' ? 'height unknown (drawn flat)' : '無實測高度（維持平面）')}
            {identity && <small>
              <a href={CAMPUS_MAP_SOURCE.sourceUrl} target="_blank" rel="noopener noreferrer">
                {l === 'en' ? 'NCU campus map' : '中大校園圖'} · {identity.grid} #{identity.number}{identity.code && ` · ${identity.code}`}
              </a> · {CAMPUS_MAP_SOURCE.asOf}
            </small>}
          </dd>
        </div>
        {p.kwp > 0 && (
          <div>
            <dt>{l === 'en' ? 'Rooftop PV (screen)' : '屋頂光電（篩選）'}</dt>
            <dd>
              {Math.round(lowKwp)}–{Math.round(p.kwp)} kWp · {Math.round(p.kwh_yr / 1000)} MWh/yr · {co2} t CO₂e/yr
              {todayKwh !== null && (
                <small>
                  {l === 'en'
                    ? `~${todayKwh.toLocaleString()} kWh today (high case · Open-Meteo GHI)`
                    : `今日預估 ~${todayKwh.toLocaleString()} kWh（高情境・Open-Meteo 日照）`}
                </small>
              )}
            </dd>
          </div>
        )}
        {subDist !== null && (
          <div>
            <dt>{l === 'en' ? 'To HV Substation' : '距高壓變電站'}</dt>
            <dd>{subDist} m {l === 'en' ? '(straight-line, not cable)' : '（直線距離，非電纜路徑）'}</dd>
          </div>
        )}
        {nearStop && (
          <div>
            <dt>{l === 'en' ? 'Nearest bus stop' : '最近校內公車站'}</dt>
            <dd>{nearStop.name} · {nearStop.distanceM} m {l === 'en' ? 'straight-line' : '直線距離'}</dd>
          </div>
        )}
        {units.length > 0 && (
          <div>
            <dt>{l === 'en' ? `Official units (${units.length})` : `校內單位（${units.length}）`}</dt>
            <dd className="insp-units">
              {units.slice(0, 4).map((u, i) => (
                <div key={i}>
                  <a href={u.url} target="_blank" rel="noopener noreferrer">{l === 'en' ? (u.en ?? u.zh) : (u.zh ?? u.en)}</a>
                  {u.capacity && !u.capacity.stale && <> · {u.capacity.value.toLocaleString('en-US')} {fmtUnit(u.capacity.unit)}</>}
                  {u.tels?.[0] && <> · <a href={u.tels[0].href}>{u.tels[0].label}</a></>}
                </div>
              ))}
              {units.length > 4 && <small>+{units.length - 4} {l === 'en' ? 'more in Find' : '項詳見「查詢」'}</small>}
            </dd>
          </div>
        )}
      </dl>
      <div className="insp-foot">
        <span className="meta">OSM {p.id} · {p.kind}</span>
        {p.kwp > 0 && (
          <button
            className={`actbtn ${inPortfolio ? 'on' : ''}`}
            onClick={() => onTogglePortfolio(p.id)}
          >
            {inPortfolio
              ? (l === 'en' ? '✓ In microgrid' : '✓ 已納入微電網')
              : (l === 'en' ? '+ Add to microgrid' : '+ 納入微電網')}
          </button>
        )}
      </div>
    </aside>
  );
}

function TodayLens({
  t,
  err,
  campus,
  live,
  news,
  onSelectBuilding,
  l,
}: {
  t: Today | null;
  err: boolean;
  campus: CampusData | null;
  live: Live | null;
  news: NewsPayload | null;
  onSelectBuilding: (id: string) => void;
  l: L;
}) {
  const [metric, setMetric] = useState<MetricKey>('ghi');
  if (err && !t) return <p className="note">{tr('err', l)}</p>;
  if (!t) return <p className="note">{tr('loading', l)}</p>;

  // Live operational alerts from Freeway 1 & YouBike (only when live feeds report an actual threshold breach)
  const liveItems = [...t.items];
  const station = live?.stationAqi;
  const aqiMeta = station && stationFeed(station.data, Date.now()).meta;
  const aqiKm = (haversineMeters([121.1916, 24.9684], ZHONGLI_STATION) / 1000).toFixed(1);
  const mainRoad = live?.road.data.filter(f => f.kind === 'main') ?? [];
  const slowRoad = mainRoad.filter(f => f.speed !== null && f.speed < SLOW_KMH);
  if (slowRoad.length > 0 && live) {
    liveItems.push({
      id: 'road-slow',
      level: 'watch',
      owner: '總務處 General Affairs',
      by: null,
      rule: `House rule: N1 Zhongli IC < ${SLOW_KMH} km/h`,
      meta: live.road.meta,
      title: ['Freeway 1 slow at Zhongli exit', '國道 1 號中壢交流道壅塞'],
      detail: [
        slowRoad.map(f => `${f.dir === 'S' ? 'S' : 'N'} ${f.speed} km/h`).join(' · ') + ' — expect 9025A delays',
        slowRoad.map(f => `${f.dir === 'S' ? '南向' : '北向'} ${f.speed} km/h`).join('・') + '，9025A 往臺北恐延誤',
      ],
    });
  }
  const emptyDocks = live?.docks.data.filter(d => d.bikes === 0 || d.free === 0) ?? [];
  if (emptyDocks.length > 0 && live) {
    liveItems.push({
      id: 'youbike-balance',
      level: 'watch',
      owner: 'YouBike / 總務處',
      by: null,
      rule: 'House rule: 0 bikes or 0 empty docks on campus',
      meta: live.docks.meta,
      title: ['YouBike dock needs rebalancing', '校內 YouBike 場站需調度'],
      detail: [
        emptyDocks.map(d => `${DOCK_EN[d.id] ?? d.en} ${d.bikes}/${d.capacity}`).join(' · '),
        emptyDocks.map(d => `${d.zh.replace('中央大學', '')} ${d.bikes}/${d.capacity}`).join('・'),
      ],
    });
  }

  const act = liveItems.filter(i => i.level === 'act').length;
  const pv250Today = todayPvKwh(MICROGRID_LOI.plannedPvKwp, t.hourly);
  const anchorKeys = ['way/268824891', 'way/268841454', 'way/202690841', 'way/217833430', 'way/202805788', 'way/270806669'];

  return (
    <>
      {!err && t.forecastMeta.tier === 'unavailable' && (
        <p className="note" role="status">{l === 'en' ? 'Weather forecast unavailable.' : '天氣預報暫時無法取得。'}</p>
      )}
      {err && (
        <p className="note" role="status">
          {l === 'en' ? 'Refresh failed. Showing the previous bulletin from' : '更新失敗。仍顯示上一份公告：'}{' '}
          <time dateTime={t.now}>{new Date(t.now).toLocaleString(l === 'en' ? 'en-GB' : 'zh-TW', {
            timeZone: 'Asia/Taipei', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          })} TPE</time>
        </p>
      )}
      <div className="hero">
        <b className={act ? 'act' : ''}>{liveItems.length}</b>
        <p>
          {liveItems.length
            ? (l === 'en' ? (liveItems.length === 1 ? 'needs a decision today' : 'need a decision today') : tr('needs', l))
            : tr('none', l)}
        </p>
      </div>

      {liveItems.length > 0 && (
        <ul className="items">
          {liveItems.map(i => (
            <li key={i.id} className={`item ${i.level}`}>
              <h3>{pick(i.title, l)}</h3>
              <p>{pick(i.detail, l)}</p>
              <p className="meta">
                {tr('owner', l)}: {i.owner}{i.by && <> · {tr('by', l)} {i.by}</>} · {tr('rule', l)}: {i.rule}<br />
                <MetaLine m={i.meta} l={l} />
              </p>
            </li>
          ))}
        </ul>
      )}

      {t.hourly.length > 0 && (
        <div className="strip-box">
          <div className="strip-head">
            <h2 className="h">{l === 'en' ? 'Next 24 h' : '未來 24 小時'}</h2>
            <div className="seg" role="group" aria-label="Metric">
              {([
                ['ghi', l === 'en' ? 'Solar' : '日照'],
                ['precip', l === 'en' ? 'Rain' : '雨量'],
                ['temp', l === 'en' ? 'Temp' : '氣溫'],
                ['gust', l === 'en' ? 'Wind' : '陣風'],
              ] as [MetricKey, string][]).map(([k, lbl]) => (
                <button key={k} aria-pressed={metric === k} onClick={() => setMetric(k)}>{lbl}</button>
              ))}
            </div>
          </div>
          <HourlyStrip hourly={t.hourly} metric={metric} l={l} />
          {pv250Today !== null && (
            <p className="meta">
              {l === 'en'
                ? `250 kWp planned array: ~${pv250Today.toLocaleString()} kWh next 24 h · `
                : `250 kWp 規劃案場未來 24 時預估 ~${pv250Today.toLocaleString()} kWh · `}
              <MetaLine m={t.forecastMeta} l={l} />
            </p>
          )}
        </div>
      )}

      <h2 className="h">{tr('steady', l)}</h2>
      <ul className="steady">
        {aqiMeta && (
          <li>
            <span>{l === 'en' ? 'Zhongli station AQI' : '中壢測站 AQI'}</span>
            <b>{aqiMeta.tier === 'live' ? station?.data?.aqi
              : aqiMeta.tier === 'stale' ? (l === 'en' ? 'Out of date' : '資料已過時')
                : (l === 'en' ? 'Unavailable' : '暫無資料')}</b>
            <small>
              <a href={AQI_MONITOR} target="_blank" rel="noopener noreferrer">{l === 'en' ? 'MOENV' : '環境部'}</a>
              {' · '}{l === 'en' ? `${aqiKm} km from campus centre` : `距校園中心 ${aqiKm} 公里`}
              {aqiMeta.asOf && <> · <time dateTime={aqiMeta.asOf}>
                {new Date(aqiMeta.asOf).toLocaleString(l === 'en' ? 'en-GB' : 'zh-TW', {
                  timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  hourCycle: 'h23',
                })} TPE
              </time></>}
            </small>
          </li>
        )}
        {t.steady.map(s => (
          <li key={s.id}>
            <span>{pick(s.label, l)}</span> <b>{pick(s.value, l)}</b>
            <small><MetaLine m={s.meta} l={l} />
              {Object.hasOwn(OPERATOR_TIMETABLES, s.id) && <> · <a href={s.meta.tier === 'unavailable' ? OPERATOR_TIMETABLES[s.id as keyof typeof OPERATOR_TIMETABLES] : timetable.sourceUrl} target="_blank" rel="noopener noreferrer">{l === 'en' ? 'Timetable' : '班表'}</a></>}
            </small>
          </li>
        ))}
        {mainRoad.length > 0 && live && (
          <li>
            <span>{l === 'en' ? 'Freeway 1 · Zhongli IC' : '國道 1 號・中壢交流道'}</span>
            <b>{mainRoad.map(f => `${f.dir === 'S' ? (l === 'en' ? 'S ' : '南 ') : (l === 'en' ? 'N ' : '北 ')}${f.speed ?? '—'}`).join(' · ')} km/h</b>
            <small><MetaLine m={live.road.meta} l={l} /></small>
          </li>
        )}
        {live && live.docks.data.length > 0 && (
          <li>
            <span>{l === 'en' ? 'YouBike on campus' : '校內 YouBike'}</span>
            <b>{live.docks.data.reduce((s, d) => s + d.bikes, 0)} / {live.docks.data.reduce((s, d) => s + d.capacity, 0)} {l === 'en' ? 'bikes' : '輛可借'}</b>
            <small><MetaLine m={live.docks.meta} l={l} /></small>
          </li>
        )}
      </ul>

      {campus && (
        <>
          <h2 className="h">{l === 'en' ? 'Key campus nodes' : '關鍵校園節點'}</h2>
          <div className="anchors">
            {anchorKeys.map(id => {
              const a = CAMPUS_ANCHORS[id];
              const f = campus.buildings.features.find(b => b.properties.id === id);
              if (!a || !f) return null;
              return (
                <button key={id} className="anchor-btn" onClick={() => onSelectBuilding(id)}>
                  <span>{f.properties.name}</span>
                  <small>{pick(a.tag, l)}</small>
                </button>
              );
            })}
          </div>
        </>
      )}

      <NewsCorpusPanel news={news} l={l} />

      <details className="off">
        <summary>{t.slots.length} {tr('off', l)} ›</summary>
        <ul>
          {t.slots.map(s => (
            <li key={s.id}>
              {pick(s.label, l)}
              <small>{l === 'en' ? 'needs' : '需'} {s.needs} · {s.owner}</small>
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}

interface SolarB { id: string; name: string | null; name_en: string | null; kwp: number; kwh_yr: number; area_m2: number }

function PowerLens({
  today,
  solar,
  portfolioIds,
  onTogglePortfolio,
  onSetPortfolio,
  onFocusBuilding,
  l,
}: {
  today: Today | null;
  solar: any;
  portfolioIds: Set<string>;
  onTogglePortfolio: (id: string) => void;
  onSetPortfolio: (ids: string[]) => void;
  onFocusBuilding: (id: string) => void;
  l: L;
}) {
  const [loadKw, setLoadKw] = useState(600);
  const [useSelected, setUseSelected] = useState(false);
  const [season, setSeason] = useState<SolarSeason | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/data/solar-season.json', { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error('Solar history unavailable'); return r.json() as Promise<SolarSeason>; })
      .then(setSeason).catch(() => {});
    return () => controller.abort();
  }, []);

  if (!solar) return <p className="note">{tr('loading', l)}</p>;

  const allB: SolarB[] = solar.buildings;
  const selectedB = allB.filter(b => portfolioIds.has(b.id));
  const selectedKwp = +selectedB.reduce((s, b) => s + b.kwp, 0).toFixed(1);
  const selectedKwhYr = selectedB.reduce((s, b) => s + b.kwh_yr, 0);

  const activeKwp = useSelected && selectedKwp > 0 ? selectedKwp : MICROGRID_LOI.plannedPvKwp;
  const sim = simulateIslanding({
    installedKwp: activeKwp,
    criticalLoadKw: loadKw,
    hourly: today?.hourly ?? [],
    horizonHours: 8,
  });

  const named: SolarB[] = allB.filter(b => b.name).slice(0, 10);
  const max = named[0]?.kwp ?? 1;
  const a = solar.meta.assumptions;
  const co2Selected = annualCo2Tonnes(selectedKwhYr);
  const pctOfPlan = Math.round((selectedKwp / MICROGRID_LOI.plannedPvKwp) * 100);

  return (
    <>
      <div className="hero">
        <b className={sim.passes4h ? '' : 'act'}>
          {sim.capped ? `${sim.enduranceHours}+ h` : `${sim.enduranceHours} h`}
        </b>
        <p>
          {sim.inverterOverload
            ? (l === 'en' ? 'OVERLOAD · exceeds 1 MW PCS limit' : '超載・超過 1 MW 變流器上限')
            : sim.passes4h
              ? (l === 'en' ? 'PASS ≥4 h islanding · 1 MW / 3 MWh BESS' : '通過 ≥4 小時孤島・1 MW / 3 MWh 儲能')
              : (l === 'en' ? 'FAIL <4 h LOI target · shed load or add PV' : '未達 4 小時目標・需卸載或擴充光電')}
        </p>
      </div>

      <IslandChart sim={sim} l={l} />

      <div className="ctrl-block">
        <div className="ctrl-row">
          <label htmlFor="load-slider">
            {l === 'en' ? 'Critical lab load' : '精密實驗室關鍵負荷'}: <b>{loadKw} kW</b>
          </label>
          <span className="meta">{l === 'en' ? 'scenario · modeled' : '情境輸入・模式'}</span>
        </div>
        <input
          id="load-slider"
          type="range"
          min={250}
          max={1000}
          step={50}
          value={loadKw}
          onChange={e => setLoadKw(Number(e.target.value))}
          className="slider"
        />
        <div className="ctrl-row">
          <div className="seg" role="group" aria-label={l === 'en' ? 'PV array source' : '光電陣列來源'}>
            <button aria-pressed={!useSelected} onClick={() => setUseSelected(false)}>
              {l === 'en' ? 'LOI 250 kWp' : '規劃 250 kWp'}
            </button>
            <button
              aria-pressed={useSelected}
              onClick={() => {
                if (!selectedB.length) onSetPortfolio(LAB_PRESET_IDS);
                setUseSelected(true);
              }}
            >
              {l === 'en'
                ? `Selected (${selectedB.length} · ${Math.round(selectedKwp)} kWp)`
                : `自選屋頂（${selectedB.length} 棟・${Math.round(selectedKwp)} kWp）`}
            </button>
          </div>
        </div>
        <p className="meta">
          {l === 'en'
            ? `PV assist next 4 h: ${sim.pvAssistKwh4h} kWh · Peak battery draw: ${sim.peakNetDrawKw} / 1,000 kW`
            : `未來 4 時光電輔助 ${sim.pvAssistKwh4h} kWh · 電池尖峰放電 ${sim.peakNetDrawKw} / 1,000 kW`}
        </p>
      </div>

      <div className="strip-head">
        <h2 className="h">
          {l === 'en'
            ? <>Siting portfolio ({selectedB.length} roofs · {Math.round(selectedKwp)} <span className="unit-case">kWp</span>)</>
            : <>選址組合（{selectedB.length} 棟・{Math.round(selectedKwp)} <span className="unit-case">kWp</span>）</>}
        </h2>
        <div className="seg">
          <button onClick={() => { onSetPortfolio(LAB_PRESET_IDS); setUseSelected(true); }}>
            {l === 'en' ? 'EE + Labs' : '電機+精密'}
          </button>
          <button onClick={() => { onSetPortfolio([]); setUseSelected(false); }}>
            {l === 'en' ? 'Clear' : '清除'}
          </button>
        </div>
      </div>

      {selectedB.length > 0 ? (
        <p className="meta">
          {l === 'en'
            ? <>{pctOfPlan}% of 250 kWp Phase 1 · {Math.round(selectedKwhYr / 1000).toLocaleString()} MWh/yr · {co2Selected.toLocaleString()} t <span className="nb">CO₂e/yr</span> avoided (MOEA 0.474 kg/kWh)</>
            : <>達第一期 250 kWp 之 {pctOfPlan}% · 年發電 {Math.round(selectedKwhYr / 1000).toLocaleString()} MWh · 減碳 {co2Selected.toLocaleString()} 公噸 <span className="nb">CO₂e/年</span></>}
        </p>
      ) : (
        <p className="meta">
          {l === 'en'
            ? `Campus ceiling: ${(solar.total_kwp_low / 1000).toFixed(1)}–${(solar.total_kwp / 1000).toFixed(1)} MWp across ${solar.buildings.length} roofs. Click roofs on the map or below to site.`
            : `全校屋頂潛力 ${(solar.total_kwp_low / 1000).toFixed(1)}–${(solar.total_kwp / 1000).toFixed(1)} MWp（${solar.buildings.length} 棟）。點選地圖或下方屋頂加入微電網。`}
        </p>
      )}

      <h2 className="h">{l === 'en' ? 'Largest named roofs (click name to focus, + to site)' : '最大屋頂（點名稱定位，+ 納入）'}</h2>
      <ul className="bars">
        {named.map(b => {
          const picked = portfolioIds.has(b.id);
          return (
            <li key={b.id} className={picked ? 'picked' : ''}>
              <button className="row-link" onClick={() => onFocusBuilding(b.id)}>
                {l === 'en' ? (b.name_en ?? b.name) : b.name}
              </button>
              <span className="row-val">{Math.round(b.kwp)}</span>
              <button
                className={`row-add ${picked ? 'on' : ''}`}
                onClick={() => onTogglePortfolio(b.id)}
                aria-label={picked ? 'Remove from microgrid' : 'Add to microgrid'}
              >
                {picked ? '✓' : '+'}
              </button>
              <i style={{ width: `${(b.kwp / max) * 100}%` }} />
            </li>
          );
        })}
      </ul>

      {season && <SolarSeasons season={season} installedKwp={activeKwp} pr={a.pr} l={l} />}

      <h2 className="h">{l === 'en' ? 'Campus energy projects' : '校園能源計畫'}</h2>
      <dl className="rows energy-reference">
        <div>
          <dt><a href="https://ncusec.ncu.edu.tw/news/press_content.php?P_ID=45733" target="_blank" rel="noopener noreferrer">{l === 'en' ? 'NCU × Taipower' : '中大 × 台電'}</a></dt>
          <dd>{l === 'en' ? 'Planned · 1 MW / 3 MWh battery · 250 kWp PV' : '規劃中・1 MW / 3 MWh 儲能・250 kWp 光電'}
            <small className="meta">2026-03-13</small>
          </dd>
        </div>
        <div>
          <dt><a href="https://herc.ncu.edu.tw/zh/microgrid/" target="_blank" rel="noopener noreferrer">{l === 'en' ? 'HERC demonstration' : '氫能中心示範'}</a></dt>
          <dd>{l === 'en' ? 'Approx. 82 kW PV · 20 kW fuel cell · 110 kWh battery' : '約 82 kW 光電・20 kW 燃料電池・110 kWh 儲能'}
            <small className="meta">{l === 'en' ? 'Source checked 2026-11-24' : '來源查核 2026-11-24'}</small>
          </dd>
        </div>
        <div>
          <dt><a href="https://ncusec.ncu.edu.tw/news/headlines_content.php?H_ID=3556" target="_blank" rel="noopener noreferrer">{l === 'en' ? 'White Energy House' : '白色能源屋'}</a></dt>
          <dd>{l === 'en' ? 'Demonstration home · rooftop PV, storage and energy management' : '示範住宅・整合屋頂光電、儲能與能源管理'}</dd>
        </div>
      </dl>

      <details className="off">
        <summary>{l === 'en' ? 'Model assumptions & sources ›' : '模型假設與資料來源 ›'}</summary>
        <dl className="rows">
          <div><dt>{l === 'en' ? 'Microgrid LOI' : '微電網意向書'}</dt><dd>{solar.planned_source}</dd></div>
          <div><dt>{l === 'en' ? 'Usable roof' : '可用屋頂'}</dt><dd>{a.usableRoofLow * 100}–{a.usableRoof * 100}% · {a.kwpPerM2 * 1000} W/m² · PR {a.pr}</dd></div>
          <div><dt>{l === 'en' ? '2025 GHI / CO₂' : '2025 日照／排碳'}</dt><dd>{a.ghi_kwh_m2_yr} kWh/m² · 0.474 kg CO₂e/kWh (MOEA 2024)</dd></div>
          <div><dt>{l === 'en' ? 'Campus load' : '校園用電'}</dt><dd>{l === 'en' ? 'Not public — slider is scenario input only, needs 總務處 AMI' : '未公開，拉桿僅為情境輸入，需總務處電表'}</dd></div>
        </dl>
        <p className="note">{a.note} <MetaLine m={{ source: solar.meta.source, tier: solar.meta.tier, asOf: '2025' }} l={l} /></p>
      </details>
    </>
  );
}

function MoveLens({
  clock,
  selectedStopName,
  onSelectStop,
  live,
  onFocusCoord,
  l,
}: {
  clock: ReturnType<typeof taipei>;
  selectedStopName: string | null;
  onSelectStop: (name: string, trigger: HTMLButtonElement) => void;
  live: Live | null;
  onFocusCoord: (coord: [number, number]) => void;
  l: L;
}) {
  const { hm } = clock;
  const day = serviceDay(clock);
  const verified = day !== 'unverified';
  const taipeiUp = upcoming(routes.toTaipei.rows, routes.toTaipei.col, hm, day);
  const nextTaipei = taipeiUp[0];
  const nextTaipeiMin = nextTaipei ? minutesUntil(hm, nextTaipei[2]) : null;
  const mainRoad = live?.road.data.filter(f => f.kind === 'main') ?? [];

  const block = (k: keyof typeof routes, label: [string, string]) => {
    const { rows: schedule, col } = routes[k];
    const rows = upcoming(schedule, col, hm, day).slice(0, 5);
    const multi = new Set(rows.map(r => r[0])).size > 1;
    const firstMin = rows[0] ? minutesUntil(hm, rows[0][col]) : null;
    return (
      <li>
        <span>
          {pick(label, l)}
          {firstMin !== null && <em className="cd"> · {fmtCountdown(firstMin, l)}</em>}
        </span>
        <b className="times">
          {rows.length
            ? rows.map((r, i) => <span key={i} className="t">{r[col]}{multi && <sub>{r[0]}</sub>}</span>)
            : (verified ? (l === 'en' ? 'none left in timetable' : '班表今日已無班次') : <a href={k === 'toTaipei' ? OPERATOR_TIMETABLES.taipei : OPERATOR_TIMETABLES.inbound} target="_blank" rel="noopener noreferrer">{pick(CHECK_OPERATOR, l)}</a>)}
        </b>
      </li>
    );
  };

  const todayTimes = ({ rows, col }: typeof routes[keyof typeof routes]) =>
    scheduledRows(rows, day).map(r => r[col]);

  const tracks = [
    { label: '9025A', times: todayTimes(routes.toTaipei), highlight: true },
    { label: '172/173', times: todayTimes(routes.toHSR) },
    { label: '132/133', times: todayTimes(routes.toCampus) },
  ];

  const inboundUp = upcoming(routes.toCampus.rows, routes.toCampus.col, hm, day);
  const hasScheduledTrips = inboundUp.length > 0 || upcoming(routes.toHSR.rows, routes.toHSR.col, hm, day).length > 0;
  const needTransfer = verified && (!nextTaipei || (nextTaipeiMin !== null && nextTaipeiMin > 90));

  return (
    <>
      <div className="hero">
        <b className={verified && !taipeiUp.length ? 'act' : ''}>{verified ? taipeiUp.length : '—'}</b>
        <p>
          {!verified ? <a className="operator-link" href={OPERATOR_TIMETABLES.taipei} target="_blank" rel="noopener noreferrer">{pick(CHECK_OPERATOR, l)}</a> : nextTaipei && nextTaipeiMin !== null
            ? (l === 'en'
              ? `9025A to Taipei scheduled · next ${nextTaipei[2]} (${fmtCountdown(nextTaipeiMin, l)})`
              : `班 9025A 往臺北（班表）・下班 ${nextTaipei[2]}（${fmtCountdown(nextTaipeiMin, l)}）`)
            : (l === 'en'
              ? 'No more campus stops in the 9025A timetable'
              : '9025A 班表今日已無繞駛中大班次')}
        </p>
      </div>

      {needTransfer && (
        <div className="advice">
          <strong>
            {hasScheduledTrips
              ? (l === 'en' ? 'NCU transfer advice' : '中大轉乘建議')
              : (l === 'en' ? 'After scheduled bus hours' : '今日公車班次已結束')}
          </strong>
          <p>
            {hasScheduledTrips
              ? (l === 'en'
                ? 'For the 佑民醫院 (Youmin Hospital) transfer, confirm a campus departure and the main-line 9025 connection with the operators.'
                : '如需在佑民醫院轉乘，請先向業者確認中大出發班次及 9025 主線銜接。')
              : (l === 'en'
                ? 'The published 9025A, 172/173, and inbound 132/133 schedules show no remaining trips. Check the operator for other services.'
                : '9025A、172/173 與 132/133 進校班表今日已無後續班次。其他班次請向業者查詢。')}
          </p>
        </div>
      )}

      {verified && <div className="strip-box">
        <div className="strip-head">
          <h2 className="h">{l === 'en' ? 'Daily headway' : '全日班距分布'} · {pick(SERVICE_LABELS[day], l)}</h2>
          <span className="meta">{hm} TPE</span>
        </div>
        <HeadwayStrip nowHm={hm} tracks={tracks} l={l} />
      </div>}

      <h2 className="h">{l === 'en' ? 'On-campus stops (300 m radius)' : '校內公車站（顯示 300 m 半徑）'}</h2>
      <div className="stops-grid">
        {ON_CAMPUS_STOPS.map(name => (
          <button
            key={name}
            className="stop-btn"
            aria-pressed={selectedStopName === name}
            onClick={e => onSelectStop(name, e.currentTarget)}
          >
            {name}
          </button>
        ))}
      </div>

      <ul className="steady">
        {block('toTaipei', ['9025A → Taipei, at NCU stop', '9025A 往臺北，中大站約'])}
        {block('toHSR', ['172 / 173 → HSR Taoyuan', '172 / 173 往高鐵桃園站'])}
        {block('toCampus', ['132 / 133 Zhongli → NCU', '132 / 133 中壢 → 中大'])}
        {mainRoad.length > 0 && live && (
          <li>
            <span>{l === 'en' ? 'Freeway 1 (9025A corridor)' : '國道 1 號（9025A 路廊）'}</span>
            <b>
              {mainRoad.map((f, i) => (
                <Fragment key={f.id}>
                  {i > 0 && ' · '}
                  <button className={`inline-jump ${f.speed !== null && f.speed < SLOW_KMH ? 'act' : ''}`}
                    onClick={() => onFocusCoord([f.lon, f.lat])}>
                    {f.dir === 'S' ? (l === 'en' ? 'S ' : '南 ') : (l === 'en' ? 'N ' : '北 ')}{f.speed ?? '—'}
                  </button>
                </Fragment>
              ))} km/h
            </b>
            <small><MetaLine m={live.road.meta} l={l} /></small>
          </li>
        )}
        {live && live.docks.data.length > 0 && (
          <li>
            <span>{l === 'en' ? 'YouBike docks' : 'YouBike 場站'}</span>
            <b>
              {live.docks.data.map((d, i) => (
                <Fragment key={d.id}>
                  {i > 0 && ' · '}
                  <button className={`inline-jump ${d.bikes <= 2 ? 'act' : ''}`} onClick={() => onFocusCoord([d.lon, d.lat])}>
                    {l === 'en' ? DOCK_EN[d.id] ?? d.en : d.zh.replace('中央大學', '')} {d.bikes}/{d.capacity}
                  </button>
                </Fragment>
              ))}
            </b>
            <small><MetaLine m={live.docks.meta} l={l} /></small>
          </li>
        )}
      </ul>

      <p className="note">
        {l === 'en' ? 'Campus stop times are scheduled estimates.' : '中大站時間為班表預估。'}{' '}
        <a href={timetable.sourceUrl} target="_blank" rel="noopener noreferrer">{l === 'en' ? 'NCU timetable' : '中大班表'} · {timetable.asOf}</a>
        {' · '}<a href={serviceCalendar.sourceUrl} target="_blank" rel="noopener noreferrer">{l === 'en' ? 'Academic calendar' : '校曆'}</a>
      </p>
    </>
  );
}

export function App() {
  const [l, setL] = useState<L>(() => (navigator.language.startsWith('zh') ? 'zh' : 'en'));
  const [lens, setLens] = useState<Lens>('today');
  const [appearance, setAppearance] = useState(initialAppearance);
  const dark = appearance === 'dark';
  const [clock, setClock] = useState(() => taipei(new Date()));

  const [today, setToday] = useState<Today | null>(null);
  const [todayErr, setTodayErr] = useState(false);
  const [campus, setCampus] = useState<CampusData | null>(null);
  const [solar, setSolar] = useState<any>(null);

  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [selectedStopName, setSelectedStopName] = useState<string | null>(null);
  const [portfolioIds, setPortfolioIds] = useState<Set<string>>(() => new Set(LAB_PRESET_IDS));
  const [focusCoord, setFocusCoord] = useState<{ coord: [number, number]; seq: number; stopRadius?: true } | null>(null);
  const [query, setQuery] = useState('');
  const [eco, setEco] = useState<Eco | null>(null);
  const [campusLayers, setCampusLayers] = useState<CampusLayers | null>(null);
  const [layerError, setLayerError] = useState(false);
  const [layerAttempt, setLayerAttempt] = useState(0);
  const [ndvi, setNdvi] = useState<Ndvi | null>(null);
  const [ndviError, setNdviError] = useState(false);
  const [ndviAttempt, setNdviAttempt] = useState(0);
  const [vegetationView, setVegetationView] = useState<VegetationView>('latest');
  const [nbs, setNbs] = useState<NbsDataset | null>(null);
  const [selectedNbsId, setSelectedNbsId] = useState<string | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [news, setNews] = useState<NewsPayload | null>(null);
  const [dir, setDir] = useState<Directory | null>(null);
  const [layers, setLayers] = useState<Set<Layer>>(() => new Set<Layer>(['b3d', 'nbs', 'green', 'water', 'flow']));
  const toggleLayer = (k: Layer) => setLayers(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });

  // Each feed can render as soon as it arrives and has its own request deadline.
  useEffect(() => {
    const emptyRoad: Live['road'] = { data: [], meta: { source: 'Freeway Bureau VD (MOTC)', tier: 'unavailable', asOf: null } };
    const emptyDocks: Live['docks'] = { data: [], meta: { source: 'YouBike 2.0 station feed', tier: 'unavailable', asOf: null } };
    const applyDocks = (docks: Live['docks']) => setLive(prev => ({ ...prev, road: prev?.road ?? emptyRoad, docks }));
    const stopRoad = pollFeed(async signal => {
      const data = await fetchFeed<Pick<Live, 'road' | 'stationAqi'>>('/api/live', signal);
      return { road: Array.isArray(data.road?.data) && data.road.meta ? data.road : emptyRoad, stationAqi: data.stationAqi };
    }, data => setLive(prev => ({ docks: prev?.docks ?? emptyDocks, ...data })),
    () => setLive(prev => ({ docks: prev?.docks ?? emptyDocks, road: emptyRoad,
      stationAqi: prev?.stationAqi && { data: null, meta: { ...prev.stationAqi.meta, tier: 'unavailable' } },
    })));
    const stopDocks = pollFeed(async signal => {
      const rows = await fetchFeed<unknown[]>('https://apis.youbike.com.tw/json/station-yb2.json', signal);
      if (!Array.isArray(rows)) throw new Error('Invalid YouBike feed');
      const now = Date.now();
      const data = parseYouBike(rows).filter(d => {
        const elapsed = now - Date.parse(d.at);
        return elapsed >= 0 && elapsed < 30 * 60e3;
      });
      return data.length
        ? { data, meta: { ...emptyDocks.meta, tier: 'live' as const, asOf: data.map(d => d.at).sort().at(-1) ?? null } }
        : emptyDocks;
    }, applyDocks, () => applyDocks(emptyDocks));
    const stopNews = pollFeed(async signal => {
      const result = await fetchFeed<NewsPayload>('/api/news', signal);
      if (!Array.isArray(result?.items) || !result.meta || !result.stats) throw new Error('Invalid news feed');
      return result;
    }, setNews, () => setNews(prev => prev && { ...prev, meta: { ...prev.meta, tier: 'stale' } }));
    return () => { stopRoad(); stopDocks(); stopNews(); };
  }, []);

  // Heavy Twin layers (eco + Sentinel-2 NDVI grid + NbS field survey) load on first visit to Twin
  useEffect(() => {
    if (lens !== 'twin') return;
    if (!eco) fetch('/data/eco.json').then(r => r.json() as Promise<Eco>).then(setEco).catch(() => {});
    if (!nbs) fetch('/data/nbs.json').then(r => r.json() as Promise<NbsDataset>).then(setNbs).catch(() => {});
  }, [lens, eco, nbs]);
  useEffect(() => {
    if (lens !== 'twin' || ndvi) return;
    const controller = new AbortController();
    setNdviError(false);
    void fetchFeed<Ndvi>('/data/ndvi.json', controller.signal)
      .then(dataset => {
        if (!dataset?.meta?.scenes?.length || !dataset?.latest || !Array.isArray(dataset.grid?.features)) {
          throw new Error('Invalid satellite layer');
        }
        if (!controller.signal.aborted) setNdvi(dataset);
      })
      .catch(() => { if (!controller.signal.aborted) setNdviError(true); });
    return () => controller.abort();
  }, [lens, ndvi, ndviAttempt]);
  useEffect(() => {
    if (lens !== 'twin' || campusLayers) return;
    const controller = new AbortController();
    setLayerError(false);
    void fetchFeed<CampusLayers>('/data/campus-layers.json', controller.signal)
      .then(data => {
        if (!data?.meta?.asOf || !Array.isArray(data.parking?.features) || !Array.isArray(data.paths?.features)) {
          throw new Error('Invalid campus layers');
        }
        if (!controller.signal.aborted) setCampusLayers(data);
      })
      .catch(() => { if (!controller.signal.aborted) setLayerError(true); });
    return () => controller.abort();
  }, [lens, campusLayers, layerAttempt]);
  const selectNbs = (id: string) => {
    setSelectedBuildingId(null);
    setSelectedNbsId(id);
    const it = nbs?.items.find(x => x.id === id);
    if (it?.coord) setFocusCoord(prev => ({ coord: it.coord!, seq: (prev?.seq ?? 0) + 1 }));
    revealInspector();
  };
  const twin = useMemo(
    () => ({ campusLayers, eco, ndvi, vegetationView, live, nbs, selectedNbsId, onSelectNbs: selectNbs, layers }),
    [campusLayers, eco, ndvi, vegetationView, live, nbs, selectedNbsId, layers],
  );

  useEffect(() => {
    const id = setInterval(() => setClock(taipei(new Date())), 30000);
    return () => clearInterval(id);
  }, []);

  // Numeric lens shortcuts are scoped to the tablist, with Alt as the global modifier.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.target instanceof HTMLElement && (e.target.matches('input, textarea, select') || e.target.isContentEditable)) return;
      const inTabs = e.target instanceof HTMLElement && !!e.target.closest('[role="tablist"]');
      if ((inTabs || e.altKey) && /^Digit[1-5]$/.test(e.code)) {
        const tab = document.querySelectorAll<HTMLButtonElement>('.tabs [role="tab"]')[Number(e.code.at(-1)) - 1];
        e.preventDefault();
        tab?.click();
        tab?.focus();
      } else if ((inTabs || e.altKey) && e.code === 'Slash') {
        const searchInput = [...document.querySelectorAll<HTMLInputElement>('input[type="search"]')]
          .find(input => input.getClientRects().length);
        e.preventDefault();
        if (searchInput) searchInput.focus();
        else {
          setLens('find');
          requestAnimationFrame(() => document.querySelector<HTMLInputElement>('input.search.find')?.focus());
        }
      } else if (e.key === 'Escape' && !e.altKey) {
        setSelectedBuildingId(null);
        setSelectedNbsId(null);
        setSelectedStopName(null);
        setQuery('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    document.documentElement.lang = l === 'en' ? 'en' : 'zh-Hant';
  }, [l]);

  useEffect(() => {
    const stopToday = pollFeed(async signal => {
      const j = await fetchFeed<Today>('/api/today', signal, 'no-cache');
      if (!j?.now || !j.forecastMeta || !Array.isArray(j.items) || !Array.isArray(j.steady)) throw new Error('Invalid Today bulletin');
      return { ...j, hourly: j.hourly ?? [], slots: j.slots ?? [] };
    }, j => { setToday(j); setTodayErr(false); }, () => setTodayErr(true));
    fetch('/data/campus.json').then(r => r.json() as Promise<CampusData>).then(setCampus).catch(() => {});
    fetch('/data/solar.json').then(r => r.json()).then(setSolar).catch(() => {});
    fetch('/data/directory.json').then(r => r.json() as Promise<Directory>).then(setDir).catch(() => {});
    return stopToday;
  }, []);

  // On phone the map sits under the panel: bring it into view so the action has visible feedback.
  // A tap on the phone map opens the inspector far up the panel: bring it into view so the tap visibly does something.
  const inspectFromMap = useRef(false);
  useEffect(() => {
    if (!selectedBuildingId || !inspectFromMap.current) return;
    inspectFromMap.current = false;
    revealInspector();
  }, [selectedBuildingId]);
  const shownForLayers = useRef(false); // first layer toggle on phone reveals the map once, later ones don't yank the page
  const mapReturn = useRef<HTMLElement | null>(null);
  const showMap = (trigger?: HTMLElement) => {
    if (window.innerWidth >= 900) return;
    mapReturn.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    requestAnimationFrame(() => {
      const region = document.getElementById('map-region');
      region?.focus({ preventScroll: true });
      region?.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
  };
  const returnFromMap = () => {
    const previous = mapReturn.current;
    if (previous?.isConnected && previous !== document.body) previous.focus();
    else document.getElementById(`lens-tab-${lens}`)?.focus();
  };
  const focusBuilding = (id: string) => {
    setSelectedBuildingId(id);
    setQuery('');
    const f = campus?.buildings.features.find(b => b.properties.id === id);
    if (f) {
      setFocusCoord(prev => ({ coord: polygonCentroid(f.geometry.coordinates[0]), seq: (prev?.seq ?? 0) + 1 }));
    }
  };

  const focusStop = (name: string | null) => {
    setSelectedStopName(prev => (prev === name ? null : name));
    if (!name || !campus) return;
    const s = campus.stops.features.find(f => f.properties.name === name);
    if (s) {
      setFocusCoord(prev => ({ coord: s.geometry.coordinates, stopRadius: true, seq: (prev?.seq ?? 0) + 1 }));
    }
  };

  const togglePortfolio = (id: string) => {
    setPortfolioIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedBuilding = useMemo(
    () => (campus && selectedBuildingId ? campus.buildings.features.find(f => f.properties.id === selectedBuildingId) ?? null : null),
    [campus, selectedBuildingId],
  );

  const searchHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !campus) return [];
    return campus.buildings.features
      .filter(f => {
        const n = (f.properties.name ?? '').toLowerCase();
        const en = (f.properties.name_en ?? '').toLowerCase();
        const identity = BUILDING_IDENTITIES.get(f.properties.id);
        return n.includes(q) || en.includes(q) || !!identity && (identity.zh.includes(q) || identity.en.toLowerCase().includes(q));
      })
      .slice(0, 6);
  }, [query, campus]);

  const openSearchHit = (id: string) => {
    focusBuilding(id);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.inspector .xbtn')?.focus());
  };
  const tabs = useMemo(() => (['today', 'twin', 'power', 'move', 'find'] as Lens[]), []);

  return (
    <div className="app">
      <section className="panel">
        <header className="bar">
          <div className="brand">中央大學 <span>NCU Twin</span></div>
          <div>
            <span className="clock">{clock.date} {clock.hm} TPE</span>
            <button className="lang" onClick={() => setL(l === 'en' ? 'zh' : 'en')} aria-label={l === 'en' ? 'Switch to Traditional Chinese' : '切換英文'}>
              {l === 'en' ? <><b>EN</b> / 中</> : <>EN / <b>中</b></>}
            </button>
            <button
              className="appearance"
              aria-label={dark ? (l === 'en' ? 'Switch to light mode' : '切換淺色模式') : (l === 'en' ? 'Switch to dark mode' : '切換深色模式')}
              title={dark ? (l === 'en' ? 'Light mode' : '淺色模式') : (l === 'en' ? 'Dark mode' : '深色模式')}
              onClick={() => {
                const next = dark ? 'light' : 'dark';
                saveAppearance(next);
                setAppearance(next);
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                {dark ? <><circle cx="12" cy="12" r="4" /><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2" /></>
                  : <path d="M21 14a9 9 0 0 1-11-11 9 9 0 1 0 11 11Z" />}
              </svg>
            </button>
          </div>
        </header>

        <div className="nav-row">
          <nav className="tabs" role="tablist" aria-label={l === 'en' ? 'Campus views' : '校園檢視'} onKeyDown={e => {
            const current = tabs.indexOf(lens);
            const next = e.key === 'ArrowRight' ? (current + 1) % tabs.length
              : e.key === 'ArrowLeft' ? (current + tabs.length - 1) % tabs.length
              : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
            if (next === null) return;
            e.preventDefault();
            setLens(tabs[next]);
            document.getElementById(`lens-tab-${tabs[next]}`)?.focus();
          }}>
            {tabs.map((k, i) => (
              <button key={k} id={`lens-tab-${k}`} role="tab" tabIndex={lens === k ? 0 : -1} aria-controls={`lens-panel-${k}`} aria-keyshortcuts={`Alt+${i + 1}`} aria-selected={lens === k} onClick={() => setLens(k)}>
                {tr(k, l)}
              </button>
            ))}
          </nav>
          <div className="search-wrap">
            <input
              type="search"
              className="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') setQuery('');
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && searchHits.length) {
                  e.preventDefault();
                  openSearchHit(searchHits[0].properties.id);
                }
              }}
              placeholder={l === 'en' ? 'Search mapped buildings…' : '搜尋有地圖的建物…'}
              aria-label={l === 'en' ? 'Find campus building' : '搜尋校內建物'}
            />
          </div>
        </div>

        {query.trim() && campus && !searchHits.length && (
          <p className="note" role="status">{l === 'en' ? 'No mapped building matches.' : '找不到符合的地圖建物。'}</p>
        )}
        {searchHits.length > 0 && (
          <ul className="search-hits">
            {searchHits.map(f => (
              <li key={f.properties.id}>
                <button onClick={() => openSearchHit(f.properties.id)}>
                  <span>{f.properties.name}{(BUILDING_IDENTITIES.get(f.properties.id)?.en ?? f.properties.name_en) && ` · ${BUILDING_IDENTITIES.get(f.properties.id)?.en ?? f.properties.name_en}`}</span>
                  <small>{f.properties.area_m2} m²{f.properties.kwp ? ` · ${Math.round(f.properties.kwp)} kWp` : ''}</small>
                </button>
              </li>
            ))}
          </ul>
        )}

        {selectedNbsId && nbs && (
          <NbsInspector
            dataset={nbs}
            selectedId={selectedNbsId}
            onSelect={selectNbs}
            onClose={() => setSelectedNbsId(null)}
            l={l}
          />
        )}

        {selectedBuilding && campus && (
          <BuildingInspector
            building={selectedBuilding}
            campus={campus}
            today={today}
            dir={dir}
            inPortfolio={portfolioIds.has(selectedBuilding.properties.id)}
            onTogglePortfolio={togglePortfolio}
            onClose={() => {
              setSelectedBuildingId(null);
              document.querySelector<HTMLInputElement>('.search-wrap input')?.focus();
            }}
            l={l}
          />
        )}

        {tabs.filter(k => k !== lens).map(k => (
          <div key={k} id={`lens-panel-${k}`} role="tabpanel" aria-labelledby={`lens-tab-${k}`} hidden />
        ))}
        <div id={`lens-panel-${lens}`} role="tabpanel" aria-labelledby={`lens-tab-${lens}`}>
        {(lens === 'today' || lens === 'twin') && (
          <button className="tomap" onClick={e => showMap(e.currentTarget)}>{l === 'en' ? 'Campus map ↓' : '校園地圖 ↓'}</button>
        )}
        {lens === 'today' && (
          <TodayLens t={today} err={todayErr} campus={campus} live={live} news={news} onSelectBuilding={focusBuilding} l={l} />
        )}
        {lens === 'twin' && ndviError && (
          <div className="feed-notice">
            <p role="status">{l === 'en' ? 'Satellite comparison unavailable.' : '衛星影像比較暫時無法載入。'}</p>
            <button onClick={() => setNdviAttempt(n => n + 1)}>{l === 'en' ? 'Retry' : '重試'}</button>
          </div>
        )}
        {lens === 'twin' && (
          <TwinLens
            eco={eco}
            campusLayers={campusLayers}
            layerError={layerError}
            onRetryLayers={() => setLayerAttempt(n => n + 1)}
            ndvi={ndvi}
            vegetationView={vegetationView}
            onVegetationView={setVegetationView}
            live={live}
            campus={campus}
            dir={dir}
            nbs={nbs}
            selectedNbsId={selectedNbsId}
            onSelectNbs={selectNbs}
            layers={layers}
            onToggle={(k, trigger) => {
              toggleLayer(k);
              const newOverlay = k === 'students' || k === 'parking';
              if (newOverlay ? !layers.has(k) && !!campusLayers : !shownForLayers.current) {
                shownForLayers.current = true;
                showMap(trigger);
              }
            }}
            onFocusCoord={coord => { setFocusCoord(prev => ({ coord, seq: (prev?.seq ?? 0) + 1 })); showMap(); }}
            l={l}
          />
        )}
        {lens === 'find' && <FindLens dir={dir} onFocusBuilding={(id, trigger) => { focusBuilding(id); showMap(trigger); }} l={l} />}
        {lens === 'power' && (
          <PowerLens
            today={today}
            solar={solar}
            portfolioIds={portfolioIds}
            onTogglePortfolio={togglePortfolio}
            onSetPortfolio={ids => setPortfolioIds(new Set(ids))}
            onFocusBuilding={focusBuilding}
            l={l}
          />
        )}
        {lens === 'move' && (
          <MoveLens
            clock={clock}
            selectedStopName={selectedStopName}
            onSelectStop={(name, trigger) => {
              focusStop(name);
              if (selectedStopName !== name) showMap(trigger);
            }}
            live={live}
            onFocusCoord={coord => { setFocusCoord(prev => ({ coord, seq: (prev?.seq ?? 0) + 1 })); showMap(); }}
            l={l}
          />
        )}

        </div>

        <p className="note">
          {l === 'en'
            ? 'Independent open-data prototype; not an official NCU system.'
            : '以開放資料建置之獨立原型，非中央大學官方系統。'}{' '}
          © OpenStreetMap contributors.
        </p>
      </section>

      <div className="map-col" id="map-region" tabIndex={-1} role="region" aria-label={l === 'en' ? 'Campus map' : '校園地圖'}>
        <button className="map-return" onClick={returnFromMap}>{l === 'en' ? '↑ Back to campus details' : '↑ 返回校園資訊'}</button>
        <MapBoundary l={l}>
          <Suspense fallback={<div id="map" className="map map-loading" role="status">{l === 'en' ? 'Loading map…' : '載入地圖中…'}</div>}>
            <CampusMap
              appearance={appearance}
              lens={lens}
              l={l}
              campus={campus}
              selectedBuildingId={selectedBuildingId}
              onSelectBuilding={id => {
                setSelectedNbsId(null);
                if (id === selectedBuildingId) revealInspector();
                else inspectFromMap.current = true;
                focusBuilding(id);
              }}
              portfolioIds={portfolioIds}
              selectedStopName={selectedStopName}
              onSelectStop={focusStop}
              focusCoord={focusCoord}
              twin={twin}
            />
          </Suspense>
        </MapBoundary>
        <NewsTicker news={news} l={l} />
      </div>
    </div>
  );
}
