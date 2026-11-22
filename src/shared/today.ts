// The Today engine: turns cooked feeds into a short list of decisions.
// Pure function, no I/O — the worker fetches, this decides. Every threshold is named with its source.
import timetable from '../../data/timetable.json';

export type Tier = 'live' | 'forecast' | 'modeled' | 'schedule' | 'unavailable';
export interface Meta { source: string; tier: Tier; asOf: string | null }
export interface Feed<T> { data: T | null; meta: Meta }

export interface Forecast { time: string[]; precip: number[]; prob: number[]; temp: number[]; gust: number[]; uv: number[] }
export interface Air { pm25: number; n: number; observedAt: string }

export type Level = 'act' | 'watch';
export interface Item {
  id: string; level: Level; title: [string, string]; detail: [string, string];
  owner: string; by: string | null; rule: string; meta: Meta;
}
export interface Steady { id: string; label: [string, string]; value: string; meta: Meta }
export interface Today { now: string; items: Item[]; steady: Steady[]; slots: Slot[] }
export interface Slot { id: string; label: [string, string]; owner: string; needs: string }

export const RULES = {
  heavyRainHour: { mm: 40, src: 'CWA 大雨: ≥40 mm in 1 h' },
  heavyRainDay: { mm: 80, src: 'CWA 大雨: ≥80 mm in 24 h' },
  outdoorRain: { mm: 2, prob: 60, src: 'House rule (adjustable): ≥2 mm/h at ≥60% chance, 07–22 h' },
  heat: { c: 36, src: 'CWA 高溫資訊 yellow: ≥36 °C' },
  gust: { ms: 17.2, src: 'Beaufort 8 (CWA 強風): gust ≥17.2 m/s' },
  uv: { idx: 8, src: 'CWA UV 過量級: index ≥8' },
  pm25: { ug: 35.5, src: 'MOENV AQI orange band: PM2.5 ≥35.5 µg/m³' },
};

/** Taipei wall-clock parts for an instant (UTC+8, no DST). */
export function taipei(d: Date) {
  const t = new Date(d.getTime() + 8 * 3600e3);
  const dow = t.getUTCDay();
  return { date: t.toISOString().slice(0, 10), hm: t.toISOString().slice(11, 16), dow, weekend: dow === 0 || dow === 6 };
}

type Row = [string, string, string, string];
/** Which timetable day-codes run today. Break periods are not modelled: weekdays count as term ('term'). */
export function runs(code: string, weekend: boolean) {
  if (code === 'daily') return true;
  if (code === 'wkday' || code === 'term') return !weekend;
  if (code === 'wkend' || code === 'brk') return weekend;
  return false;
}
export function upcoming(rows: Row[], col: 1 | 2, hm: string, weekend: boolean) {
  return rows.filter(r => runs(r[3], weekend) && r[col] > hm).sort((a, b) => a[col].localeCompare(b[col]));
}

const fmtH = (iso: string) => iso.slice(11, 16);

