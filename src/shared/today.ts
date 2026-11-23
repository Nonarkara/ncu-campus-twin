// The Today engine: turns cooked feeds into a short list of decisions.
// Pure function, no I/O — the worker fetches, this decides. Every threshold is named with its source.
import timetable from '../../data/timetable.json';

export type Tier = 'live' | 'forecast' | 'modeled' | 'schedule' | 'unavailable';
export interface Meta { source: string; tier: Tier; asOf: string | null }
export interface Feed<T> { data: T | null; meta: Meta }

export interface Forecast {
  time: string[]; precip: (number | null)[]; prob: (number | null)[]; temp: (number | null)[]; gust: (number | null)[]; uv: (number | null)[];
  ghi?: (number | null)[]; // shortwave_radiation W/m², optional for backwards compatibility
}
export interface HourlyPoint {
  time: string; hm: string; temp: number; precip: number; prob: number; gust: number; uv: number; ghi: number | null;
}
export interface Air { pm25: number; n: number; observedAt: string }

export type Level = 'act' | 'watch';
export interface Item {
  id: string; level: Level; title: [string, string]; detail: [string, string];
  owner: string; by: string | null; rule: string; meta: Meta;
}
export interface Steady { id: string; label: [string, string]; value: [string, string]; meta: Meta }
export interface Today { now: string; items: Item[]; steady: Steady[]; slots: Slot[]; hourly: HourlyPoint[]; forecastMeta: Meta }
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
const isReading = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function buildToday(now: Date, fc: Feed<Forecast>, air: Feed<Air>): Today {
  const { date, hm, weekend } = taipei(now);
  const items: Item[] = [];
  const steady: Steady[] = [];
  const hourly: HourlyPoint[] = [];
  let forecastMeta: Meta = { ...fc.meta, tier: 'unavailable', asOf: null };
  const ownerOps = '總務處 General Affairs';
  const ownerSafety = '環安中心 Env. & Safety';

  if (fc.data) {
    const f = fc.data;
    const start = Date.parse(`${date}T${hm.slice(0, 2)}:00:00Z`);
    const outdoorEnd = new Date(start + 12 * 3600e3).toISOString().slice(0, 16);
    const byTime = new Map(f.time.map((t, i) => [t, i]));
    const points = Array.from({ length: 24 }, (_, offset) => {
      const time = new Date(start + offset * 3600e3).toISOString().slice(0, 16);
      const i = byTime.get(time) ?? -1;
      return { time, hm: fmtH(time), temp: f.temp[i], precip: f.precip[i], prob: f.prob[i], gust: f.gust[i], uv: f.uv[i], ghi: f.ghi?.[i] };
    });
    for (const { time, hm, temp, precip, prob, gust, uv, ghi } of points) {
      if (!isReading(temp) || !isReading(precip) || !isReading(prob) || !isReading(gust) || !isReading(uv)) continue;
      hourly.push({
        time, hm, temp, precip, prob, gust, uv, ghi: isReading(ghi) && ghi >= 0 ? ghi : null,
      });
    }
    // The console and solar estimate expect a contiguous 24-hour strip.
    const complete = hourly.length === 24;
    if (complete) forecastMeta = fc.meta;
    const rain = points.flatMap(({ hm, precip }) => isReading(precip) ? [{ hm, precip }] : []);
    const day = rain.length === 24 ? rain.reduce((sum, point) => sum + point.precip, 0) : null;
    const peakRain = rain.reduce((peak, point) => point.precip > peak.precip ? point : peak, rain[0]);
    if (peakRain && (peakRain.precip >= RULES.heavyRainHour.mm || (day !== null && day >= RULES.heavyRainDay.mm))) {
      items.push({ id: 'rain-heavy', level: 'act', owner: ownerSafety, by: peakRain.hm, rule: peakRain.precip >= RULES.heavyRainHour.mm ? RULES.heavyRainHour.src : RULES.heavyRainDay.src, meta: fc.meta,
        title: ['Heavy rain: check drains and low ground', '大雨：巡查排水與低窪處'],
        detail: [
          `${peakRain.precip.toFixed(0)} mm/h at ${peakRain.hm}${day === null ? '' : `; ${day.toFixed(0)} mm in 24 h`}`,
          `${peakRain.hm} 時雨量 ${peakRain.precip.toFixed(0)} mm${day === null ? '' : `；24 小時 ${day.toFixed(0)} mm`}`,
        ] });
    } else {
      const wet = points.find(p => p.time < outdoorEnd && isReading(p.precip) && p.precip >= RULES.outdoorRain.mm && isReading(p.prob) && p.prob >= RULES.outdoorRain.prob && p.hm >= '07:00' && p.hm <= '22:00');
      if (wet && isReading(wet.precip)) items.push({ id: 'rain-outdoor', level: 'watch', owner: ownerOps, by: wet.hm, rule: RULES.outdoorRain.src, meta: fc.meta,
        title: ['Rain for outdoor activities', '戶外活動將遇雨'],
        detail: [`${wet.precip.toFixed(1)} mm/h at ${wet.hm}, ${wet.prob}% chance`, `${wet.hm} 雨量 ${wet.precip.toFixed(1)} mm，機率 ${wet.prob}%`] });
    }
    const hot = points.find(p => isReading(p.temp) && p.temp >= RULES.heat.c);
    if (hot && isReading(hot.temp)) items.push({ id: 'heat', level: 'act', owner: ownerSafety, by: hot.hm, rule: RULES.heat.src, meta: fc.meta,
      title: ['Heat: move PE and outdoor work indoors', '高溫：體育課與戶外作業移至室內'], detail: [`${hot.temp.toFixed(0)} °C at ${hot.hm}`, `${hot.hm} 氣溫 ${hot.temp.toFixed(0)} °C`] });
    const windy = points.find(p => isReading(p.gust) && p.gust >= RULES.gust.ms);
    if (windy && isReading(windy.gust)) items.push({ id: 'gust', level: 'act', owner: ownerOps, by: windy.hm, rule: RULES.gust.src, meta: fc.meta,
      title: ['Strong wind: secure banners, tents, scaffolds', '強風：固定布條、帳篷與鷹架'], detail: [`Gusts ${windy.gust.toFixed(0)} m/s at ${windy.hm}`, `${windy.hm} 陣風 ${windy.gust.toFixed(0)} m/s`] });
    const sunny = points.find(p => isReading(p.uv) && p.uv >= RULES.uv.idx);
    if (sunny && isReading(sunny.uv)) items.push({ id: 'uv', level: 'watch', owner: ownerSafety, by: sunny.hm, rule: RULES.uv.src, meta: fc.meta,
      title: ['High UV: shade for outdoor classes', '紫外線過量：戶外課程需遮蔭'], detail: [`UV ${sunny.uv.toFixed(0)} at ${sunny.hm}`, `${sunny.hm} 紫外線指數 ${sunny.uv.toFixed(0)}`] });
    const first = hourly[0];
    if (complete && first && day !== null) steady.push({ id: 'weather', label: ['Weather now', '目前天氣'], meta: fc.meta,
      value: [`${first.temp.toFixed(0)} °C · ${day.toFixed(0)} mm next 24 h · gust ${first.gust.toFixed(0)} m/s`, `${first.temp.toFixed(0)} °C · 未來 24 小時 ${day.toFixed(0)} mm · 陣風 ${first.gust.toFixed(0)} m/s`] });
    if (!complete) hourly.length = 0;
  }

  if (air.data && isReading(air.data.pm25) && air.data.pm25 >= 0) {
    if (air.data.pm25 >= RULES.pm25.ug) items.push({ id: 'pm25', level: 'act', owner: ownerSafety, by: null, rule: RULES.pm25.src, meta: air.meta,
      title: ['Poor air: move PE classes indoors', '空品不良：體育課移至室內'], detail: air.data.n ? [`PM2.5 ${air.data.pm25.toFixed(0)} µg/m³ (median of ${air.data.n} sensors)`, `PM2.5 ${air.data.pm25.toFixed(0)} µg/m³（${air.data.n} 個感測器中位數）`] : [`PM2.5 ${air.data.pm25.toFixed(0)} µg/m³ (model estimate)`, `PM2.5 ${air.data.pm25.toFixed(0)} µg/m³（模式推估）`] });
    steady.push({ id: 'air', label: ['Air, PM2.5', '空品 PM2.5'], meta: air.meta, value: [`${air.data.pm25.toFixed(0)} µg/m³ · ${air.data.n ? `median of ${air.data.n} sensors` : 'model estimate'}`, `${air.data.pm25.toFixed(0)} µg/m³ · ${air.data.n ? `${air.data.n} 個感測器中位數` : '模式推估'}`] });
  }

  const tt = timetable as unknown as Record<'toCampus' | 'toHSR' | 'toTaipei', { rows: Row[] }>;
  const sched: Meta = { source: 'NCU 總務處 timetable', tier: 'schedule', asOf: '2026-02-26' };
  const taipeiLeft = upcoming(tt.toTaipei.rows, 2, hm, weekend);
  const hsr = upcoming(tt.toHSR.rows, 1, hm, weekend);
  const inbound = upcoming(tt.toCampus.rows, 2, hm, weekend);
  steady.push({ id: 'taipei', label: ['9025A to Taipei', '9025A 往臺北'], meta: sched,
    value: taipeiLeft.length ? [`~${taipeiLeft[0][2]} at stop · ${taipeiLeft.length} left today`, `約 ${taipeiLeft[0][2]} 到站 · 今日剩 ${taipeiLeft.length} 班`] : ['none left today', '今日已無班次'] });
  steady.push({ id: 'hsr', label: ['To HSR Taoyuan', '往高鐵桃園站'], meta: sched,
    value: hsr.length ? [`${hsr[0][0]} ${hsr[0][1]} · last ${hsr.at(-1)![1]}`, `${hsr[0][0]} ${hsr[0][1]} · 末班 ${hsr.at(-1)![1]}`] : ['none left today', '今日已無班次'] });
  steady.push({ id: 'inbound', label: ['Last bus in from Zhongli', '中壢末班進校'], meta: sched,
    value: inbound.length ? [`${inbound.at(-1)![0]} ~${inbound.at(-1)![2]}`, `${inbound.at(-1)![0]} 約 ${inbound.at(-1)![2]}`] : ['none left today', '今日已無班次'] });

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
  return { now: now.toISOString(), items, steady, slots, hourly, forecastMeta };
}
