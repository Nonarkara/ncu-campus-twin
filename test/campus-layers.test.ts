import { expect, it } from 'vitest';
import dataset from '../public/data/campus-layers.json';
import { makeWalkers, sampleWalkers, STUDENT_HEIGHT, WALK_SPEED, walkerFeatures, type CampusLayers } from '../src/shared/campus-layers';

const paths = (dataset as CampusLayers).paths;

it('keeps every rendered walker on one imported segment and uses metric figure heights', () => {
  const walkers = makeWalkers(paths);
  expect(walkers).toHaveLength(24);
  const data = walkerFeatures(walkers, 37);
  const points = data.features.filter(f => f.geometry.type === 'Point');
  const body = data.features.filter(f => f.geometry.type === 'Polygon');
  expect(points).toHaveLength(walkers.length);
  expect(body.map(f => f.properties?.height).sort((a, b) => b - a)[0]).toEqual(STUDENT_HEIGHT);
  for (const sample of sampleWalkers(walkers, 37)) {
    const line = paths.features.find(f => f.properties.id === sample.id)!.geometry.coordinates;
    const [x, y] = sample.coord;
    expect(line.slice(1).some(([bx, by], i) => {
      const [ax, ay] = line[i];
      return Math.abs((x - ax) * (by - ay) - (y - ay) * (bx - ax)) < 1e-14 &&
        x >= Math.min(ax, bx) - 1e-12 && x <= Math.max(ax, bx) + 1e-12 &&
        y >= Math.min(ay, by) - 1e-12 && y <= Math.max(ay, by) + 1e-12;
    })).toBe(true);
  }
});

it('advances at walking speed and reverses at the source path endpoint', () => {
  const line: CampusLayers['paths'] = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature', properties: { id: 'way/1/0', osm: 'way/1' },
      geometry: { type: 'LineString', coordinates: [[121, 25], [121, 25.001]] },
    }],
  };
  const walkers = makeWalkers(line);
  const latAt = (time: number) => sampleWalkers(walkers, time)[0].coord[1];
  expect((latAt(1) - latAt(0)) * 111195).toBeCloseTo(WALK_SPEED, 6);
  const end = (.001 * 111195 * (1 - 0.54)) / WALK_SPEED;
  expect(latAt(end)).toBeCloseTo(25.001, 10);
  expect(latAt(end + 1)).toBeCloseTo(latAt(end - 1), 10);
});

it('keeps mapped parking geometry distinct from unknown capacity', () => {
  const { parking, meta } = dataset as CampusLayers;
  const features = parking.features;
  expect(meta.crs).toBe('EPSG:4326');
  expect(new Set(features.map(f => f.properties.osm)).size).toBe(features.length);
  expect(features.some(f => f.geometry.type === 'Point' && f.properties.osm.startsWith('node/'))).toBe(true);
  expect(features.some(f => f.geometry.type === 'Polygon' && f.properties.osm.startsWith('way/'))).toBe(true);
  expect(features.filter(f => f.properties.capacity === null).length).toBeGreaterThan(0);
});
