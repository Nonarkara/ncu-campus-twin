import type { Feed } from './today';

export const AQI_SOURCE = 'MOENV';
export const AQI_MONITOR = 'https://airtw.moenv.gov.tw/ENG/default.aspx';
export const AQI_STALE_MS = 95 * 60e3;
// AQX_P_07 / AQX_P_488 identify Zhongli as station 68. The monitoring map uses ID 12.
export const ZHONGLI_STATION: [number, number] = [121.221667, 24.953278];

export interface StationAqi {
  aqi: number | null;
  publishedAt: string;
}

export function parseZhongli(payload: unknown, reportHour: number): StationAqi | null {
  if (!Array.isArray(payload) || !payload.every(row => row && typeof row === 'object' && !Array.isArray(row))) return null;
  const fields = Object.fromEntries(payload.flatMap(row => Object.entries(row))) as Record<string, unknown>;
  if (fields.sitename !== 'Zhongli' || fields.county !== 'Taoyuan') return null;
  if (typeof fields.date !== 'string' || !/^\d{4}\/\d{2}\/\d{2} \d{2}:00$/.test(fields.date)) return null;
  const reported = Date.parse(fields.date.replaceAll('/', '-').replace(' ', 'T') + ':00+08:00');
  if (reported !== reportHour) return null;
  if (fields.AQI === '' || fields.AQI === '-' || fields.AQI === '—' || fields.AQI === null) {
    return { aqi: null, publishedAt: new Date(reported).toISOString() };
  }
  const text = typeof fields.AQI === 'number' || typeof fields.AQI === 'string' ? String(fields.AQI).trim() : '';
  const aqi = Number(text);
  if (!/^\d{1,3}$/.test(text) || aqi > 500) return null;
  return { aqi, publishedAt: new Date(reported).toISOString() };
}

export function stationFeed(observation: StationAqi | null, now: number): Feed<StationAqi> {
  const age = observation ? now - Date.parse(observation.publishedAt) : NaN;
  if (!observation || !Number.isFinite(age) || age < 0) {
    return { data: null, meta: { source: AQI_SOURCE, tier: 'unavailable', asOf: null } };
  }
  return {
    data: observation,
    meta: { source: AQI_SOURCE, tier: age >= AQI_STALE_MS ? 'stale' : observation.aqi === null ? 'unavailable' : 'live', asOf: observation.publishedAt },
  };
}
