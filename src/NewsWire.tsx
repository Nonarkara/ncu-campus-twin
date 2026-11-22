// Live running news wire + analyzable NCU / Taoyuan news corpus UI.
// Motion law: user-controllable (pause/prev/next), pauses on hover/focus/hidden page, honors prefers-reduced-motion.
import { useEffect, useMemo, useState } from 'react';
import type { NewsPayload, NewsScope, NewsTopic } from './shared/news';

type L = 'en' | 'zh';

const TOPIC_LABEL: Record<NewsTopic, [string, string]> = {
  energy: ['Energy', '能源'],
  mobility: ['Mobility', '交通'],
  environment: ['Env', '環境'],
  research: ['Research', '研究'],
  campus: ['Campus', '校園'],
  civic: ['Taoyuan', '市政'],
};

function relAge(iso: string, l: L) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (Number.isNaN(m)) return iso.slice(0, 10);
  if (m < 1) return l === 'en' ? 'now' : '剛剛';
  if (m < 60) return l === 'en' ? `${m}m` : `${m}分`;
  if (m < 1440) return l === 'en' ? `${Math.round(m / 60)}h` : `${Math.round(m / 60)}時`;
  return l === 'en' ? `${Math.round(m / 1440)}d` : `${Math.round(m / 1440)}天`;
}

export function NewsTicker({ news, l }: { news: NewsPayload | null; l: L }) {
  const items = useMemo(() => (news?.items ?? []).slice(0, 20), [news]);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    if (!items.length || paused || hovering) return;
    const id = setInterval(() => {
      if (!document.hidden) setIdx(i => (i + 1) % items.length);
    }, 6000);
    return () => clearInterval(id);
  }, [items.length, paused, hovering]);

  if (!items.length) return null;
  const cur = items[idx % items.length];

  return (
    <div
      className="ticker"
      role="region"
      aria-label={l === 'en' ? 'NCU and Taoyuan news wire' : '中大與桃園即時新聞跑馬燈'}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={() => setHovering(false)}
    >
      <span className={`tk-scope ${cur.scope === 'ncu' ? 'ncu' : ''}`}>
        {cur.scope === 'ncu' ? 'NCU' : (l === 'en' ? 'TYN' : '桃園')}
      </span>
      <a className="tk-link" href={cur.url} target="_blank" rel="noopener noreferrer" title={cur.title}>
        {cur.title}
      </a>
      <span className="tk-meta">{cur.source} · {relAge(cur.publishedAt, l)}</span>
      <div className="tk-ctl">
        <button onClick={() => setIdx(i => (i - 1 + items.length) % items.length)} aria-label={l === 'en' ? 'Previous headline' : '上一則'}>‹</button>
        <button onClick={() => setPaused(p => !p)} aria-pressed={paused} aria-label={paused ? 'Play wire' : 'Pause wire'}>
          {paused ? '▶' : '❚❚'}
        </button>
        <button onClick={() => setIdx(i => (i + 1) % items.length)} aria-label={l === 'en' ? 'Next headline' : '下一則'}>›</button>
      </div>
    </div>
  );
}

export function NewsCorpusPanel({ news, l }: { news: NewsPayload | null; l: L }) {
  const [scope, setScope] = useState<'all' | NewsScope>('all');
  const [topic, setTopic] = useState<NewsTopic | null>(null);
  const [showAll, setShowAll] = useState(false);

  if (!news || !news.items.length) return null;

  const filtered = news.items.filter(it =>
    (scope === 'all' || it.scope === scope) && (!topic || it.topic === topic),
  );
  const shown = filtered.slice(0, showAll ? 15 : 6);
  const topics = (Object.entries(news.stats.byTopic) as [NewsTopic, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <section className="news-box" aria-label={l === 'en' ? 'News corpus and analysis' : '新聞資料庫與分析'}>
      <div className="strip-head">
        <h2 className="h">
          {l === 'en' ? `News corpus (${news.stats.total})` : `新聞資料庫（${news.stats.total} 則）`}
        </h2>
        <div className="news-exp">
          <a href="/api/news?format=jsonl" download="ncu-taoyuan-news.jsonl">JSONL ↓</a>
          <a href="/api/news?format=csv" download="ncu-taoyuan-news.csv">CSV ↓</a>
        </div>
      </div>

      <p className="meta">
        {l === 'en'
          ? `NCU ${news.stats.ncuCount} · Taoyuan ${news.stats.taoyuanCount} · ${news.stats.last24h} in 24 h · ${news.meta.source}`
          : `中大 ${news.stats.ncuCount}・桃園 ${news.stats.taoyuanCount}・近 24 時 ${news.stats.last24h} 則・${news.meta.source}`}
      </p>

      <div className="chips news-chips" role="group" aria-label={l === 'en' ? 'Filter news' : '篩選新聞'}>
        <button aria-pressed={scope === 'all' && !topic} onClick={() => { setScope('all'); setTopic(null); }}>
          {l === 'en' ? 'All' : '全部'}
        </button>
        <button aria-pressed={scope === 'ncu'} onClick={() => setScope(scope === 'ncu' ? 'all' : 'ncu')}>
          NCU <small>{news.stats.ncuCount}</small>
        </button>
        <button aria-pressed={scope === 'taoyuan'} onClick={() => setScope(scope === 'taoyuan' ? 'all' : 'taoyuan')}>
          {l === 'en' ? 'Taoyuan' : '桃園'} <small>{news.stats.taoyuanCount}</small>
        </button>
        {topics.slice(0, 4).map(([k, n]) => (
          <button key={k} aria-pressed={topic === k} onClick={() => setTopic(topic === k ? null : k)}>
            {TOPIC_LABEL[k][l === 'en' ? 0 : 1]} <small>{n}</small>
          </button>
        ))}
      </div>

      <ul className="news-list">
        {shown.map(it => (
          <li key={it.id}>
            <a href={it.url} target="_blank" rel="noopener noreferrer">{it.title}</a>
            <small>
              <span className={it.scope === 'ncu' ? 'act' : ''}>{it.scope === 'ncu' ? 'NCU' : (l === 'en' ? 'Taoyuan' : '桃園')}</span>
              {' · '}{TOPIC_LABEL[it.topic][l === 'en' ? 0 : 1]}
              {' · '}{it.source}
              {' · '}{relAge(it.publishedAt, l)}
            </small>
          </li>
        ))}
      </ul>

      {filtered.length > 6 && (
        <button className="news-more" onClick={() => setShowAll(s => !s)}>
          {showAll
            ? (l === 'en' ? 'Show fewer' : '收合')
            : (l === 'en' ? `Show more (${Math.min(filtered.length, 15)} of ${filtered.length}) ›` : `顯示更多（${Math.min(filtered.length, 15)} / ${filtered.length}）›`)}
        </button>
      )}
    </section>
  );
}
