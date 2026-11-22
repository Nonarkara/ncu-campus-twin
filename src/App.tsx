import { useEffect, useMemo, useState } from 'react';
import type { Today, Meta } from './shared/today';
import { taipei, upcoming } from './shared/today';
import timetable from '../data/timetable.json';
import { CampusMap, type Lens } from './CampusMap';

type L = 'en' | 'zh';
const T = {
  today: ['Today', '今日'], power: ['Power', '能源'], move: ['Move', '交通'],
  needs: ['need a decision today', '項需今日決策'], none: ['Nothing needs a decision. Next check in 5 min.', '目前無需決策事項，5 分鐘後再檢查。'],
  steady: ['Steady', '常態'], off: ['Not connected yet', '尚未串接'], by: ['by', '於'], owner: ['Owner', '負責'],
  rule: ['Rule', '規則'], loading: ['Loading open feeds…', '讀取開放資料中…'], err: ['Feeds unreachable. Nothing shown is guessed.', '資料源無法連線，不顯示任何推估值。'],
} as const;
const tr = (k: keyof typeof T, l: L) => T[k][l === 'en' ? 0 : 1];
const pick = (p: readonly [string, string], l: L) => (l === 'en' ? p[0] : p[1]);

function age(iso: string | null) {
  if (!iso) return '—';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (Number.isNaN(m)) return iso;
  if (m < 1) return 'now'; if (m < 120) return `${m} min ago`; if (m < 2880) return `${Math.round(m / 60)} h ago`;
  return iso.slice(0, 10);
}
const MetaLine = ({ m }: { m: Meta }) => <span>{m.source} · {m.tier} · {age(m.asOf)}</span>;

function TodayLens({ l }: { l: L }) {
  const [t, setT] = useState<Today | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    const load = () => fetch('/api/today').then(r => r.json() as Promise<Today>).then(j => { setT(j); setErr(false); }).catch(() => setErr(true));
    load(); const id = setInterval(load, 300000); return () => clearInterval(id);
  }, []);
  if (err && !t) return <p className="note">{tr('err', l)}</p>;
  if (!t) return <p className="note">{tr('loading', l)}</p>;
  const act = t.items.filter(i => i.level === 'act').length;
  return <>
    <div className="hero">
      <b className={act ? 'act' : ''}>{t.items.length}</b>
      <p>{t.items.length ? tr('needs', l) : tr('none', l)}</p>
    </div>
    {t.items.length > 0 && <ul className="items">{t.items.map(i => (
      <li key={i.id} className={`item ${i.level}`}>
        <h3>{pick(i.title, l)}</h3>
        <p>{pick(i.detail, l)}</p>
        <p className="meta">{tr('owner', l)}: {i.owner}{i.by && <> · {tr('by', l)} {i.by}</>} · {tr('rule', l)}: {i.rule}<br /><MetaLine m={i.meta} /></p>
      </li>))}</ul>}
    <h2 className="h">{tr('steady', l)}</h2>
    <dl className="rows">{t.steady.map(s => <div key={s.id}><dt>{pick(s.label, l)}</dt><dd>{s.value}<small><MetaLine m={s.meta} /></small></dd></div>)}</dl>
    <h2 className="h">{tr('off', l)}</h2>
    <ul className="off">{t.slots.map(s => <li key={s.id}>{pick(s.label, l)}<small>{l === 'en' ? 'needs' : '需'} {s.needs} · {s.owner}</small></li>)}</ul>
  </>;
}

interface SolarB { id: string; name: string | null; name_en: string | null; kwp: number; area_m2: number }
function PowerLens({ l }: { l: L }) {
  const [s, setS] = useState<any>(null);
  useEffect(() => { fetch('/data/solar.json').then(r => r.json() as Promise<any>).then(setS); }, []);
  if (!s) return <p className="note">{tr('loading', l)}</p>;
  const mw = (k: number) => (k / 1000).toFixed(1);
  const pct = (k: number) => Math.round((s.planned_kwp / k) * 100);
  const named: SolarB[] = s.buildings.filter((b: SolarB) => b.name).slice(0, 10);
  const max = named[0]?.kwp ?? 1;
  const a = s.meta.assumptions;
  return <>
    <div className="hero"><b>{mw(s.total_kwp_low)}–{mw(s.total_kwp)}</b>
      <p>{l === 'en' ? 'MWp rooftop solar screened on NCU roofs' : 'MWp 校內屋頂太陽光電篩選潛力'}</p></div>
    <p>{l === 'en'
      ? <>The microgrid plan installs <b>250 kWp</b>, {pct(s.total_kwp)}–{pct(s.total_kwp_low)}% of this ceiling. {s.buildings.length} roofs over {a.minAreaM2} m² counted.</>
      : <>微電網計畫設置 <b>250 kWp</b>，約為此上限的 {pct(s.total_kwp)}–{pct(s.total_kwp_low)}%。計入 {s.buildings.length} 棟 {a.minAreaM2} m² 以上屋頂。</>}</p>
    <p className="meta">{s.planned_source}</p>
    <h2 className="h">{l === 'en' ? 'Largest named roofs, high case (kWp)' : '最大屋頂（高情境 kWp）'}</h2>
    <ul className="bars">{named.map(b => <li key={b.id}><span>{l === 'en' ? (b.name_en ?? b.name) : b.name}</span><span>{Math.round(b.kwp)}</span><i style={{ width: `${(b.kwp / max) * 100}%` }} /></li>)}</ul>
    <h2 className="h">{l === 'en' ? 'Assumptions' : '假設'}</h2>
    <dl className="rows">
      <div><dt>{l === 'en' ? 'Usable roof' : '可用屋頂'}</dt><dd>{a.usableRoofLow * 100}–{a.usableRoof * 100}% {l === 'en' ? 'of footprint' : '樓地板投影'}</dd></div>
      <div><dt>{l === 'en' ? 'Module density' : '模組密度'}</dt><dd>{a.kwpPerM2 * 1000} W/m²</dd></div>
      <div><dt>{l === 'en' ? 'Sun, 2025' : '2025 日照'}</dt><dd>{a.ghi_kwh_m2_yr} kWh/m² · PR {a.pr}</dd></div>
      <div><dt>{l === 'en' ? 'Campus load' : '校園用電'}</dt><dd>{l === 'en' ? 'not public, needs 總務處 meter data' : '未公開，需總務處電表資料'}</dd></div>
    </dl>
    <p className="note">{a.note} <MetaLine m={{ source: s.meta.source, tier: s.meta.tier, asOf: s.meta.fetchedAt }} /></p>
  </>;
}

