import { expect, it } from 'vitest';
import campus from '../public/data/campus.json';
import directory from '../public/data/directory.json';
import { BUILDING_IDENTITIES } from '../src/shared/campus';

it('links each official identity to one existing footprint and at least one Find entry', () => {
  const entries = directory.categories.flatMap(category => category.entries.map(entry => entry.osm));
  expect(BUILDING_IDENTITIES.size).toBe(5);
  for (const identity of BUILDING_IDENTITIES.values()) {
    const footprints = campus.buildings.features.filter(feature => feature.properties.id === identity.id);
    expect(footprints).toHaveLength(1);
    expect(entries.includes(identity.id)).toBe(true);
  }
  expect(campus.buildings.features).toHaveLength(109);
});

it('keeps Male Dorm #6 flat and the four confirmed heights on their own footprints', () => {
  const props = campus.buildings.features.map(feature => feature.properties);
  expect(props.find(p => p.id === 'way/268824432')).toMatchObject({ height_m: null, height_tier: null });
  const measured = ['way/202805788', 'way/202806573', 'way/202690841', 'way/217833430'];
  expect(measured.map(id => props.find(p => p.id === id)?.height_m)).toEqual([42.6, 31.8, 20.8, 16.4]);
});
