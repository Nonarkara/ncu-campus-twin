// Vignelli-discipline SVG instruments: hairlines, one accent (var(--amber)), tabular numerals, zero shadows.
import type { HourlyPoint } from './shared/today';
import { RULES } from './shared/today';
import type { IslandSimulation } from './shared/microgrid';

export type MetricKey = 'ghi' | 'precip' | 'temp' | 'gust';

export function HourlyStrip({
  hourly,
  metric,
  l,
}: {
  hourly: HourlyPoint[];
  metric: MetricKey;
  l: 'en' | 'zh';
}) {
  if (!hourly.length) return null;
  const W = 368, H = 76, padL = 26, padR = 6, padT = 8, padB = 16;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const vals = hourly.map(h =>
    metric === 'ghi' ? (h.ghi ?? 0)
    : metric === 'precip' ? h.precip
    : metric === 'temp' ? h.temp
    : h.gust,
  );
  const rawMax = Math.max(...vals, 1);
  const rawMin = metric === 'temp' ? Math.floor(Math.min(...vals) - 2) : 0;
  const maxV = metric === 'ghi' ? Math.max(800, Math.ceil(rawMax / 200) * 200)
    : metric === 'precip' ? Math.max(5, Math.ceil(rawMax))
    : metric === 'gust' ? Math.max(20, Math.ceil(rawMax / 5) * 5)
    : Math.max(rawMin + 6, Math.ceil(rawMax + 2));

  const threshold = metric === 'precip' ? RULES.outdoorRain.mm
    : metric === 'temp' ? RULES.heat.c
    : metric === 'gust' ? RULES.gust.ms
    : null;

  const yOf = (v: number) => padT + plotH - ((v - rawMin) / (maxV - rawMin)) * plotH;
  const stepX = plotW / Math.max(1, hourly.length - 1);
  const barW = Math.max(3, (plotW / hourly.length) - 2);

  const isLine = metric === 'temp';
  const pathD = isLine
    ? hourly.map((_, i) => `${i === 0 ? 'M' : 'L'}${(padL + i * stepX).toFixed(1)},${yOf(vals[i]).toFixed(1)}`).join(' ')
    : '';

  const unit = metric === 'ghi' ? 'W/m²' : metric === 'precip' ? 'mm' : metric === 'temp' ? '°C' : 'm/s';
  const ticks = [0, 6, 12, 18, hourly.length - 1].filter((v, i, a) => v < hourly.length && a.indexOf(v) === i);

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={l === 'en' ? `24-hour ${metric} forecast` : `未來 24 小時預報`}>
      <line x1={padL} y1={padT} x2={W - padR} y2={padT} stroke="var(--line)" />
      <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke="var(--line-hi)" />
      <text x={padL - 4} y={padT + 4} textAnchor="end" className="ax">{maxV}</text>
      <text x={padL - 4} y={padT + plotH} textAnchor="end" className="ax">{rawMin}</text>
      <text x={W - padR} y={padT + 4} textAnchor="end" className="ax">{unit}</text>

      {threshold !== null && threshold <= maxV && threshold >= rawMin && (
        <line
          x1={padL} y1={yOf(threshold)} x2={W - padR} y2={yOf(threshold)}
          stroke="var(--amber)" strokeWidth="1" strokeDasharray="3 2" opacity="0.7"
        />
      )}

      {isLine ? (
        <path d={pathD} fill="none" stroke="var(--ink)" strokeWidth="1.5" />
      ) : (
        hourly.map((h, i) => {
          const v = vals[i];
          const x = padL + (i / hourly.length) * plotW;
          if (metric === 'ghi' && h.ghi === null) {
            return <line key={h.time} x1={x + 2} x2={x + barW - 2} y1={padT + plotH - 4}
              y2={padT + plotH - 4} stroke="var(--dim)" strokeDasharray="2 2">
              <title>{h.hm} · {l === 'en' ? 'Irradiance unavailable' : '無日照資料'}</title>
            </line>;
          }
          const y = yOf(v);
          const bh = Math.max(0, padT + plotH - y);
          const hot = threshold !== null && v >= threshold; // amber only past a rule threshold, never for 'sunny'
          return (
            <rect
              key={h.time}
              x={x}
              y={y}
              width={barW}
              height={bh}
              fill={hot ? 'var(--amber)' : 'var(--chart-bar)'}
            />
          );
        })
      )}

      {ticks.map(i => (
        <text key={i} x={padL + (i / Math.max(1, hourly.length - 1)) * plotW} y={H - 2} textAnchor={i === 0 ? 'start' : i === hourly.length - 1 ? 'end' : 'middle'} className="ax">
          {hourly[i].hm.slice(0, 2)}h
        </text>
      ))}
    </svg>
  );
}

