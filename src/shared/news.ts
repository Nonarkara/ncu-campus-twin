// Open-news ingestion, classification, deduplication, and analytics for NCU & Taoyuan.
// Pure functions, zero dependencies — runs identically in Cloudflare Worker and Node CLI.
import type { Meta } from './today';

export type NewsScope = 'ncu' | 'taoyuan';
export type NewsTopic = 'energy' | 'mobility' | 'environment' | 'research' | 'campus' | 'civic';

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string; // ISO-8601
  firstSeenAt: string; // ISO-8601
  scope: NewsScope;
  topic: NewsTopic;
  lang: 'zh' | 'en';
}

export interface NewsStats {
  total: number;
  ncuCount: number;
  taoyuanCount: number;
  last24h: number;
  byTopic: Record<NewsTopic, number>;
  topSources: { source: string; count: number }[];
}

export interface NewsPayload {
  meta: Meta;
  items: NewsItem[];
  stats: NewsStats;
}

export const NEWS_FEEDS: { id: string; url: string; defaultScope: NewsScope; lang: 'zh' | 'en' }[] = [
  {
    id: 'ncu-zh',
    url: 'https://news.google.com/rss/search?q=%22%E4%B8%AD%E5%A4%AE%E5%A4%A7%E5%AD%B8%22&hl=zh-TW&gl=TW&ceid=TW:zh-Hant',
    defaultScope: 'ncu',
    lang: 'zh',
  },
  {
    id: 'taoyuan-zh',
    url: 'https://news.google.com/rss/search?q=%E6%A1%83%E5%9C%92+%E4%B8%AD%E5%A3%A2&hl=zh-TW&gl=TW&ceid=TW:zh-Hant',
    defaultScope: 'taoyuan',
    lang: 'zh',
  },
  {
    id: 'ncu-en',
    url: 'https://news.google.com/rss/search?q=%22National+Central+University%22+Taiwan&hl=en-US&gl=US&ceid=US:en',
    defaultScope: 'ncu',
    lang: 'en',
  },
];

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[\s\p{P}]+/gu, '');
}

export function classifyScope(title: string, defaultScope: NewsScope): NewsScope {
  if (/中央大學|中大(?![路湖])|national central university|\bncu\b/i.test(title)) return 'ncu';
  return defaultScope === 'ncu' && /中大|中央/i.test(title) ? 'ncu' : 'taoyuan';
}

export function classifyTopic(title: string): NewsTopic {
  if (/微電網|太陽能|光電|儲能|停電|台電|電網|淨零|碳中和|綠能|節能|氫能|microgrid|solar|energy|carbon|power/i.test(title)) return 'energy';
  if (/公車|9025|高鐵|捷運|國道|交流道|交通|停車|YouBike|鐵路|火車|塞車|轉運|bus|transit|traffic|rail|metro/i.test(title)) return 'mobility';
  if (/豪雨|大雨|颱風|空品|PM2\.?5|高溫|地震|水情|降雨|淹水|氣象|生態|環境|weather|rain|quake|air|climate|flood/i.test(title)) return 'environment';
  if (/衛星|太空|遙測|AI|人工智慧|實驗室|研究|量子|晶片|半導體|產學|鹿林|USR|satellite|space|research|lab|quantum|ai\b/i.test(title)) return 'research';
  if (/宿舍|招生|校長|總務|校慶|開學|學生|運動會|獎學金|圖書館|教授|campus|student|dorm|university/i.test(title)) return 'campus';
  return 'civic';
}

function hashId(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function parseGoogleNewsRss(
  xml: string,
  defaultScope: NewsScope,
  lang: 'zh' | 'en',
  nowIso: string,
  limit = 25,
): NewsItem[] {
  const items: NewsItem[] = [];
  const matches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
  for (const m of matches) {
    if (items.length >= limit) break;
    const block = m[1];
    const rawTitle = decodeXml(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
    const url = decodeXml(block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? '');
    const pubRaw = decodeXml(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? '');
    const srcTag = decodeXml(block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? '');
    if (!rawTitle || !url) continue;

    // Strip trailing " - SourceName" that Google News appends to titles
    let title = rawTitle;
    let source = srcTag || 'Google News';
    const suffix = ` - ${source}`;
    if (srcTag && title.endsWith(suffix)) {
      title = title.slice(0, -suffix.length).trim();
    } else if (!srcTag) {
      const idx = title.lastIndexOf(' - ');
      if (idx > 12) {
        source = title.slice(idx + 3).trim();
        title = title.slice(0, idx).trim();
      }
    }

    const parsedMs = Date.parse(pubRaw);
    const publishedAt = Number.isNaN(parsedMs) ? nowIso : new Date(parsedMs).toISOString();
    const norm = normalizeTitle(title);
    if (!norm) continue;

    items.push({
      id: hashId(norm),
      title,
      url,
      source,
      publishedAt,
      firstSeenAt: nowIso,
      scope: classifyScope(title, defaultScope),
      topic: classifyTopic(title),
      lang,
    });
  }
  return items;
}

export function mergeNewsCorpus(existing: NewsItem[], incoming: NewsItem[], maxItems = 300): NewsItem[] {
  const byId = new Map<string, NewsItem>();
  for (const it of existing) byId.set(it.id, it);
  for (const it of incoming) {
    const prev = byId.get(it.id);
    if (prev) {
      // Preserve earliest firstSeenAt and upgrade scope to 'ncu' if matched
      byId.set(it.id, {
        ...it,
        firstSeenAt: prev.firstSeenAt < it.firstSeenAt ? prev.firstSeenAt : it.firstSeenAt,
        scope: prev.scope === 'ncu' || it.scope === 'ncu' ? 'ncu' : 'taoyuan',
      });
    } else {
      byId.set(it.id, it);
    }
  }
  return [...byId.values()]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, maxItems);
}

export function summarizeNews(items: NewsItem[], nowMs = Date.now()): NewsStats {
  const byTopic: Record<NewsTopic, number> = {
    energy: 0, mobility: 0, environment: 0, research: 0, campus: 0, civic: 0,
  };
  const srcCounts = new Map<string, number>();
  let ncuCount = 0, taoyuanCount = 0, last24h = 0;
  const cutoff = nowMs - 24 * 3600e3;

  for (const it of items) {
    if (it.scope === 'ncu') ncuCount++;
    else taoyuanCount++;
    if (Date.parse(it.publishedAt) >= cutoff) last24h++;
    byTopic[it.topic] = (byTopic[it.topic] ?? 0) + 1;
    srcCounts.set(it.source, (srcCounts.get(it.source) ?? 0) + 1);
  }

  const topSources = [...srcCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([source, count]) => ({ source, count }));

  return { total: items.length, ncuCount, taoyuanCount, last24h, byTopic, topSources };
}

export function toJsonl(items: NewsItem[]): string {
  return items.map(it => JSON.stringify(it)).join('\n') + (items.length ? '\n' : '');
}

const csvEsc = (v: string) => `"${v.replace(/"/g, '""')}"`;
export function toCsv(items: NewsItem[]): string {
  const header = 'id,publishedAt,firstSeenAt,scope,topic,lang,source,title,url';
  const rows = items.map(it =>
    [it.id, it.publishedAt, it.firstSeenAt, it.scope, it.topic, it.lang, it.source, it.title, it.url].map(csvEsc).join(','),
  );
  return [header, ...rows].join('\n') + '\n';
}
