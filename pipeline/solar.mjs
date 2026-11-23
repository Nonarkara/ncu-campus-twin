// Rooftop-solar screening model. Assumptions are explicit and shipped with the output.
export const SOLAR = {
  usableRoof: 0.5,      // high case: share of footprint usable for panels
  usableRoofLow: 0.25,  // low case: pitched roofs, plant rooms, heritage, shading
  kwpPerM2: 0.2,        // ~200 W/m² module density at typical spacing on flat roofs
  pr: 0.8,              // performance ratio
  minAreaM2: 100,       // ignore sheds and kiosks
  storeyM: 3.5,         // only used where OSM has building:levels
};
export function roofSolar(areaM2) {
  if (!(areaM2 >= SOLAR.minAreaM2)) return { kwp: 0 };
  return { kwp: +(areaM2 * SOLAR.usableRoof * SOLAR.kwpPerM2).toFixed(1) };
}

/** A complete Taipei calendar year of daily horizontal shortwave energy. */
export function monthlyIrradiation(archive, year) {
  const { time, shortwave_radiation_sum: values } = archive.daily;
  if (archive.timezone !== 'Asia/Taipei' || archive.daily_units.shortwave_radiation_sum !== 'MJ/m²') {
    throw new Error('Expected Taipei daily shortwave radiation in MJ/m²');
  }
  const totals = Array.from({ length: 12 }, (_, month) => ({
    month: month + 1,
    days: new Date(Date.UTC(year, month + 1, 0)).getUTCDate(),
    sumMjM2: 0,
  }));
  const size = totals.reduce((sum, month) => sum + month.days, 0);
  if (time.length !== size || values.length !== size) throw new Error(`Expected ${size} daily values`);
  for (const [i, value] of values.entries()) {
    const date = new Date(Date.UTC(year, 0, i + 1));
    const expected = date.toISOString().slice(0, 10);
    if (time[i] !== expected || !Number.isFinite(value) || value < 0) throw new Error(`Invalid shortwave radiation on ${expected}`);
    totals[date.getUTCMonth()].sumMjM2 += value;
  }
  return totals.map(({ month, days, sumMjM2 }) => ({ month, days, kwhM2: sumMjM2 / 3.6 }));
}
