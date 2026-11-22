import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseYouBike, parseVDLive, VDS, DOCKS } from '../src/shared/live';

const xml = readFileSync(new URL('./fixtures/vdlive.xml', import.meta.url), 'utf8');
const yb = JSON.parse(readFileSync(new URL('./fixtures/youbike.json', import.meta.url), 'utf8'));

describe('YouBike docks', () => {
  it('conserves docks: bikes + free ≤ capacity, and every station keeps its capacity', () => {
    const d = parseYouBike(yb);
    expect(d.length).toBe(DOCKS.length);
    for (const s of d) { expect(s.bikes + s.free).toBeLessThanOrEqual(s.capacity); expect(s.capacity).toBeGreaterThan(0); }
  });
  it('omits a station that is missing from the feed instead of zero-filling it', () => {
    expect(parseYouBike(yb, ['500304001', '999999999']).map(s => s.id)).toEqual(['500304001']);
  });
});

describe('Freeway detectors', () => {
  it('returns a volume-weighted speed inside the lane-speed range', () => {
    const f = parseVDLive(xml);
    expect(f.length).toBeGreaterThan(0);
    for (const x of f) if (x.speed !== null) { expect(x.speed).toBeGreaterThan(0); expect(x.speed).toBeLessThan(160); }
  });
  it('drops a detector that is absent or not in normal status', () => {
    expect(parseVDLive(xml, [{ ...VDS[0], id: 'VD-NOPE' }])).toEqual([]);
    const bad = xml.replace(/<Status>0<\/Status>/, '<Status>1</Status>');
    expect(parseVDLive(bad).length).toBe(parseVDLive(xml).length - 1);
  });
});
