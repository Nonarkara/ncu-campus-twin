import { useEffect, useMemo, useRef, useState } from 'react';
import type { Today, Meta } from './shared/today';
import { runs, taipei, upcoming } from './shared/today';
import {
  MICROGRID_LOI,
  annualCo2Tonnes,
  simulateIslanding,
  todayPvKwh,
} from './shared/microgrid';
import {
  CAMPUS_ANCHORS,
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
import { CampusMap, type Lens } from './CampusMap';
import { TwinLens, type Eco, type Ndvi, type Layer } from './TwinLens';
import { FindLens, type Directory } from './FindLens';
import { parseYouBike, type Live } from './shared/live';
import { HeadwayStrip, HourlyStrip, IslandChart, type MetricKey } from './Charts';

type L = 'en' | 'zh';
type Row = [string, string, string, string];

const T = {
  today: ['Today', '今日'],
  twin: ['Twin', '孿生'],
  find: ['Find', '查詢'],
  power: ['Microgrid', '微電網'],
  move: ['Move', '交通'],
  needs: ['need a decision today', '項需今日決策'],
  none: ['No active exceptions. Next check in 5 min.', '目前無異常需決策，5 分鐘後再檢。'],
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
const TIER: Record<string, string> = { live: '即時', forecast: '預報', modeled: '模式', schedule: '班表', unavailable: '無資料' };

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
  inPortfolio,
  onTogglePortfolio,
  onClose,
  l,
}: {
  building: BuildingFeature;
  campus: CampusData;
  today: Today | null;
  inPortfolio: boolean;
  onTogglePortfolio: (id: string) => void;
  onClose: () => void;
  l: L;
}) {
  const p = building.properties;
  const anchor = CAMPUS_ANCHORS[p.id];
  const center = polygonCentroid(building.geometry.coordinates[0]);
  const subFeat = campus.buildings.features.find(f => f.properties.id === SUBSTATION_ID);
  const subDist = subFeat && p.id !== SUBSTATION_ID
    ? haversineMeters(center, polygonCentroid(subFeat.geometry.coordinates[0]))
    : null;
  const nearStop = nearestOnCampusStop(center, campus.stops.features);
  const todayKwh = today && p.kwp > 0 ? todayPvKwh(p.kwp, today.hourly) : null;
  const lowKwp = +(p.kwp * 0.5).toFixed(1);
  const co2 = p.kwh_yr > 0 ? annualCo2Tonnes(p.kwh_yr) : 0;

  return (
    <aside className="inspector" aria-label={l === 'en' ? 'Building dossier' : '建物資訊'}>
      <div className="insp-head">
        <div>
          <strong>{(l === 'en' ? p.name_en ?? p.name : p.name) ?? (l === 'en' ? 'Unnamed building' : '未命名建物')}</strong>
          {p.name && p.name_en && l === 'en' && <span className="subname"> {p.name}</span>}
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
            {p.levels ? `${p.levels}F (${p.height_m} m)` : (l === 'en' ? 'height unknown in OSM' : 'OSM 無樓高資料')}
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
            <dd>{nearStop.name} · {nearStop.distanceM} m (~{nearStop.walkMin} {l === 'en' ? 'min walk' : '分步行'})</dd>
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
  onSelectBuilding,
  l,
}: {
  t: Today | null;
  err: boolean;
  campus: CampusData | null;
  onSelectBuilding: (id: string) => void;
  l: L;
}) {
  const [metric, setMetric] = useState<MetricKey>('ghi');
  if (err && !t) return <p className="note">{tr('err', l)}</p>;
  if (!t) return <p className="note">{tr('loading', l)}</p>;

  const act = t.items.filter(i => i.level === 'act').length;
  const pv250Today = todayPvKwh(MICROGRID_LOI.plannedPvKwp, t.hourly);
  const anchorKeys = ['way/268824891', 'way/268841454', 'way/202690841', 'way/217833430', 'way/202805788', 'way/270806669'];

  return (
    <>
      <div className="hero">
        <b className={act ? 'act' : ''}>{t.items.length}</b>
        <p>{t.items.length ? tr('needs', l) : tr('none', l)}</p>
      </div>

      {t.items.length > 0 && (
        <ul className="items">
          {t.items.map(i => (
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
        {t.steady.map(s => (
          <li key={s.id}>
            <span>{pick(s.label, l)}</span> <b>{pick(s.value, l)}</b>
            <small><MetaLine m={s.meta} l={l} /></small>
          </li>
        ))}
      </ul>

      {campus && (
        <>
          <h2 className="h">{l === 'en' ? 'Key campus nodes (click to inspect)' : '關鍵校園節點（點選檢視）'}</h2>
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
      <a className="tomap" href="#map">{l === 'en' ? 'Campus map ↓' : '校園地圖 ↓'}</a>
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
            ? `Siting portfolio (${selectedB.length} roofs · ${Math.round(selectedKwp)} kWp)`
            : `選址組合（${selectedB.length} 棟・${Math.round(selectedKwp)} kWp）`}
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
            ? `${pctOfPlan}% of 250 kWp Phase 1 · ${Math.round(selectedKwhYr / 1000).toLocaleString()} MWh/yr · ${co2Selected.toLocaleString()} t CO₂e/yr avoided (MOEA 0.474 kg/kWh)`
            : `達第一期 250 kWp 之 ${pctOfPlan}% · 年發電 ${Math.round(selectedKwhYr / 1000).toLocaleString()} MWh · 減碳 ${co2Selected.toLocaleString()} 公噸 CO₂e/年`}
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

      <details className="off">
        <summary>{l === 'en' ? 'Model assumptions & sources ›' : '模型假設與資料來源 ›'}</summary>
        <dl className="rows">
          <div><dt>{l === 'en' ? 'Microgrid LOI' : '微電網意向書'}</dt><dd>{solar.planned_source}</dd></div>
          <div><dt>{l === 'en' ? 'Usable roof' : '可用屋頂'}</dt><dd>{a.usableRoofLow * 100}–{a.usableRoof * 100}% · {a.kwpPerM2 * 1000} W/m² · PR {a.pr}</dd></div>
          <div><dt>{l === 'en' ? '2025 GHI / CO₂' : '2025 日照／排碳'}</dt><dd>{a.ghi_kwh_m2_yr} kWh/m² · 0.474 kg CO₂e/kWh (MOEA 2024)</dd></div>
          <div><dt>{l === 'en' ? 'Campus load' : '校園用電'}</dt><dd>{l === 'en' ? 'Not public — slider is scenario input only, needs 總務處 AMI' : '未公開，拉桿僅為情境輸入，需總務處電表'}</dd></div>
        </dl>
        <p className="note">{a.note} <MetaLine m={{ source: solar.meta.source, tier: solar.meta.tier, asOf: solar.meta.fetchedAt }} l={l} /></p>
      </details>
    </>
  );
}

function MoveLens({
  selectedStopName,
  onSelectStop,
  l,
}: {
  selectedStopName: string | null;
  onSelectStop: (name: string) => void;
  l: L;
}) {
  const { hm, weekend } = taipei(new Date());
  const tt = timetable as any;
  const taipeiUp: Row[] = upcoming(tt.toTaipei.rows, 2, hm, weekend);
  const nextTaipei = taipeiUp[0];
  const nextTaipeiMin = nextTaipei ? minutesUntil(hm, nextTaipei[2]) : null;

  const block = (k: 'toTaipei' | 'toHSR' | 'toCampus', col: 1 | 2, label: [string, string]) => {
    const rows: Row[] = upcoming(tt[k].rows, col, hm, weekend).slice(0, 5);
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
            : (l === 'en' ? 'none left today' : '今日已無班次')}
        </b>
      </li>
    );
  };

  const todayTimes = (rows: Row[], col: 1 | 2) =>
    rows.filter(r => runs(r[3], weekend)).map(r => r[col]);

  const tracks = [
    { label: '9025A', times: todayTimes(tt.toTaipei.rows, 2), highlight: true },
    { label: '172/173', times: todayTimes(tt.toHSR.rows, 1) },
    { label: '132/133', times: todayTimes(tt.toCampus.rows, 2) },
  ];

  const needTransfer = !nextTaipei || (nextTaipeiMin !== null && nextTaipeiMin > 90);

  return (
    <>
      <div className="hero">
        <b className={taipeiUp.length ? '' : 'act'}>{taipeiUp.length}</b>
        <p>
          {nextTaipei && nextTaipeiMin !== null
            ? (l === 'en'
              ? `9025A to Taipei left · next ${nextTaipei[2]} (${fmtCountdown(nextTaipeiMin, l)})`
              : `班 9025A 往臺北・下班 ${nextTaipei[2]}（${fmtCountdown(nextTaipeiMin, l)}）`)
            : (l === 'en'
              ? 'No 9025A campus stops left today'
              : '今日已無 9025A 繞駛中大班次')}
        </p>
      </div>

      {needTransfer && (
        <div className="advice">
          <strong>{l === 'en' ? 'NCU transfer advice' : '中大轉乘建議'}</strong>
          <p>
            {l === 'en'
              ? 'Take 132 / 133 to Youmin Hospital (佑民醫院) and transfer to main-line 9025. Parking: NT$30/h.'
              : '請搭 132 / 133 至佑民醫院轉乘主線 9025 往臺北。校內臨停費率 NT$30/時。'}
          </p>
        </div>
      )}

      <div className="strip-box">
        <div className="strip-head">
          <h2 className="h">{l === 'en' ? `Daily headway (${weekend ? 'weekend' : 'weekday'})` : `全日班距分布（${weekend ? '假日' : '平日'}）`}</h2>
          <span className="meta">{hm} TPE</span>
        </div>
        <HeadwayStrip nowHm={hm} tracks={tracks} l={l} />
      </div>

      <h2 className="h">{l === 'en' ? 'On-campus stops (300 m catchment)' : '校內公車站（點選顯示 300 m 步行圈）'}</h2>
      <div className="stops-grid">
        {ON_CAMPUS_STOPS.map(name => (
          <button
            key={name}
            className="stop-btn"
            aria-pressed={selectedStopName === name}
            onClick={() => onSelectStop(name)}
          >
            {name}
          </button>
        ))}
      </div>

      <ul className="steady">
        {block('toTaipei', 2, ['9025A → Taipei, at NCU stop', '9025A 往臺北，中大站約'])}
        {block('toHSR', 1, ['172 / 173 → HSR Taoyuan', '172 / 173 往高鐵桃園站'])}
        {block('toCampus', 2, ['132 / 133 Zhongli → NCU', '132 / 133 中壢 → 中大'])}
      </ul>

      <p className="note">
        {l === 'en'
          ? <>{weekend ? 'Weekend' : 'Weekday'} schedule. {tt.caveats.join(' ')} {tt.source}.</>
          : <>{weekend ? '假日' : '平日'}班表。中大站時間為客運預估，即時位置需 TDX。資料：中大總務處事務組對外交通資訊（115.02.26）。</>}
      </p>
    </>
  );
}

export function App() {
  const [l, setL] = useState<L>(() => (navigator.language.startsWith('zh') ? 'zh' : 'en'));
  const [lens, setLens] = useState<Lens>('today');
  const [clock, setClock] = useState(() => taipei(new Date()));

  const [today, setToday] = useState<Today | null>(null);
  const [todayErr, setTodayErr] = useState(false);
  const [campus, setCampus] = useState<CampusData | null>(null);
  const [solar, setSolar] = useState<any>(null);

  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [selectedStopName, setSelectedStopName] = useState<string | null>(null);
  const [portfolioIds, setPortfolioIds] = useState<Set<string>>(() => new Set(LAB_PRESET_IDS));
  const [focusCoord, setFocusCoord] = useState<{ coord: [number, number]; seq: number } | null>(null);
  const [query, setQuery] = useState('');
  const [eco, setEco] = useState<Eco | null>(null);
  const [ndvi, setNdvi] = useState<any>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [dir, setDir] = useState<Directory | null>(null);
  const [layers, setLayers] = useState<Set<Layer>>(() => new Set<Layer>(['b3d', 'green', 'water', 'flow']));
  const toggleLayer = (k: Layer) => setLayers(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });

  // Twin data loads on first visit to Twin; live feeds refresh every 2 min while Twin is open
  useEffect(() => {
    if (lens !== 'twin') return;
    if (!eco) fetch('/data/eco.json').then(r => r.json() as Promise<Eco>).then(setEco).catch(() => {});
    if (!ndvi) fetch('/data/ndvi.json').then(r => r.json()).then(setNdvi).catch(() => {});
    // Road from our edge (2-min cache); YouBike straight from its CORS-open feed (~0.9 MB gz), so only while visible, every 5 min.
    const load = async () => {
      if (document.hidden) return;
      const [road, yb] = await Promise.allSettled([
        fetch('/api/live').then(r => r.json() as Promise<Pick<Live, 'road'>>),
        fetch('https://apis.youbike.com.tw/json/station-yb2.json').then(r => r.json() as Promise<any[]>),
      ]);
      const docks = yb.status === 'fulfilled' ? parseYouBike(yb.value) : [];
      setLive({
        road: road.status === 'fulfilled' ? road.value.road : { data: [], meta: { source: 'Freeway Bureau VD (MOTC)', tier: 'unavailable', asOf: null } },
        docks: { data: docks, meta: { source: 'YouBike 2.0 station feed', tier: docks.length ? 'live' : 'unavailable', asOf: docks.map(d => d.at).sort().at(-1) ?? null } },
      });
    };
    load();
    const id = setInterval(load, 300000);
    document.addEventListener('visibilitychange', load);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', load); };
  }, [lens]);
  useEffect(() => {
    if ((lens === 'find' || lens === 'twin') && !dir) fetch('/data/directory.json').then(r => r.json() as Promise<Directory>).then(setDir).catch(() => {});
  }, [lens, dir]);
  const twin = useMemo(() => ({ eco, ndvi, live, layers }), [eco, ndvi, live, layers]);

  useEffect(() => {
    const id = setInterval(() => setClock(taipei(new Date())), 30000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    document.documentElement.lang = l === 'en' ? 'en' : 'zh-Hant';
  }, [l]);

  useEffect(() => {
    const loadToday = () =>
      fetch('/api/today')
        .then(r => r.json() as Promise<Today>)
        .then(j => { setToday({ ...j, hourly: j.hourly ?? [], slots: j.slots ?? [], steady: j.steady ?? [], items: j.items ?? [] }); setTodayErr(false); }) // a browser-cached older payload may lack newer fields
        .catch(() => setTodayErr(true));
    loadToday();
    const id = setInterval(loadToday, 300000);
    fetch('/data/campus.json').then(r => r.json() as Promise<CampusData>).then(setCampus).catch(() => {});
    fetch('/data/solar.json').then(r => r.json()).then(setSolar).catch(() => {});
    return () => clearInterval(id);
  }, []);

  // On phone the map sits under the panel: bring it into view so the action has visible feedback.
  const shownForLayers = useRef(false); // first layer toggle on phone reveals the map once, later ones don't yank the page
  const showMap = () => { if (window.innerWidth < 900) document.getElementById('map')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); };
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
      setFocusCoord(prev => ({ coord: s.geometry.coordinates, seq: (prev?.seq ?? 0) + 1 }));
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
        return n.includes(q) || en.includes(q);
      })
      .slice(0, 6);
  }, [query, campus]);

  const tabs = useMemo(() => (['today', 'twin', 'power', 'move', 'find'] as Lens[]), []);

  return (
    <div className="app">
      <section className="panel">
        <header className="bar">
          <div className="brand">中央大學 <span>NCU Twin</span></div>
          <div>
            <span className="clock">{clock.date} {clock.hm} TPE</span>
            <button className="lang" onClick={() => setL(l === 'en' ? 'zh' : 'en')} aria-label="Language">
              {l === 'en' ? <><b>EN</b> / 中</> : <>EN / <b>中</b></>}
            </button>
          </div>
        </header>

        <div className="nav-row">
          <nav className="tabs" role="tablist">
            {tabs.map(k => (
              <button key={k} role="tab" aria-selected={lens === k} onClick={() => setLens(k)}>
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
              placeholder={l === 'en' ? 'Find building…' : '搜尋建物…'}
              aria-label={l === 'en' ? 'Find campus building' : '搜尋校內建物'}
            />
          </div>
        </div>

        {searchHits.length > 0 && (
          <ul className="search-hits">
            {searchHits.map(f => (
              <li key={f.properties.id}>
                <button onClick={() => focusBuilding(f.properties.id)}>
                  <span>{f.properties.name}{f.properties.name_en ? ` · ${f.properties.name_en}` : ''}</span>
                  <small>{f.properties.area_m2} m²{f.properties.kwp ? ` · ${Math.round(f.properties.kwp)} kWp` : ''}</small>
                </button>
              </li>
            ))}
          </ul>
        )}

        {selectedBuilding && campus && (
          <BuildingInspector
            building={selectedBuilding}
            campus={campus}
            today={today}
            inPortfolio={portfolioIds.has(selectedBuilding.properties.id)}
            onTogglePortfolio={togglePortfolio}
            onClose={() => setSelectedBuildingId(null)}
            l={l}
          />
        )}

        {lens === 'today' && (
          <TodayLens t={today} err={todayErr} campus={campus} onSelectBuilding={focusBuilding} l={l} />
        )}
        {lens === 'twin' && (
          <TwinLens eco={eco} ndvi={ndvi as Ndvi | null} live={live} campus={campus} dir={dir} layers={layers} onToggle={k => { toggleLayer(k); if (!shownForLayers.current) { shownForLayers.current = true; showMap(); } }} l={l} />
        )}
        {lens === 'find' && <FindLens dir={dir} onFocusBuilding={id => { focusBuilding(id); showMap(); }} l={l} />}
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
          <MoveLens selectedStopName={selectedStopName} onSelectStop={focusStop} l={l} />
        )}

        <p className="note">
          {l === 'en'
            ? 'Independent open-data prototype; not an official NCU system.'
            : '以開放資料建置之獨立原型，非中央大學官方系統。'}{' '}
          © OpenStreetMap contributors.
        </p>
      </section>

      <CampusMap
        lens={lens}
        l={l}
        campus={campus}
        selectedBuildingId={selectedBuildingId}
        onSelectBuilding={focusBuilding}
        portfolioIds={portfolioIds}
        selectedStopName={selectedStopName}
        onSelectStop={focusStop}
        focusCoord={focusCoord}
        twin={twin}
      />
    </div>
  );
}
