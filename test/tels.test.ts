import { describe, it, expect } from 'vitest';
// @ts-expect-error plain .mjs pipeline module
import { tels } from '../pipeline/tels.mjs';

const h = (s: string) => tels(s).map((t: { href: string }) => t.href);
describe('dialable numbers', () => {
  it('links each number on its own and never glues extensions, hours or labels into it', () => {
    expect(h('03-280-5666 / 0911-949-630 (分機 57212)')).toEqual(['tel:+88632805666', 'tel:+886911949630']);
    expect(h('東區 24h 0919019864 (分機 57291)')).toEqual(['tel:+886919019864']);
    expect(h('03-426-3926 (Mon-Fri 08:00-17:00)')).toEqual(['tel:+88634263926']);
  });
  it('dials a written #extension after a pause; an internal-only extension is not dialable', () => {
    expect(h('03-4227151#57270, 03-2804814')).toEqual(['tel:+88634227151,57270', 'tel:+88632804814']);
    expect(h('校內分機 57183')).toEqual([]);
  });
});
