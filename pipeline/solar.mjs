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
