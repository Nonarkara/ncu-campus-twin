// Microgrid islanding & rooftop PV physics engine.
// Pure functions, explicit constants, zero invented telemetry.
import type { HourlyPoint } from './today';

export const MICROGRID_LOI = {
  date: '2026-03-13',
  source: 'NCU × Taipower LOI (2026-03-13), EE Prof. Chen Cheng-yi',
  bessPowerKw: 1000,       // 1 MW inverter / PCS rating
  bessEnergyKwh: 3000,     // 3 MWh nominal storage
  usableReserveRatio: 0.9, // 90% usable DoD (2,700 kWh usable, 10% floor)
  plannedPvKwp: 250,       // 250 kWp rooftop PV in LOI
  islandTargetHours: 4,    // ≥4 h islanding for precision labs
  pr: 0.8,                 // PV performance ratio (matches pipeline/solar.mjs)
  co2KgPerKwh: 0.474,      // Taiwan MOEA Energy Admin. 2024 grid emission factor
} as const;

export function hourlyPvKw(installedKwp: number, ghiWm2: number | null): number {
  if (!(installedKwp > 0) || ghiWm2 == null || !(ghiWm2 > 0)) return 0;
  return +(installedKwp * (ghiWm2 / 1000) * MICROGRID_LOI.pr).toFixed(1);
}

export function todayPvKwh(installedKwp: number, hourly: HourlyPoint[]): number | null {
  if (!hourly.length || hourly.every(h => h.ghi == null)) return null;
  let sum = 0;
  for (const h of hourly) sum += hourlyPvKw(installedKwp, h.ghi);
  return Math.round(sum);
}

export function annualCo2Tonnes(kwhYr: number): number {
  return +((kwhYr * MICROGRID_LOI.co2KgPerKwh) / 1000).toFixed(1);
}

export interface IslandHourStep {
  hourOffset: number;
  hm: string;
  pvKw: number;
  loadKw: number;
  netBatteryKw: number; // positive = discharging, negative = charging
  socPct: number;       // 0–100% of nominal capacity at end of hour
  overload: boolean;
}

export interface IslandSimulation {
  enduranceHours: number;   // capped at horizon (e.g. 12 h) if still alive
  capped: boolean;          // true if battery survives full horizon
  passes4h: boolean;
  inverterOverload: boolean;
  peakNetDrawKw: number;
  pvAssistKwh4h: number;
  steps: IslandHourStep[];
}

export function simulateIslanding(opts: {
  installedKwp: number;
  criticalLoadKw: number;
  hourly: HourlyPoint[];
  startIndex?: number;
  initialSocPct?: number;
  horizonHours?: number;
}): IslandSimulation {
  const {
    installedKwp,
    criticalLoadKw,
    hourly,
    startIndex = 0,
    initialSocPct = 100,
    horizonHours = 8,
  } = opts;

  const nominal = MICROGRID_LOI.bessEnergyKwh;
  const floorKwh = nominal * (1 - MICROGRID_LOI.usableReserveRatio); // 300 kWh
  let energyKwh = Math.max(floorKwh, Math.min(nominal, (initialSocPct / 100) * nominal));

  const steps: IslandHourStep[] = [];
  let enduranceHours = 0;
  let exhausted = false;
  let inverterOverload = false;
  let peakNetDrawKw = 0;
  let pvAssistKwh4h = 0;

  for (let h = 0; h < horizonHours; h++) {
    const pt = hourly[startIndex + h];
    const hm = pt ? pt.hm : `+${h}h`;
    const pvKw = pt ? hourlyPvKw(installedKwp, pt.ghi) : 0;
    const rawNet = criticalLoadKw - pvKw; // >0 discharge, <0 charge
    const overload = rawNet > MICROGRID_LOI.bessPowerKw;
    if (overload) inverterOverload = true;
    if (rawNet > peakNetDrawKw) peakNetDrawKw = rawNet;
    if (h < 4) pvAssistKwh4h += Math.min(criticalLoadKw, pvKw);

    if (!exhausted) {
      if (rawNet > 0) {
        const available = energyKwh - floorKwh;
        if (available >= rawNet) {
          energyKwh -= rawNet;
          enduranceHours += 1;
        } else {
          const frac = available > 0 ? available / rawNet : 0;
          enduranceHours += frac;
          energyKwh = floorKwh;
          exhausted = true;
        }
      } else {
        // Excess PV recharges battery up to inverter rating and nominal capacity
        const chargeKw = Math.min(-rawNet, MICROGRID_LOI.bessPowerKw);
        energyKwh = Math.min(nominal, energyKwh + chargeKw);
        enduranceHours += 1;
      }
    }

    steps.push({
      hourOffset: h,
      hm,
      pvKw,
      loadKw: criticalLoadKw,
      netBatteryKw: +rawNet.toFixed(1),
      socPct: +((energyKwh / nominal) * 100).toFixed(1),
      overload,
    });
  }

  const roundedEndurance = +enduranceHours.toFixed(1);
  return {
    enduranceHours: roundedEndurance,
    capped: !exhausted,
    passes4h: !inverterOverload && enduranceHours >= MICROGRID_LOI.islandTargetHours,
    inverterOverload,
    peakNetDrawKw: +peakNetDrawKw.toFixed(1),
    pvAssistKwh4h: Math.round(pvAssistKwh4h),
    steps,
  };
}
