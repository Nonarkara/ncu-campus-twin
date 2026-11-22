import { useEffect, useRef, useState } from 'react';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { setWorkerUrl, Map as MLMapCtor, type Map as MLMap, type StyleSpecification, type ExpressionSpecification } from 'maplibre-gl';

setWorkerUrl(workerUrl);

export type Lens = 'today' | 'power' | 'move';
const BOUNDS: [number, number, number, number] = [121.1849, 24.9651, 121.1968, 24.9717]; // OSM relation/18727079 bbox
const ON_CAMPUS_STOPS = ['中央大學警衛室', '中大湖', '依仁堂', '中央大學後門', '觀景台', '國鼎圖書館'];
const INK = 'rgba(230,237,243,', AMBER = '#f59e0b';

const style: StyleSpecification = {
  version: 8,
  sources: {
    photo: { type: 'raster', tileSize: 256, maxzoom: 19,
      tiles: ['https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}'],
      attribution: 'Orthophoto © 內政部國土測繪中心 NLSC' },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0a0e14' } },
    { id: 'photo', type: 'raster', source: 'photo', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.85, 'raster-saturation': -0.6 } },
  ],
};

export function CampusMap({ lens, l }: { lens: Lens; l: 'en' | 'zh' }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [photo, setPhoto] = useState(false);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const m = new MLMapCtor({ container: el.current!, style, bounds: BOUNDS, fitBoundsOptions: { padding: 24 },
      minZoom: 14, maxZoom: 19, maxBounds: [121.170, 24.955, 121.212, 24.982], renderWorldCopies: false,
      attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false });
    m.touchZoomRotate.disableRotation();
    map.current = m;
    let w = el.current!.clientWidth;
    m.on('resize', () => { const nw = el.current!.clientWidth; if (nw !== w) { w = nw; m.fitBounds(BOUNDS, { padding: 24, animate: false }); } });
    m.on('load', async () => {
      const d: any = await fetch('/data/campus.json').then(r => r.json());
      m.addSource('ctx', { type: 'geojson', data: d.context });
      m.addSource('campus', { type: 'geojson', data: d.campus, attribution: '© OpenStreetMap contributors' });
      m.addSource('bld', { type: 'geojson', data: d.buildings, promoteId: 'id' });
      m.addSource('stops', { type: 'geojson', data: d.stops });
      m.addLayer({ id: 'water', type: 'fill', source: 'ctx', filter: ['==', ['get', 'k'], 'water'], paint: { 'fill-color': INK + '0.07)' } });
      m.addLayer({ id: 'pitch', type: 'line', source: 'ctx', filter: ['in', ['get', 'k'], ['literal', ['pitch', 'track', 'park']]], paint: { 'line-color': INK + '0.12)', 'line-width': 1 } });
      m.addLayer({ id: 'roads', type: 'line', source: 'ctx', filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': INK + '0.22)', 'line-width': ['match', ['get', 'k'], ['secondary', 'tertiary'], 2, ['footway', 'path', 'steps', 'cycleway'], 0.5, 1] } });
      m.addLayer({ id: 'campus', type: 'line', source: 'campus', paint: { 'line-color': INK + '0.55)', 'line-width': 1, 'line-dasharray': [3, 2] } });
      m.addLayer({ id: 'bld', type: 'fill', source: 'bld', paint: { 'fill-color': INK + '0.14)' } });
      m.addLayer({ id: 'bld-line', type: 'line', source: 'bld', paint: { 'line-color': INK + '0.4)', 'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2, 0.75] } });
      m.addLayer({ id: 'stops', type: 'circle', source: 'stops', paint: { 'circle-radius': 3, 'circle-color': '#0a0e14', 'circle-stroke-color': INK + '0.6)', 'circle-stroke-width': 1 } });
      let hovered: string | null = null;
      m.on('mousemove', 'bld', (e: any) => {
        const f = e.features?.[0]; if (!f) return;
        if (hovered) m.setFeatureState({ source: 'bld', id: hovered }, { hover: false });
        hovered = f.properties.id; m.setFeatureState({ source: 'bld', id: hovered! }, { hover: true });
        setHover(JSON.stringify(f.properties));
      });
      m.on('mouseleave', 'bld', () => { if (hovered) m.setFeatureState({ source: 'bld', id: hovered }, { hover: false }); hovered = null; setHover(null); });
      m.on('click', 'bld', (e: any) => { const f = e.features?.[0]; if (f) setHover(JSON.stringify(f.properties)); });
      setReady(true);
    });
    return () => m.remove();
  }, []);

  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    m.setPaintProperty('bld', 'fill-color', lens === 'power'
      ? ['interpolate', ['linear'], ['get', 'kwp'], 0, INK + '0.06)', 100, 'rgba(245,158,11,0.35)', 650, AMBER]
      : INK + '0.14)');
    const onCampus = ['in', ['get', 'name'], ['literal', ON_CAMPUS_STOPS]] as ExpressionSpecification;
    m.setPaintProperty('stops', 'circle-radius', lens === 'move' ? ['case', onCampus, 6, 3] as ExpressionSpecification : 3);
    m.setPaintProperty('stops', 'circle-color', lens === 'move' ? ['case', onCampus, INK + '0.9)', '#0a0e14'] as ExpressionSpecification : '#0a0e14');
    m.setLayoutProperty('photo', 'visibility', photo ? 'visible' : 'none');
  }, [lens, ready, photo]);

  const h = hover ? JSON.parse(hover) : null;
  const legend = h
    ? `${(l === 'en' ? h.name_en ?? h.name : h.name) ?? (l === 'en' ? 'Unnamed building' : '未命名建物')} · ${h.area_m2} m²${h.kwp ? ` · ${Math.round(h.kwp)} kWp` : ''}${h.levels ? ` · ${h.levels}F` : ''}`
    : lens === 'power' ? (l === 'en' ? 'Amber = more rooftop kWp (high case)' : '琥珀色越深 = 屋頂潛力越高')
    : lens === 'move' ? (l === 'en' ? 'Filled = NCU bus stops (OSM)' : '實心 = 校內公車站（OSM）')
    : (l === 'en' ? 'OSM buildings · dashed = campus boundary' : 'OSM 建物 · 虛線 = 校界');
  return <div className="map" id="map">
    <div ref={el} style={{ position: 'absolute', inset: 0 }} />
    <div className="mapctl">
      <button aria-pressed={!photo} onClick={() => setPhoto(false)}>{l === 'en' ? 'Plan' : '平面'}</button>
      <button aria-pressed={photo} onClick={() => setPhoto(true)}>{l === 'en' ? 'Photo' : '航照'}</button>
    </div>
    <div className="legend">{legend}</div>
  </div>;
}
