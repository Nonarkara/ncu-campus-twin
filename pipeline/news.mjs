#!/usr/bin/env node
// Local news corpus archiver: pulls NCU & Taoyuan open RSS feeds, deduplicates into
// var/news/ncu-taoyuan-news.jsonl for offline analysis, and optionally syncs to Cloudflare KV `news_db`.
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KV_ID = '2ce57fb11c484cc0b302fc6e36b1ba22';
const DB_DIR = join(ROOT, 'var/news');
const DB_FILE = join(DB_DIR, 'ncu-taoyuan-news.jsonl');

const FEEDS = [
  { url: 'https://news.google.com/rss/search?q=%22%E4%B8%AD%E5%A4%AE%E5%A4%A7%E5%AD%B8%22&hl=zh-TW&gl=TW&ceid=TW:zh-Hant', scope: 'ncu', lang: 'zh' },
  { url: 'https://news.google.com/rss/search?q=%E6%A1%83%E5%9C%92+%E4%B8%AD%E5%A3%A2&hl=zh-TW&gl=TW&ceid=TW:zh-Hant', scope: 'taoyuan', lang: 'zh' },
  { url: 'https://news.google.com/rss/search?q=%22National+Central+University%22+Taiwan&hl=en-US&gl=US&ceid=US:en', scope: 'ncu', lang: 'en' },
];

const decodeXml = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
const normTitle = s => s.toLowerCase().replace(/[\s\p{P}]+/gu, '');
const classifyScope = (t, def) => (/中央大學|中大(?![路湖])|national central university|\bncu\b/i.test(t) ? 'ncu' : def === 'ncu' && /中大|中央/i.test(t) ? 'ncu' : 'taoyuan');
const classifyTopic = t =>
  /微電網|太陽能|光電|儲能|停電|台電|電網|淨零|碳中和|綠能|節能|氫能|microgrid|solar|energy|carbon|power/i.test(t) ? 'energy'
  : /公車|9025|高鐵|捷運|國道|交流道|交通|停車|YouBike|鐵路|火車|塞車|轉運|bus|transit|traffic|rail|metro/i.test(t) ? 'mobility'
  : /豪雨|大雨|颱風|空品|PM2\.?5|高溫|地震|水情|降雨|淹水|氣象|生態|環境|weather|rain|quake|air|climate|flood/i.test(t) ? 'environment'
  : /衛星|太空|遙測|AI|人工智慧|實驗室|研究|量子|晶片|半導體|產學|鹿林|USR|satellite|space|research|lab|quantum|ai\b/i.test(t) ? 'research'
  : /宿舍|招生|校長|總務|校慶|開學|學生|運動會|獎學金|圖書館|教授|campus|student|dorm|university/i.test(t) ? 'campus'
  : 'civic';

function hashId(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

await mkdir(DB_DIR, { recursive: true });
const existing = new Map();
try {
  const txt = await readFile(DB_FILE, 'utf8');
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line);
    existing.set(obj.id, obj);
  }
} catch { /* first run */ }

const nowIso = new Date().toISOString();
let added = 0;
for (const f of FEEDS) {
  const r = await fetch(f.url, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'ncu-campus-twin/0.6-cli' } });
  if (!r.ok) continue;
  const xml = await r.text();
  let count = 0;
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    if (count++ >= 30) break;
    const b = m[1];
    const rawTitle = decodeXml(b.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
    const url = decodeXml(b.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? '');
    const pubRaw = decodeXml(b.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? '');
    const srcTag = decodeXml(b.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? '');
    if (!rawTitle || !url) continue;
    const source = srcTag || 'Google News';
    const title = srcTag && rawTitle.endsWith(` - ${srcTag}`) ? rawTitle.slice(0, -(srcTag.length + 3)).trim() : rawTitle;
    const norm = normTitle(title);
    if (!norm) continue;
    const id = hashId(norm);
    const ms = Date.parse(pubRaw);
    const publishedAt = Number.isNaN(ms) ? nowIso : new Date(ms).toISOString();
    if (!existing.has(id)) {
      existing.set(id, { id, title, url, source, publishedAt, firstSeenAt: nowIso, scope: classifyScope(title, f.scope), topic: classifyTopic(title), lang: f.lang });
      added++;
    }
  }
}

const rows = [...existing.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
await writeFile(DB_FILE, rows.map(r => JSON.stringify(r)).join('\n') + '\n');

// Push latest 300 deduplicated articles to Cloudflare KV `LIVE` (`news_db`) so /api/news stays live
const store = { updatedAt: nowIso, items: rows.slice(0, 300) };
const wrangler = join(ROOT, 'node_modules/.bin/wrangler');
const tmpJson = join(DB_DIR, 'news_db.json');
await writeFile(tmpJson, JSON.stringify(store));
execFileSync(wrangler, ['kv', 'key', 'put', 'news_db', '--path', tmpJson, '--namespace-id', KV_ID, '--remote'], { cwd: ROOT, stdio: 'pipe' });
console.log(`${nowIso} archived ${rows.length} total articles (+${added} new) -> var/news/ncu-taoyuan-news.jsonl & KV news_db (${store.items.length})`);