type Row = [string, string, string, string];
function MoveLens({ l }: { l: L }) {
  const { hm, weekend } = taipei(new Date());
  const tt = timetable as any;
  const block = (k: 'toTaipei' | 'toHSR' | 'toCampus', col: 1 | 2, label: [string, string]) => {
    const rows: Row[] = upcoming(tt[k].rows, col, hm, weekend).slice(0, 4);
    return <><h2 className="h">{pick(label, l)}</h2>
      {rows.length ? <dl className="rows">{rows.map((r, i) => <div key={i}><dt>{r[0]}</dt><dd>{r[col]}</dd></div>)}</dl>
        : <p className="meta">{l === 'en' ? 'No more scheduled trips today.' : '今日已無班次。'}</p>}</>;
  };
  const left = upcoming(tt.toTaipei.rows, 2, hm, weekend).length;
  return <>
    <div className="hero"><b className={left ? '' : 'act'}>{left}</b>
      <p>{l === 'en' ? 'buses to Taipei still stop at NCU today (9025A)' : '班 9025A 今日仍停靠中大往臺北'}</p></div>
    {block('toTaipei', 2, ['9025A to Taipei, at the NCU stop', '9025A 往臺北（中大站約略時間）'])}
    {block('toHSR', 1, ['172 / 173 to HSR Taoyuan, departs', '172 / 173 往高鐵桃園站 發車'])}
    {block('toCampus', 2, ['132 / 133 from Zhongli, arrives about', '132 / 133 自中壢 約抵達'])}
    <p className="note">{tt.caveats.join(' ')} {tt.source}. {weekend ? (l === 'en' ? 'Weekend schedule.' : '假日班表。') : (l === 'en' ? 'Weekday schedule.' : '平日班表。')}</p>
  </>;
}

export function App() {
  const [l, setL] = useState<L>(() => (navigator.language.startsWith('zh') ? 'zh' : 'en'));
  const [lens, setLens] = useState<Lens>('today');
  const [clock, setClock] = useState(() => taipei(new Date()));
  useEffect(() => { const id = setInterval(() => setClock(taipei(new Date())), 30000); return () => clearInterval(id); }, []);
  useEffect(() => { document.documentElement.lang = l === 'en' ? 'en' : 'zh-Hant'; }, [l]);
  const tabs = useMemo(() => (['today', 'power', 'move'] as Lens[]), []);
  return <div className="app">
    <section className="panel">
      <header className="bar">
        <div className="brand">中央大學 <span>NCU Campus Twin</span></div>
        <div><span className="clock">{clock.date} {clock.hm} TPE</span>
          <button className="lang" onClick={() => setL(l === 'en' ? 'zh' : 'en')} aria-label="Language">
            {l === 'en' ? <><b>EN</b> / 中</> : <>EN / <b>中</b></>}</button></div>
      </header>
      <nav className="tabs" role="tablist">{tabs.map(k => <button key={k} role="tab" aria-selected={lens === k} onClick={() => setLens(k)}>{tr(k, l)}</button>)}</nav>
      {lens === 'today' && <TodayLens l={l} />}
      {lens === 'power' && <PowerLens l={l} />}
      {lens === 'move' && <MoveLens l={l} />}
      <p className="note">{l === 'en' ? 'Independent prototype built from open data; not an official NCU system.' : '以開放資料建置之獨立原型，非中央大學官方系統。'} © OpenStreetMap contributors.</p>
    </section>
    <CampusMap lens={lens} l={l} />
  </div>;
}
