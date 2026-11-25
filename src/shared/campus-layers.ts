import type { FeatureCollection, LineString, Point, Polygon } from 'geojson';

type Coord = [number, number];
export type ParkingKind = 'parking' | 'parking_space' | 'bicycle_parking' | 'motorcycle_parking';
export interface ParkingProperties {
  osm: string;
  kind: ParkingKind;
  name: string | null;
  capacity: number | null;
  access: string | null;
}
export interface CampusLayers {
  meta: { source: string; sourceUrl: string; asOf: string; crs: 'EPSG:4326' };
  parking: FeatureCollection<Point | Polygon, ParkingProperties>;
  paths: FeatureCollection<LineString, { id: string; osm: string }>;
}

export const STUDENT_HEIGHT = 1.7;
export const WALK_SPEED = 1.25;
export const STUDENT_LIMIT = 24;
const METERS_PER_DEGREE = 111195;

interface Walker {
  id: string;
  path: Coord[];
  cumulative: number[];
  length: number;
  phase: number;
}

export function makeWalkers(paths: CampusLayers['paths']): Walker[] {
  const lines = paths.features;
  const count = Math.min(STUDENT_LIMIT, lines.length);
  return Array.from({ length: count }, (_, i) => {
    const line = lines[Math.floor(i * lines.length / count)];
    const path = line.geometry.coordinates as Coord[];
    const cumulative = [0];
    for (let n = 1; n < path.length; n++) {
      const [x0, y0] = path[n - 1], [x1, y1] = path[n];
      const scale = METERS_PER_DEGREE * Math.cos((y0 + y1) * Math.PI / 360);
      cumulative.push(cumulative[n - 1] + Math.hypot((x1 - x0) * scale, (y1 - y0) * METERS_PER_DEGREE));
    }
    return {
      id: line.properties.id, path, cumulative, length: cumulative.at(-1)!,
      phase: (0.27 + i * 0.61803398875) % 1,
    };
  }).filter(w => w.length > 0);
}

/** The same metric sample can later be aggregated by zone without involving the map renderer. */
export function sampleWalkers(walkers: Walker[], seconds: number) {
  return walkers.map(({ id, path, cumulative, length, phase }) => {
    const position = (phase * 2 * length + Math.max(0, seconds) * WALK_SPEED) % (2 * length);
    const distance = position <= length ? position : 2 * length - position;
    const n = cumulative.findIndex((end, index) => index > 0 && end >= distance && end > cumulative[index - 1]);
    const [x0, y0] = path[n - 1], [x1, y1] = path[n];
    const fraction = (distance - cumulative[n - 1]) / (cumulative[n] - cumulative[n - 1]);
    return { id, coord: [x0 + (x1 - x0) * fraction, y0 + (y1 - y0) * fraction] as Coord };
  });
}

export function walkerFeatures(walkers: Walker[], seconds: number): FeatureCollection<Point | Polygon> {
  const samples = sampleWalkers(walkers, seconds);
  return {
    type: 'FeatureCollection',
    features: samples.flatMap(({ id, coord }) => {
      const [lon, lat] = coord;
      const lonScale = METERS_PER_DEGREE * Math.cos(lat * Math.PI / 180);
      const part = (dx: number, dy: number, base: number, height: number) => ({
        type: 'Feature' as const, properties: { id, base, height },
        geometry: { type: 'Polygon' as const, coordinates: [[
          [lon - dx / lonScale, lat - dy / METERS_PER_DEGREE],
          [lon + dx / lonScale, lat - dy / METERS_PER_DEGREE],
          [lon + dx / lonScale, lat + dy / METERS_PER_DEGREE],
          [lon - dx / lonScale, lat + dy / METERS_PER_DEGREE],
          [lon - dx / lonScale, lat - dy / METERS_PER_DEGREE],
        ]] },
      });
      return [
        { type: 'Feature', properties: { id }, geometry: { type: 'Point', coordinates: coord } },
        part(0.16, 0.12, 0, 0.75),
        part(0.24, 0.15, 0.75, 1.45),
        part(0.105, 0.105, 1.45, STUDENT_HEIGHT),
      ];
    }),
  };
}