export function IslandChart({ sim, l }: { sim: IslandSimulation; l: 'en' | 'zh' }) {
  const steps = sim.steps;
  if (!steps.length) return null;
  const W = 368, H = 92, padL = 30, padR = 8, padT = 10, padB = 18;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = steps.length;
  const xAt = (i: number) => padL + (i / n) * plotW;
  const ySoc = (pct: number) => padT + plotH - (pct / 100) * plotH;

  // Build SoC polyline starting from initial (step 0 before discharge = ~100%)
  const pts: [number, number][] = [[xAt(0), ySoc(100)]];
  steps.forEach((s, i) => pts.push([xAt(i + 1), ySoc(s.socPct)]));
  const socPath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');

  const x4h = xAt(4);
  const yFloor = ySoc(10);
  const maxPv = Math.max(steps[0]?.loadKw ?? 500, ...steps.map(s => s.pvKw), 250);

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={l === 'en' ? '8-hour BESS state of charge during islanding' : '孤島運轉 8 小時電池電量曲線'}>
      {/* Grid */}
      <line x1={padL} y1={padT} x2={W - padR} y2={padT} stroke="var(--line)" />
      <line x1={padL} y1={ySoc(50)} x2={W - padR} y2={ySoc(50)} stroke="var(--line)" />
      <line x1={padL} y1={yFloor} x2={W - padR} y2={yFloor} stroke="var(--line-hi)" strokeDasharray="2 2" />
      <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke="var(--line-hi)" />

      {/* 4h LOI target vertical rule */}
      <line x1={x4h} y1={padT} x2={x4h} y2={padT + plotH} stroke="var(--amber)" strokeWidth="1" strokeDasharray="3 2" />
      <text x={x4h + 3} y={padT + 8} className="ax accent">{l === 'en' ? '4h LOI' : '4時目標'}</text>

      {/* PV contribution bars (bottom-aligned, subtle) */}
      {steps.map((s, i) => {
        const bw = Math.max(4, (plotW / n) - 4);
        const bh = (s.pvKw / maxPv) * (plotH * 0.45);
        return (
          <rect
            key={s.hourOffset}
            x={xAt(i) + 2}
            y={padT + plotH - bh}
            width={bw}
            height={bh}
            fill="var(--line-hi)"
          />
        );
      })}

      {/* Battery SoC line */}
      <path d={socPath} fill="none" stroke={sim.passes4h ? 'var(--ink)' : 'var(--amber)'} strokeWidth="2" />
      {pts.slice(1).map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="2" fill={sim.passes4h ? 'var(--ink)' : 'var(--amber)'} />
      ))}

      {/* Y labels */}
      <text x={padL - 4} y={padT + 4} textAnchor="end" className="ax">100%</text>
      <text x={padL - 4} y={yFloor + 3} textAnchor="end" className="ax">10%</text>

      {/* X labels */}
      {[0, 2, 4, 6, n - 1].filter((v, i, a) => v < n && a.indexOf(v) === i).map(i => (
        <text key={i} x={xAt(i)} y={H - 2} textAnchor={i === 0 ? 'start' : 'middle'} className="ax">
          {steps[i].hm.slice(0, 2)}h
        </text>
      ))}
    </svg>
  );
}

