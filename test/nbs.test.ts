import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NbsDataset } from '../src/NbsInspector';

const ROOT = resolve(import.meta.dirname, '..');
const nbs: NbsDataset = JSON.parse(readFileSync(resolve(ROOT, 'public/data/nbs.json'), 'utf8'));

describe('NbS field survey dataset & geographic truth', () => {
  it('contains all 19 optimized campus NbS photos under 300 KB each', () => {
    expect(nbs.items).toHaveLength(19);
    for (const it of nbs.items) {
      const filePath = resolve(ROOT, 'public', it.src.replace(/^\//, ''));
      expect(existsSync(filePath)).toBe(true);
      expect(statSync(filePath).size).toBeLessThan(300 * 1024);
      expect(it.title[0].length).toBeGreaterThan(4);
      expect(it.title[1].length).toBeGreaterThan(2);
      expect(it.summary[0].length).toBeGreaterThan(20);
      expect(it.summary[1].length).toBeGreaterThan(10);
      expect(it.functions.length).toBeGreaterThan(0);
    }
  });

  it('enforces geographic truth: never pins [0,0], pinned coords lie in NCU bbox, unpinned has coord=null', () => {
    const pinned = nbs.items.filter(x => x.coord !== null);
    expect(pinned.length).toBeGreaterThanOrEqual(2);
    for (const it of nbs.items) {
      if (it.locationTier === 'unpinned') {
        expect(it.coord).toBeNull();
      } else {
        expect(it.coord).not.toBeNull();
        const [lon, lat] = it.coord!;
        expect(lon).toBeGreaterThan(121.184);
        expect(lon).toBeLessThan(121.198);
        expect(lat).toBeGreaterThan(24.964);
        expect(lat).toBeLessThan(24.973);
      }
    }
  });
});
