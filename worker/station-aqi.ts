import { parseZhongli, type StationAqi } from '../src/shared/station-aqi';

export const STATION_AQI_KEY = 'zhongli_aqi_v1';
const HOUR_MS = 3600e3;
type Outcome = 'ok' | 'http' | 'invalid' | 'network';
export interface StationSnapshot {
  observation: StationAqi | null;
  lastAttemptAt: string;
  lastSuccessAt: string | null;
  outcome: Outcome;
  httpStatus?: number;
}

export async function readStationAqi(kv: KVNamespace): Promise<StationSnapshot | null> {
  try {
    const row: unknown = await kv.get(STATION_AQI_KEY, 'json');
    if (!row || typeof row !== 'object' || !('lastAttemptAt' in row) || typeof row.lastAttemptAt !== 'string' ||
      !('outcome' in row) || !['ok', 'http', 'invalid', 'network'].includes(String(row.outcome)) ||
      !('lastSuccessAt' in row) || (row.lastSuccessAt !== null && typeof row.lastSuccessAt !== 'string') ||
      !('observation' in row)) return null;
    const snapshot = row as StationSnapshot;
    const data = snapshot.observation;
    if (data !== null &&
      (!data || typeof data.publishedAt !== 'string' ||
        (data.aqi !== null && (!Number.isInteger(data.aqi) || data.aqi < 0 || data.aqi > 500)))) return null;
    return snapshot;
  } catch {
    return null;
  }
}

export async function updateStationAqi(kv: KVNamespace, scheduledMs: number) {
  const previous = await readStationAqi(kv);
  if (previous && Date.parse(previous.lastAttemptAt) >= scheduledMs) return;
  const lastAttemptAt = new Date(scheduledMs).toISOString();
  const latestHour = Math.floor((scheduledMs - 15 * 60e3) / HOUR_MS) * HOUR_MS;
  if (previous?.outcome === 'ok' && previous.observation?.aqi != null &&
    Date.parse(previous.observation.publishedAt) === latestHour) return;
  if (previous && previous.outcome !== 'ok' && scheduledMs - Date.parse(previous.lastAttemptAt) < 15 * 60e3) return;
  // The portal files are keyed by Taiwan sampling hour. The embedded issue time is an hour later.
  const stamp = new Date(latestHour + 7 * HOUR_MS).toISOString().slice(0, 13).replace(/\D/g, '');
  const url = `https://airtw.moenv.gov.tw/json/airlist/airlist_12_${stamp}_en.json`;
  let result: Pick<StationSnapshot, 'outcome' | 'httpStatus'> = { outcome: 'network' };
  let current: StationAqi | null = null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) result = { outcome: 'http', httpStatus: response.status };
    else {
      result = { outcome: 'invalid' };
      current = parseZhongli(await response.json(), latestHour);
      if (current) result = { outcome: 'ok' };
    }
  } catch { /* store only the outcome code, never upstream text or URLs */ }
  const observation = current && (!previous?.observation || current.publishedAt >= previous.observation.publishedAt)
    ? current : previous?.observation ?? null;
  await kv.put(STATION_AQI_KEY, JSON.stringify({
    observation, lastAttemptAt, lastSuccessAt: current ? lastAttemptAt : previous?.lastSuccessAt ?? null, ...result,
  } satisfies StationSnapshot));
}