export function HeadwayStrip({
  nowHm,
  tracks,
  l,
}: {
  nowHm: string;
  tracks: { label: string; times: string[]; highlight?: boolean }[];
  l: 'en' | 'zh';
}) {
  const W = 368, rowH = 18, padL = 56, padR = 8, padT = 6, padB = 16;
  const H = padT + tracks.length * rowH + padB;
  const startMin = 6 * 60;  // 06:00
  const endMin = 22 * 60;   // 22:00
  const plotW = W - padL - padR;

  const toMin = (hm: string) => {
    const [h, m] = hm.split(':').map(Number);
    return h * 60 + m;
  };
  const xOf = (hm: string) => {
    const clamped = Math.max(startMin, Math.min(endMin, toMin(hm)));
    return padL + ((clamped - startMin) / (endMin - startMin)) * plotW;
  };
  const nowMin = toMin(nowHm);
  const nowInRange = nowMin >= startMin && nowMin <= endMin;

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={l === 'en' ? 'Daily bus departure schedule 06:00 to 22:00' : '每日公車班次分布 06:00–22:00'}>
      {tracks.map((tr, r) => {
        const y = padT + r * rowH + rowH / 2;
        return (
          <g key={tr.label}>
            <text x={padL - 6} y={y + 3} textAnchor="end" className="ax">{tr.label}</text>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--line)" />
            {tr.times.map((tm, i) => {
              const past = toMin(tm) < nowMin;
              return (
                <rect
                  key={`${tm}-${i}`}
                  x={xOf(tm) - 1.5}
                  y={y - (tr.highlight ? 5 : 4)}
                  width={tr.highlight ? 3.5 : 2.5}
                  height={tr.highlight ? 10 : 8}
                  fill={past ? 'var(--chart-past)' : tr.highlight ? 'var(--amber)' : 'var(--ink)'}
                />
              );
            })}
          </g>
        );
      })}

      {nowInRange && (
        <line x1={xOf(nowHm)} y1={padT - 2} x2={xOf(nowHm)} y2={H - padB + 2} stroke="var(--amber)" strokeWidth="1.5" />
      )}

      {['06:00', '10:00', '14:00', '18:00', '22:00'].map((tm, idx) => (
        <text key={tm} x={xOf(tm)} y={H - 2} textAnchor={idx === 0 ? 'start' : idx === 4 ? 'end' : 'middle'} className="ax">
          {tm.slice(0, 2)}h
        </text>
      ))}
    </svg>
  );
}

export interface SolarSeason {
  meta: { source: string; sourceUrl: string; tier: string; asOf: string; latitude: number; longitude: number };
  months: { month: number; days: number; kwhM2: number }[];
}

export function SolarSeasons({ season, installedKwp, pr, l }: {
  season: SolarSeason;
  installedKwp: number;
  pr: number;
  l: 'en' | 'zh';
}) {
  const W = 360, H = 100, padL = 42, padR = 4, bottom = 80, top = 9;
  const band = (W - padL - padR) / 12;
  const months = season.months.map(({ month, days, kwhM2 }) => ({
    label: l === 'en'
      ? new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, month - 1)))
      : String(month),
    output: (kwhM2 / days) * installedKwp * pr,
  }));
  if (!months.length || installedKwp <= 0) return null;
  const high = months.reduce((max, month) => month.output > max.output ? month : max);
  const low = months.reduce((min, month) => month.output < min.output ? month : min);
  const max = Math.ceil(Math.max(1, high.output) / 200) * 200;
  const y = (value: number) => bottom - (bottom - top) * value / max;
  const format = (value: number) => Math.round(value).toLocaleString(l === 'en' ? 'en' : 'zh-TW');
  const summary = l === 'en'
    ? `${low.label} ${format(low.output)} · ${high.label} ${format(high.output)} kWh/day`
    : `${low.label} 月 ${format(low.output)}・${high.label} 月 ${format(high.output)} kWh／日`;
  return (
    <section className="strip-box">
      <div className="strip-head">
        <h2 className="h">{l === 'en' ? 'Solar by month' : '各月光電發電量'}</h2>
        <span className="meta">{format(installedKwp)} kWp</span>
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={
        (l === 'en' ? 'Modeled monthly average solar output in kWh per day. ' : '各月日均發電量，單位 kWh。')
        + months.map(month => `${month.label} ${format(month.output)}`).join(' · ')
      }>
        {[0, max / 2, max].map(value => <g key={value}>
          <line x1={padL} x2={W - padR} y1={y(value)} y2={y(value)} stroke="var(--line-hi)" />
          <text className="ax" x={padL - 4} y={y(value) + 3} textAnchor="end">{format(value)}</text>
        </g>)}
        {months.map((month, i) => {
          const x = padL + (i + 0.5) * band;
          return <g key={month.label}>
            <rect x={x - band * 0.29} y={y(month.output)} width={band * 0.58} height={bottom - y(month.output)} fill="var(--chart-bar)">
              <title>{month.label} · {format(month.output)} kWh/{l === 'en' ? 'day' : '日'}</title>
            </rect>
            <text className="ax" x={x} y={H - 3} textAnchor="middle">{month.label}</text>
          </g>;
        })}
      </svg>
      <p className="meta solar-caption">{summary} · {season.meta.asOf} {l === 'en' ? 'modeled · unshaded' : '模式估算・未計遮蔭'}</p>
      <p className="meta solar-caption"><a href={season.meta.sourceUrl} target="_blank" rel="noopener noreferrer">{season.meta.source}</a>
        {' · '}{l === 'en' ? 'Regional reanalysis grid' : '區域再分析網格'} {season.meta.latitude.toFixed(3)}° N, {season.meta.longitude.toFixed(3)}° E
      </p>
    </section>
  );
}
