import timetable from '../../data/timetable.json';
import calendar from '../../data/service-calendar.json';

export type Row = [route: string, firstTime: string, secondTime: string, service: string];
export const routes = {
  toTaipei: { rows: timetable.toTaipei.rows as Row[], col: 2 },
  toHSR: { rows: timetable.toHSR.rows as Row[], col: 1 },
  toCampus: { rows: timetable.toCampus.rows as Row[], col: 2 },
} as const;

/** Taipei wall-clock parts for an instant (UTC+8, no DST). */
export function taipei(d: Date) {
  const t = new Date(d.getTime() + 8 * 3600e3);
  const dow = t.getUTCDay();
  return { date: t.toISOString().slice(0, 10), hm: t.toISOString().slice(11, 16), dow, weekend: dow === 0 || dow === 6 };
}

export function serviceDay({ date, weekend }: ReturnType<typeof taipei>) {
  if (date < calendar.verifiedFrom || date > calendar.verifiedThrough || calendar.checkOperatorDates.includes(date)) return 'unverified';
  if (weekend) return 'weekend';
  return calendar.breaks.some(([start, end]) => date >= start && date <= end) ? 'break' : 'term';
}

export const SERVICE_LABELS = {
  term: ['Term weekday', '上課期間平日'],
  break: ['Break weekday', '寒暑假平日'],
  weekend: ['Weekend', '週末'],
  unverified: ['Service day unverified', '行駛日待確認'],
} as const;

export const CHECK_OPERATOR = ['Check operator timetable', '請查客運班表'] as const;

export function scheduledRows(rows: Row[], day: ReturnType<typeof serviceDay>) {
  if (day === 'unverified') return [];
  return rows.filter(([, , , code]) => {
    if (code === 'daily') return true;
    if (code === 'wkday') return day !== 'weekend';
    if (code === 'wkend') return day === 'weekend';
    if (code === 'term') return day === 'term';
    return code === 'brk' && day !== 'term';
  });
}

export function upcoming(rows: Row[], col: 1 | 2, hm: string, day: ReturnType<typeof serviceDay>) {
  return scheduledRows(rows, day).filter(r => r[col] > hm).sort((a, b) => a[col].localeCompare(b[col]));
}