export function buildToday(now: Date, fc: Feed<Forecast>, air: Feed<Air>): Today {
  const { hm, weekend } = taipei(now);
  const items: Item[] = [];
  const steady: Steady[] = [];
  const ownerOps = '總務處 General Affairs';
  const ownerSafety = '環安中心 Env. & Safety';

  if (fc.data) {
    const f = fc.data;
    const nowIso = taipei(now).date + 'T' + hm;
    const idx = f.time.map((t, i) => i).filter(i => f.time[i] >= nowIso.slice(0, 13)).slice(0, 24);
    const next12 = idx.slice(0, 12);
    const day = idx.reduce((s, i) => s + (f.precip[i] ?? 0), 0);
    const peakRain = next12.reduce((m, i) => (f.precip[i] > (f.precip[m] ?? -1) ? i : m), next12[0]);
    if (peakRain !== undefined && (f.precip[peakRain] >= RULES.heavyRainHour.mm || day >= RULES.heavyRainDay.mm)) {
      items.push({ id: 'rain-heavy', level: 'act', owner: ownerSafety, by: fmtH(f.time[peakRain]), rule: RULES.heavyRainHour.src, meta: fc.meta,
        title: ['Heavy rain: check drains and low ground', '大雨：巡查排水與低窪處'],
        detail: [`${f.precip[peakRain].toFixed(0)} mm/h peak at ${fmtH(f.time[peakRain])}; ${day.toFixed(0)} mm in 24 h`, `${fmtH(f.time[peakRain])} 時雨量 ${f.precip[peakRain].toFixed(0)} mm；24 小時 ${day.toFixed(0)} mm`] });
    } else {
      const wet = next12.find(i => f.precip[i] >= RULES.outdoorRain.mm && f.prob[i] >= RULES.outdoorRain.prob && f.time[i].slice(11, 13) >= '07' && f.time[i].slice(11, 13) <= '22');
      if (wet !== undefined) items.push({ id: 'rain-outdoor', level: 'watch', owner: ownerOps, by: fmtH(f.time[wet]), rule: RULES.outdoorRain.src, meta: fc.meta,
        title: ['Rain for outdoor activities', '戶外活動將遇雨'],
        detail: [`${f.precip[wet].toFixed(1)} mm/h at ${fmtH(f.time[wet])}, ${f.prob[wet]}% chance`, `${fmtH(f.time[wet])} 雨量 ${f.precip[wet].toFixed(1)} mm，機率 ${f.prob[wet]}%`] });
    }
    const hot = idx.find(i => f.temp[i] >= RULES.heat.c);
    if (hot !== undefined) items.push({ id: 'heat', level: 'act', owner: ownerSafety, by: fmtH(f.time[hot]), rule: RULES.heat.src, meta: fc.meta,
      title: ['Heat: move PE and outdoor work indoors', '高溫：體育課與戶外作業移至室內'], detail: [`${f.temp[hot].toFixed(0)} °C at ${fmtH(f.time[hot])}`, `${fmtH(f.time[hot])} 氣溫 ${f.temp[hot].toFixed(0)} °C`] });
    const windy = idx.find(i => f.gust[i] >= RULES.gust.ms);
    if (windy !== undefined) items.push({ id: 'gust', level: 'act', owner: ownerOps, by: fmtH(f.time[windy]), rule: RULES.gust.src, meta: fc.meta,
      title: ['Strong wind: secure banners, tents, scaffolds', '強風：固定布條、帳篷與鷹架'], detail: [`Gusts ${f.gust[windy].toFixed(0)} m/s at ${fmtH(f.time[windy])}`, `${fmtH(f.time[windy])} 陣風 ${f.gust[windy].toFixed(0)} m/s`] });
    const sunny = idx.find(i => f.uv[i] >= RULES.uv.idx);
    if (sunny !== undefined) items.push({ id: 'uv', level: 'watch', owner: ownerSafety, by: fmtH(f.time[sunny]), rule: RULES.uv.src, meta: fc.meta,
      title: ['High UV: shade for outdoor classes', '紫外線過量：戶外課程需遮蔭'], detail: [`UV ${f.uv[sunny].toFixed(0)} at ${fmtH(f.time[sunny])}`, `${fmtH(f.time[sunny])} 紫外線指數 ${f.uv[sunny].toFixed(0)}`] });
    const i0 = idx[0];
    if (i0 !== undefined) steady.push({ id: 'weather', label: ['Weather now', '目前天氣'], meta: fc.meta,
      value: `${f.temp[i0].toFixed(0)} °C · ${day.toFixed(0)} mm next 24 h · gust ${f.gust[i0].toFixed(0)} m/s` });
  }

  if (air.data) {
    if (air.data.pm25 >= RULES.pm25.ug) items.push({ id: 'pm25', level: 'act', owner: ownerSafety, by: null, rule: RULES.pm25.src, meta: air.meta,
      title: ['Poor air: move PE classes indoors', '空品不良：體育課移至室內'], detail: air.data.n ? [`PM2.5 ${air.data.pm25.toFixed(0)} µg/m³ (median of ${air.data.n} sensors)`, `PM2.5 ${air.data.pm25.toFixed(0)} µg/m³（${air.data.n} 個感測器中位數）`] : [`PM2.5 ${air.data.pm25.toFixed(0)} µg/m³ (model estimate)`, `PM2.5 ${air.data.pm25.toFixed(0)} µg/m³（模式推估）`] });
    steady.push({ id: 'air', label: ['Air, PM2.5', '空品 PM2.5'], meta: air.meta, value: `${air.data.pm25.toFixed(0)} µg/m³ · ${air.data.n ? `median of ${air.data.n} sensors` : 'model estimate'}` });
  }

  const tt = timetable as unknown as Record<'toCampus' | 'toHSR' | 'toTaipei', { rows: Row[] }>;
  const sched: Meta = { source: 'NCU 總務處 timetable', tier: 'schedule', asOf: '2026-02-26' };
  const taipeiLeft = upcoming(tt.toTaipei.rows, 2, hm, weekend);
  const hsr = upcoming(tt.toHSR.rows, 1, hm, weekend);
  const inbound = upcoming(tt.toCampus.rows, 2, hm, weekend);
  steady.push({ id: 'taipei', label: ['9025A to Taipei', '9025A 往臺北'], meta: sched,
    value: taipeiLeft.length ? `${taipeiLeft[0][2]} at stop · ${taipeiLeft.length} left today` : 'none left today' });
  steady.push({ id: 'hsr', label: ['To HSR Taoyuan', '往高鐵桃園站'], meta: sched,
    value: hsr.length ? `${hsr[0][0]} ${hsr[0][1]} · last ${hsr.at(-1)![1]}` : 'none left today' });
  steady.push({ id: 'inbound', label: ['Last bus in from Zhongli', '中壢末班進校'], meta: sched,
    value: inbound.length ? `${inbound.at(-1)![0]} ~${inbound.at(-1)![2]}` : 'none left today' });

  const order = { act: 0, watch: 1 } as const;
  items.sort((a, b) => order[a.level] - order[b.level] || (a.by ?? '99').localeCompare(b.by ?? '99'));

  const slots: Slot[] = [
    { id: 'demand', label: ['Peak demand vs contract capacity', '最高需量 vs 契約容量'], owner: '總務處 / Taipower', needs: '15-min revenue meter (AMI) feed' },
    { id: 'microgrid', label: ['Microgrid: battery charge, island hours', '微電網：儲能電量、孤島時數'], owner: 'EE Dept. microgrid team', needs: 'BMS / EMS read-only API' },
    { id: 'rooms', label: ['Classrooms free now', '目前空教室'], owner: '教務處 Academic Affairs', needs: 'course timetable + bookings export' },
    { id: 'parking', label: ['Parking occupancy', '停車位使用'], owner: '總務處 事務組', needs: 'gate counts' },
    { id: 'warnings', label: ['CWA warnings & earthquakes', '氣象署警特報與地震'], owner: '—', needs: 'free CWA API key' },
    { id: 'livebus', label: ['Live bus positions', '公車即時動態'], owner: '—', needs: 'free TDX API key' },
  ];
  return { now: now.toISOString(), items, steady, slots };
}
