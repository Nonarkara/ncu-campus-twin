#!/usr/bin/env node
// Local news corpus archiver: pulls NCU & Taoyuan open RSS feeds, deduplicates into
// var/news/ncu-taoyuan-news.jsonl for offline analysis, and optionally syncs to Cloudflare KV `news_db`.
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGoogleNewsRss } from '../src/shared/news.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KV_ID = '2ce57fb11c484cc0b302fc6e36b1ba22';
const DB_DIR = join(ROOT, 'var/news');
const DB_FILE = join(DB_DIR, 'ncu-taoyuan-news.jsonl');

const FEEDS = [
  { url: 'https://news.google.com/rss/search?q=%22%E4%B8%AD%E5%A4%AE%E5%A4%A7%E5%AD%B8%22&hl=zh-TW&gl=TW&ceid=TW:zh-Hant', scope: 'ncu', lang: 'zh' },
  { url: 'https://news.google.com/rss/search?q=%E6%A1%83%E5%9C%92+%E4%B8%AD%E5%A3%A2&hl=zh-TW&gl=TW&ceid=TW:zh-Hant', scope: 'taoyuan', lang: 'zh' },
  { url: 'https://news.google.com/rss/search?q=%22National+Central+University%22+Taiwan&hl=en-US&gl=US&ceid=US:en', scope: 'ncu', lang: 'en' },
];

// One parser for the relay and the Worker: src/shared/news.ts (tested: link scheme check, title cleanup, scope/topic tags).
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

async function fetchFeed(url, attempts = 2) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'ncu-campus-twin/0.6-cli' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      lastErr = e;
      if (i + 1 < attempts) await new Promise(res => setTimeout(res, 5000));
    }
  }
  throw lastErr;
}

const nowIso = new Date().toISOString();
let added = 0;
let feedsOk = 0;
for (const f of FEEDS) {
  let xml;
  try {
    xml = await fetchFeed(f.url);
    feedsOk++;
  } catch (e) {
    console.error(nowIso, `news-relay feed error (${f.scope}/${f.lang}):`, e?.cause?.code || e?.message || String(e));
    continue;
  }
  for (const it of parseGoogleNewsRss(xml, f.scope, f.lang, nowIso, 30)) {
    if (!existing.has(it.id)) { existing.set(it.id, it); added++; }
  }
}

if (feedsOk === 0) {
  console.error(nowIso, 'news-relay: all 3 RSS feeds unreachable; keeping existing KV timestamp.');
  process.exit(1);
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
