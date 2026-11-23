// Nature-based Solutions (NbS) field survey inspector & gallery.
// Ground-truthed campus photos taken by Dr Non; pinned only where verified coordinates exist.
import { useState } from 'react';

type L = 'en' | 'zh';
export type NbsCategory = 'water' | 'shade' | 'windbreak' | 'ecology';

export interface NbsItem {
  id: string;
  takenAt: string;
  src: string;
  category: NbsCategory;
  functions: string[];
  title: [string, string];
  summary: [string, string];
  locationTier: 'gps' | 'landmark' | 'unpinned';
  locationNote: [string, string];
  coord: [number, number] | null;
}

export interface NbsDataset {
  meta: { source: string; tier: string; asOf: string; note: string };
  items: NbsItem[];
}

const CAT_LABEL: Record<NbsCategory, [string, string]> = {
  water: ['Water / Sponge', '蓄水透水'],
  shade: ['Shade / Cooling', '遮蔭降溫'],
  windbreak: ['Windbreak', '防風緩衝'],
  ecology: ['Ecology / Facade', '生態綠牆'],
};

const FN_LABEL: Record<string, [string, string]> = {
  infiltration: ['Infiltration', '入滲保水'],
  runoff: ['Runoff capture', '截留逕流'],
  shade: ['Canopy shade', '樹冠遮蔭'],
  cooling: ['Microclimate cooling', '微氣候降溫'],
  windbreak: ['Windbreak', '防風減速'],
  facade: ['Green facade', '攀緣綠牆'],
  habitat: ['Urban habitat', '生態棲地'],
  carbon: ['Carbon asset', '固碳林木'],
};

const pick = (p: [string, string], l: L) => (l === 'en' ? p[0] : p[1]);

export function NbsInspector({
  dataset,
  selectedId,
  onSelect,
  onClose,
  l,
}: {
  dataset: NbsDataset;
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  l: L;
}) {
  const idx = dataset.items.findIndex(x => x.id === selectedId);
  if (idx < 0) return null;
  const item = dataset.items[idx];
  const prev = dataset.items[(idx - 1 + dataset.items.length) % dataset.items.length];
  const next = dataset.items[(idx + 1) % dataset.items.length];

  return (
    <aside className="inspector nbs-insp" aria-label={l === 'en' ? 'NbS field observation' : '自然解方現地紀錄'}>
      <div className="insp-head">
        <div>
          <strong>{pick(item.title, l)}</strong>
          <span className="tag">{pick(CAT_LABEL[item.category], l)}</span>
        </div>
        <button className="xbtn" onClick={onClose} aria-label={l === 'en' ? 'Close NbS inspector' : '關閉'}>×</button>
      </div>

      <figure className="nbs-fig">
        <img src={item.src} alt={pick(item.title, l)} loading="eager" />
      </figure>

      <p className="nbs-desc">{pick(item.summary, l)}</p>

      <div className="nbs-fns">
        {item.functions.map(fn => (
          <span key={fn} className="nbs-fn">{FN_LABEL[fn] ? pick(FN_LABEL[fn], l) : fn}</span>
        ))}
      </div>

      <p className="meta">
        {pick(item.locationNote, l)}
        {item.coord && ` · ${item.coord[1].toFixed(5)}°N, ${item.coord[0].toFixed(5)}°E`}
        <br />
        {dataset.meta.source} · {l === 'en' ? 'observed' : '現地觀測'} · {item.takenAt.slice(0, 16).replace('T', ' ')} TPE
      </p>

      <div className="insp-foot">
        <span className="meta">{idx + 1} / {dataset.items.length}</span>
        <div className="seg">
          <button onClick={() => onSelect(prev.id)} aria-label={l === 'en' ? 'Previous NbS photo' : '上一張'}>‹ {l === 'en' ? 'Prev' : '上一張'}</button>
          <button onClick={() => onSelect(next.id)} aria-label={l === 'en' ? 'Next NbS photo' : '下一張'}>{l === 'en' ? 'Next' : '下一張'} ›</button>
        </div>
      </div>
    </aside>
  );
}

export function NbsGallery({
  dataset,
  selectedId,
  onSelect,
  l,
}: {
  dataset: NbsDataset;
  selectedId: string | null;
  onSelect: (id: string) => void;
  l: L;
}) {
  const [cat, setCat] = useState<'all' | NbsCategory>('all');
  const pinnedCount = dataset.items.filter(x => x.coord !== null).length;
  const shown = cat === 'all' ? dataset.items : dataset.items.filter(x => x.category === cat);
  const cats: NbsCategory[] = ['water', 'shade', 'windbreak', 'ecology'];

  return (
    <section className="nbs-box" aria-label={l === 'en' ? 'Nature-based solutions field survey' : '自然解方現地調查'}>
      <div className="strip-head">
        <h2 className="h">
          {l === 'en' ? `Nature-based Solutions (${dataset.items.length} photos)` : `自然解方 NbS（${dataset.items.length} 張現地照片）`}
        </h2>
        <span className="meta">
          {l === 'en' ? `${pinnedCount} pinned on map` : `${pinnedCount} 處已標點`}
        </span>
      </div>

      <p className="meta">
        {l === 'en'
          ? 'Click any dot on the map or photo below to inspect its water, shade, or cooling role. Only landmark-verified photos are pinned (phone EXIF GPS was 0,0).'
          : '點選地圖標點或下方縮圖檢視蓄水、遮蔭與降溫機制。因手機原始 EXIF GPS 為 0,0，僅具明確地標者標點於地圖。'}
      </p>

      <div className="chips news-chips" role="group" aria-label={l === 'en' ? 'Filter NbS by function' : '依功能篩選 NbS'}>
        <button aria-pressed={cat === 'all'} onClick={() => setCat('all')}>
          {l === 'en' ? 'All' : '全部'} <small>{dataset.items.length}</small>
        </button>
        {cats.map(k => {
          const n = dataset.items.filter(x => x.category === k).length;
          return (
            <button key={k} aria-pressed={cat === k} onClick={() => setCat(cat === k ? 'all' : k)}>
              {pick(CAT_LABEL[k], l)} <small>{n}</small>
            </button>
          );
        })}
      </div>

      <div className="nbs-grid">
        {shown.map(it => (
          <button
            key={it.id}
            className={`nbs-thumb ${selectedId === it.id ? 'on' : ''}`}
            onClick={() => onSelect(it.id)}
            title={pick(it.title, l)}
          >
            <img src={it.src} alt={pick(it.title, l)} loading="lazy" />
            {it.coord && <i className="nbs-pin" aria-label={l === 'en' ? 'Pinned on map' : '已標點於地圖'} />}
            <span>{pick(it.title, l)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
