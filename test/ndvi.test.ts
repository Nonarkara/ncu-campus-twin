import { describe, expect, it } from 'vitest';
import published from '../public/data/ndvi.json';

describe('satellite vegetation comparison', () => {
  const properties = published.grid.features.map(feature => feature.properties);
  const threshold = published.meta.threshold;

  it('counts the same classes in the chart and map', () => {
    expect(properties).toHaveLength(published.cells_compared);
    const eligible = properties.filter(p => p.repeated !== null);
    expect(eligible).toHaveLength(published.repeat.comparable);
    expect(published.cells_in_campus - eligible.length).toBe(43);
    for (const className of ['higher', 'lower', 'other'] as const) {
      expect(properties.filter(p => p.shift === className)).toHaveLength(published.latest[className]);
      expect(eligible.filter(p => p.repeated === className)).toHaveLength(published.repeat[className]);
    }
  });

  it('requires both repeat differences to cross the same threshold and direction', () => {
    for (const { d, r, repeated } of properties) {
      const expected = r === null ? null
        : d <= -threshold && r <= -threshold ? 'lower'
        : d >= threshold && r >= threshold ? 'higher'
        : 'other';
      expect(repeated).toBe(expected);
    }
  });
});
