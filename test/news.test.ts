import { describe, it, expect } from 'vitest';
import {
  classifyScope,
  classifyTopic,
  mergeNewsCorpus,
  parseGoogleNewsRss,
  summarizeNews,
  toCsv,
  toJsonl,
} from '../src/shared/news';

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title>中央大學攜手台電簽署微電網意向書 建置 1 MW 儲能 - 中央社</title>
    <link>https://example.com/1</link>
    <pubDate>Sun, 22 Nov 2026 04:00:00 GMT</pubDate>
    <source url="https://cna.com.tw">中央社</source>
  </item>
  <item>
    <title>桃園中壢交流道尖峰壅塞 9025A 公車班次調整 - 聯合報</title>
    <link>https://example.com/2</link>
    <pubDate>Sun, 22 Nov 2026 02:00:00 GMT</pubDate>
    <source url="https://udn.com">聯合報</source>
  </item>
</channel></rss>`;

describe('news ingestion & corpus engine', () => {
  it('parses RSS items, strips source suffix, classifies scope & topic', () => {
    const items = parseGoogleNewsRss(SAMPLE_RSS, 'taoyuan', 'zh', '2026-11-22T05:00:00.000Z');
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: '中央大學攜手台電簽署微電網意向書 建置 1 MW 儲能',
      source: '中央社',
      scope: 'ncu',
      topic: 'energy',
    });
    expect(items[1]).toMatchObject({
      source: '聯合報',
      scope: 'taoyuan',
      topic: 'mobility',
    });
  });

  it('deduplicates corpus while preserving earliest firstSeenAt', () => {
    const first = parseGoogleNewsRss(SAMPLE_RSS, 'taoyuan', 'zh', '2026-11-22T05:00:00.000Z');
    const second = parseGoogleNewsRss(SAMPLE_RSS, 'taoyuan', 'zh', '2026-11-22T06:00:00.000Z');
    const merged = mergeNewsCorpus(first, second);
    expect(merged).toHaveLength(2);
    expect(merged[0].firstSeenAt).toBe('2026-11-22T05:00:00.000Z');
  });

  it('summarizes corpus stats and exports valid JSONL and CSV', () => {
    const items = parseGoogleNewsRss(SAMPLE_RSS, 'taoyuan', 'zh', '2026-11-22T05:00:00.000Z');
    const stats = summarizeNews(items, Date.parse('2026-11-22T06:00:00.000Z'));
    expect(stats).toMatchObject({ total: 2, ncuCount: 1, taoyuanCount: 1, last24h: 2 });
    expect(stats.byTopic.energy).toBe(1);
    expect(stats.byTopic.mobility).toBe(1);
    expect(toJsonl(items).trim().split('\n')).toHaveLength(2);
    expect(toCsv(items).trim().split('\n')).toHaveLength(3);
  });

  it('classifies English NCU research headlines accurately', () => {
    expect(classifyScope('National Central University launches lunar payload', 'taoyuan')).toBe('ncu');
    expect(classifyTopic('National Central University launches lunar satellite payload')).toBe('research');
  });
});
