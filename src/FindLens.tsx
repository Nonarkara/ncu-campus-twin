// Find lens: the official NCU directory, by category, every entry linked to the page it came from.
import { useMemo, useState } from 'react';

type L = 'en' | 'zh';
export interface Entry { zh: string | null; en: string | null; url: string; phone: string | null; building: string | null; osm: string | null; note: string | null;
  capacity: { value: number; unit: string; source: string } | null }
export interface Directory { meta: { source: string; asOf: string }; categories: { key: string; entries: Entry[] }[] }

const CAT: Record<string, [string, string]> = {
  safety: ['Safety', '安全'], academic: ['Academic', '學術單位'], admin: ['Offices', '行政單位'],
  research: ['Research', '研究中心'], housing: ['Housing', '住宿'], facility: ['Facilities', '設施'],
};
const ORDER = ['safety', 'academic', 'admin', 'research', 'housing', 'facility'];
const UNIT: Record<string, [string, string]> = { seats: ['seats', '席'], beds: ['beds', '床'], spaces: ['spaces', '格'] };

export function FindLens({ dir, onFocusBuilding, l }: { dir: Directory | null; onFocusBuilding: (id: string) => void; l: L }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const cats = useMemo(() => (dir ? ORDER.map(k => dir.categories.find(c => c.key === k)).filter(Boolean) as Directory['categories'] : []), [dir]);
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    return cats.filter(c => !cat || c.key === cat).map(c => ({ ...c, entries: c.entries.filter(e =>
      !s || `${e.zh ?? ''} ${e.en ?? ''} ${e.building ?? ''}`.toLowerCase().includes(s)) })).filter(c => c.entries.length);
  }, [cats, q, cat]);
  if (!dir) return <p className="note">{l === 'en' ? 'Loading directory…' : '讀取名錄中…'}</p>;
  const total = cats.reduce((s, c) => s + c.entries.length, 0);
  const withCap = cats.flatMap(c => c.entries).filter(e => e.capacity).length;

  return (
    <>
      <div className="hero">
        <b>{total}</b>
        <p>{l === 'en' ? `units, offices and places, each linked to its official page · ${withCap} with a published capacity`
          : `個單位、處室與場所，皆連結官方頁面・${withCap} 項有公開容量`}<br />
          <small className="meta">{dir.meta.source} · {dir.meta.asOf}</small></p>
      </div>
      <input type="search" className="search find" value={q} onChange={e => setQ(e.target.value)}
        placeholder={l === 'en' ? 'Department, office, dorm…' : '系所、處室、宿舍…'} aria-label={l === 'en' ? 'Search directory' : '搜尋名錄'} />
      <div className="chips" role="group">
        {cats.map(c => (
          <button key={c.key} aria-pressed={cat === c.key} onClick={() => setCat(cat === c.key ? null : c.key)}>
            {CAT[c.key]?.[l === 'en' ? 0 : 1] ?? c.key} <small>{c.entries.length}</small>
          </button>
        ))}
      </div>
      {hits.map(c => (
        <section key={c.key}>
          <h2 className="h">{CAT[c.key]?.[l === 'en' ? 0 : 1] ?? c.key}</h2>
          <ul className="dir">
            {c.entries.map((e, i) => {
              const name = l === 'en' ? e.en ?? e.zh : e.zh ?? e.en;
              const alt = l === 'en' ? (e.en ? e.zh : null) : e.en;
              return (
                <li key={i}>
                  <a href={e.url} target="_blank" rel="noopener noreferrer">{name}</a>
                  {alt && <span className="alt">{alt}</span>}
                  <span className="meta">
                    {e.capacity && <a className="cap" href={e.capacity.source} target="_blank" rel="noopener noreferrer">
                      {e.capacity.value.toLocaleString('en-US')} {UNIT[e.capacity.unit]?.[l === 'en' ? 0 : 1] ?? e.capacity.unit}</a>}
                    {e.phone && <a href={`tel:${e.phone.replace(/[^0-9#+]/g, '').replace('#', ',')}`}>{e.phone}</a>}
                    {e.osm && <button onClick={() => onFocusBuilding(e.osm!)}>{l === 'en' ? 'Map' : '地圖'} ›</button>}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <p className="note">{l === 'en'
        ? '“Map” appears only where the official building name matches a mapped footprint. Dorm bed counts and current car parking are not published.'
        : '僅在官方建物名稱與地圖輪廓相符時顯示「地圖」。宿舍床位與現行汽車格數未公開。'}</p>
    </>
  );
}
