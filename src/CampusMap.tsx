import { useEffect, useRef, useState } from 'react';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {
  setWorkerUrl,
  Map as MLMapCtor,
  type Map as MLMap,
  type StyleSpecification,
  type ExpressionSpecification,
  type GeoJSONSource,
} from 'maplibre-gl';
import {
  CAMPUS_ANCHORS,
  ON_CAMPUS_STOPS,
  SUBSTATION_ID,
  circlePolygon,
  polygonCentroid,
  type CampusData,
} from './shared/campus';
import { DOCK_EN } from './shared/live';

setWorkerUrl(workerUrl);

export type Lens = 'today' | 'twin' | 'power' | 'move' | 'find';
export type TwinLayer = 'green' | 'water' | 'bio' | 'flow' | 'b3d';
export interface TwinData { eco: any; ndvi: any; live: import('./shared/live').Live | null; layers: Set<TwinLayer> }
const BOUNDS: [number, number, number, number] = [121.1849, 24.9651, 121.1968, 24.9717]; // OSM relation/18727079 bbox
const INK = 'rgba(230,237,243,';
const AMBER = '#f59e0b';
const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] };

const style: StyleSpecification = {
  version: 8,
  sources: {
    photo: {
      type: 'raster',
      tileSize: 256,
      maxzoom: 19,
      tiles: ['https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}'],
      attribution: 'Orthophoto © 內政部國土測繪中心 NLSC',
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0a0e14' } },
    {
      id: 'photo',
      type: 'raster',
      source: 'photo',
      layout: { visibility: 'none' },
      paint: { 'raster-opacity': 0.85, 'raster-saturation': -0.6 },
    },
  ],
};

interface CampusMapProps {
  lens: Lens;
  l: 'en' | 'zh';
  campus: CampusData | null;
  selectedBuildingId: string | null;
  onSelectBuilding: (id: string) => void;
  portfolioIds: Set<string>;
  selectedStopName: string | null;
  onSelectStop: (name: string | null) => void;
  focusCoord: { coord: [number, number]; seq: number } | null;
  twin: TwinData;
}

export function CampusMap({
  lens,
  l,
  campus,
  selectedBuildingId,
  onSelectBuilding,
  portfolioIds,
  selectedStopName,
  onSelectStop,
  focusCoord,
  twin,
}: CampusMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [photo, setPhoto] = useState(false);
  const [hoverText, setHoverText] = useState<string | null>(null);

  const onSelectBuildingRef = useRef(onSelectBuilding);
  const onSelectStopRef = useRef(onSelectStop);
  onSelectBuildingRef.current = onSelectBuilding;
  onSelectStopRef.current = onSelectStop;

  useEffect(() => {
    const m = new MLMapCtor({
      container: el.current!,
      style,
      bounds: BOUNDS,
      fitBoundsOptions: { padding: 28 },
      minZoom: 14,
      maxZoom: 19,
      maxBounds: [121.170, 24.955, 121.212, 24.982],
      renderWorldCopies: false,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    m.touchZoomRotate.disableRotation();
    map.current = m;

    let w = el.current!.clientWidth;
    m.on('resize', () => {
      const nw = el.current!.clientWidth;
      if (nw !== w) {
        w = nw;
        m.fitBounds(BOUNDS, { padding: 28, animate: false });
      }
    });

    m.on('load', () => {
      m.addSource('ctx', { type: 'geojson', data: EMPTY_FC });
      m.addSource('campus', { type: 'geojson', data: EMPTY_FC, attribution: '© OpenStreetMap contributors' });
      m.addSource('bld', { type: 'geojson', data: EMPTY_FC, promoteId: 'id' });
      m.addSource('stops', { type: 'geojson', data: EMPTY_FC });
      m.addSource('radials', { type: 'geojson', data: EMPTY_FC });
      m.addSource('substation', { type: 'geojson', data: EMPTY_FC });
      m.addSource('catchment', { type: 'geojson', data: EMPTY_FC });

      m.addLayer({ id: 'water', type: 'fill', source: 'ctx', filter: ['==', ['get', 'k'], 'water'], paint: { 'fill-color': INK + '0.08)' } });
      m.addLayer({ id: 'pitch', type: 'line', source: 'ctx', filter: ['in', ['get', 'k'], ['literal', ['pitch', 'track', 'park']]], paint: { 'line-color': INK + '0.13)', 'line-width': 1 } });
      m.addLayer({
        id: 'roads',
        type: 'line',
        source: 'ctx',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: {
          'line-color': INK + '0.22)',
          'line-width': ['match', ['get', 'k'], ['secondary', 'tertiary'], 2, ['footway', 'path', 'steps', 'cycleway'], 0.5, 1],
        },
      });
      m.addLayer({
        id: 'campus',
        type: 'line',
        source: 'campus',
        paint: { 'line-color': INK + '0.55)', 'line-width': 1, 'line-dasharray': [3, 2] },
      });

      // 300 m bus stop catchment (Move lens)
      m.addLayer({
        id: 'catchment-fill',
        type: 'fill',
        source: 'catchment',
        paint: { 'fill-color': 'rgba(245,158,11,0.08)' },
      });
      m.addLayer({
        id: 'catchment-line',
        type: 'line',
        source: 'catchment',
        paint: { 'line-color': AMBER, 'line-width': 1, 'line-dasharray': [3, 3] },
      });

      // Twin lens: Sentinel-2 NDVI grid, water network, wildlife pins, live docks and detectors
      for (const id of ['ndvi', 'water', 'bio', 'docks', 'vd']) m.addSource(id, { type: 'geojson', data: EMPTY_FC });
      m.addLayer({ id: 'ndvi', type: 'fill', source: 'ndvi', layout: { visibility: 'none' }, paint: {
        'fill-color': ['case', ['<=', ['get', 'd'], -0.15], 'rgba(245,158,11,0.6)',
          ['interpolate', ['linear'], ['get', 'v'], 0.1, INK + '0)', 0.4, INK + '0.10)', 0.8, INK + '0.32)']] } });
      m.addLayer({ id: 'water-area', type: 'fill', source: 'water', filter: ['==', ['geometry-type'], 'Polygon'], layout: { visibility: 'none' },
        paint: { 'fill-color': INK + '0.22)', 'fill-outline-color': INK + '0.7)' } });
      m.addLayer({ id: 'water-line', type: 'line', source: 'water', filter: ['==', ['geometry-type'], 'LineString'], layout: { visibility: 'none' },
        paint: { 'line-color': INK + '0.75)', 'line-width': ['match', ['get', 'k'], 'river', 3, 'canal', 2, 'stream', 1.5, 1],
          'line-dasharray': ['match', ['get', 'k'], ['drain', 'ditch'], ['literal', [2, 1.5]], ['literal', [1, 0]]] } });

      m.addLayer({ id: 'bld', type: 'fill', source: 'bld', paint: { 'fill-color': INK + '0.14)' } });
      m.addLayer({
        id: 'bld-line',
        type: 'line',
        source: 'bld',
        paint: {
          'line-color': INK + '0.38)',
          'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2, 0.75],
        },
      });

      // 3D: NLSC measured heights (BUILD_H) + stated OSM floors extruded; unmeasured buildings stay flat
      m.addLayer({ id: 'bld-3d', type: 'fill-extrusion', source: 'bld', filter: ['!=', ['get', 'height_m'], null], layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'height_m'], 4, '#394552', 18, '#6e7e8f', 42, '#c8d2dc'],
          'fill-extrusion-height': ['get', 'height_m'],
          'fill-extrusion-opacity': 0.92,
        } });
      m.addLayer({ id: 'bio', type: 'circle', source: 'bio', layout: { visibility: 'none' },
        paint: { 'circle-radius': 3.5, 'circle-color': '#0a0e14', 'circle-stroke-color': INK + '0.9)', 'circle-stroke-width': 1.5 } });
      m.addLayer({ id: 'docks', type: 'circle', source: 'docks', layout: { visibility: 'none' },
        paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'capacity'], 30, 6, 70, 10], 'circle-color': '#0a0e14',
          'circle-stroke-color': ['case', ['<=', ['get', 'bikes'], 2], AMBER, '#e6edf3'], 'circle-stroke-width': 2 } });
      m.addLayer({ id: 'vd', type: 'circle', source: 'vd', layout: { visibility: 'none' },
        paint: { 'circle-radius': 6, 'circle-color': ['case', ['<', ['coalesce', ['get', 'speed'], 999], 40], AMBER, '#e6edf3'], 'circle-stroke-color': '#0a0e14', 'circle-stroke-width': 2 } });

      // Straight-line radial screening links from HV substation to selected roofs (Power lens)
      m.addLayer({
        id: 'radials',
        type: 'line',
        source: 'radials',
        paint: { 'line-color': AMBER, 'line-width': 1.25, 'line-dasharray': [4, 3], 'line-opacity': 0.85 },
      });

      // Substation marker (Power lens)
      m.addLayer({
        id: 'substation-ring',
        type: 'circle',
        source: 'substation',
        paint: {
          'circle-radius': 8,
          'circle-color': '#0a0e14',
          'circle-stroke-color': AMBER,
          'circle-stroke-width': 2,
        },
      });
      m.addLayer({
        id: 'substation-core',
        type: 'circle',
        source: 'substation',
        paint: { 'circle-radius': 2.5, 'circle-color': AMBER },
      });

      // Bus stops
      m.addLayer({
        id: 'stops',
        type: 'circle',
        source: 'stops',
        paint: {
          'circle-radius': 3,
          'circle-color': '#0a0e14',
          'circle-stroke-color': INK + '0.6)',
          'circle-stroke-width': 1,
        },
      });

      for (const id of ['docks', 'vd', 'bio']) {
        m.on('mousemove', id, (e: any) => { const f = e.features?.[0]; if (f) setHoverText(JSON.stringify({ kind: id, p: f.properties })); });
        m.on('mouseleave', id, () => setHoverText(null));
        // touch has no hover: a tap shows the same line
        m.on('click', id, (e: any) => { const f = e.features?.[0]; if (f) setHoverText(JSON.stringify({ kind: id, p: f.properties })); });
      }
      let hovered: string | null = null;
      for (const layerId of ['bld', 'bld-3d']) {
        m.on('mousemove', layerId, (e: any) => {
          m.getCanvas().style.cursor = 'pointer';
          const f = e.features?.[0];
          if (!f) return;
          if (hovered && hovered !== f.properties.id) {
            m.setFeatureState({ source: 'bld', id: hovered }, { hover: false });
          }
          hovered = f.properties.id;
          m.setFeatureState({ source: 'bld', id: hovered! }, { hover: true });
          setHoverText(JSON.stringify({ kind: 'bld', p: f.properties }));
        });
        m.on('mouseleave', layerId, () => {
          m.getCanvas().style.cursor = '';
          if (hovered) m.setFeatureState({ source: 'bld', id: hovered }, { hover: false });
          hovered = null;
          setHoverText(null);
        });
        m.on('click', layerId, (e: any) => {
          const f = e.features?.[0];
          if (f?.properties?.id) onSelectBuildingRef.current(f.properties.id);
        });
      }

      m.on('mouseenter', 'stops', () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', 'stops', () => { m.getCanvas().style.cursor = ''; setHoverText(null); });
      m.on('mousemove', 'stops', (e: any) => {
        const f = e.features?.[0];
        if (f?.properties?.name) setHoverText(JSON.stringify({ kind: 'stop', name: f.properties.name }));
      });
      m.on('click', 'stops', (e: any) => {
        const f = e.features?.[0];
        if (f?.properties?.name) onSelectStopRef.current(f.properties.name);
      });

      setReady(true);
    });

    return () => m.remove();
  }, []);

  // Load campus GeoJSON into MapLibre sources once fetched
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !campus) return;
    (m.getSource('ctx') as GeoJSONSource | undefined)?.setData(campus.context);
    (m.getSource('campus') as GeoJSONSource | undefined)?.setData(campus.campus);
    (m.getSource('bld') as GeoJSONSource | undefined)?.setData(campus.buildings);
    (m.getSource('stops') as GeoJSONSource | undefined)?.setData(campus.stops);
  }, [campus, ready]);

  // Update operational overlays, paint styles, radial links, and bus catchments
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !campus) return;

    const anchorIds = Object.keys(CAMPUS_ANCHORS);
    const portfolioArr = Array.from(portfolioIds);
    const inPortfolio: ExpressionSpecification = portfolioArr.length
      ? ['in', ['get', 'id'], ['literal', portfolioArr]]
      : ['==', ['get', 'id'], '__none__'];
    const isSelected: ExpressionSpecification = selectedBuildingId
      ? ['==', ['get', 'id'], selectedBuildingId]
      : ['==', ['get', 'id'], '__none__'];
    const isAnchor: ExpressionSpecification = ['in', ['get', 'id'], ['literal', anchorIds]];

    // Building fill
    if (lens === 'power') {
      m.setPaintProperty('bld', 'fill-color', [
        'case',
        inPortfolio, 'rgba(245,158,11,0.85)',
        isSelected, 'rgba(230,237,243,0.34)',
        ['interpolate', ['linear'], ['get', 'kwp'], 0, INK + '0.06)', 100, 'rgba(245,158,11,0.22)', 650, 'rgba(245,158,11,0.58)'],
      ]);
    } else {
      m.setPaintProperty('bld', 'fill-color', [
        'case',
        isSelected, 'rgba(230,237,243,0.42)', // selection is ink; amber stays 'act' (NDVI loss shares this view)
        isAnchor, INK + '0.24)',
        INK + '0.13)',
      ]);
    }

    // Building outline
    const isPowerPortfolio: ExpressionSpecification = lens === 'power' ? inPortfolio : ['==', ['get', 'id'], '__none__'];
    m.setPaintProperty('bld-line', 'line-color', [
      'case',
      isSelected, '#e6edf3',
      isPowerPortfolio, '#e6edf3',
      isAnchor, INK + '0.7)',
      INK + '0.35)',
    ] as ExpressionSpecification);
    m.setPaintProperty('bld-line', 'line-width', [
      'case',
      isSelected, 2.5,
      isPowerPortfolio, 1.75,
      ['boolean', ['feature-state', 'hover'], false], 2,
      isAnchor, 1.1,
      0.75,
    ] as ExpressionSpecification);

    m.setPaintProperty('bld-3d', 'fill-extrusion-color', [
      'case',
      isSelected, AMBER,
      ['interpolate', ['linear'], ['get', 'height_m'], 4, '#394552', 18, '#6e7e8f', 42, '#c8d2dc'],
    ] as ExpressionSpecification);

    // Bus stops
    const onCampus: ExpressionSpecification = ['in', ['get', 'name'], ['literal', [...ON_CAMPUS_STOPS]]];
    const isSelectedStop: ExpressionSpecification = selectedStopName
      ? ['==', ['get', 'name'], selectedStopName]
      : ['==', ['get', 'name'], '__none__'];

    m.setPaintProperty(
      'stops',
      'circle-radius',
      lens === 'move' ? ['case', isSelectedStop, 8, onCampus, 6, 3] : 3,
    );
    m.setPaintProperty(
      'stops',
      'circle-color',
      lens === 'move' ? ['case', isSelectedStop, AMBER, onCampus, '#e6edf3', '#0a0e14'] : '#0a0e14',
    );
    m.setPaintProperty(
      'stops',
      'circle-stroke-color',
      lens === 'move' ? ['case', isSelectedStop, '#e6edf3', onCampus, '#0a0e14', INK + '0.5)'] : INK + '0.6)',
    );

    // Substation & straight-line radial screening links (Power lens)
    const subFeature = campus.buildings.features.find(f => f.properties.id === SUBSTATION_ID);
    const subCoord = subFeature ? polygonCentroid(subFeature.geometry.coordinates[0]) : null;
    if (lens === 'power' && subCoord) {
      (m.getSource('substation') as GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: { id: SUBSTATION_ID }, geometry: { type: 'Point', coordinates: subCoord } }],
      });
      const radialFeatures = campus.buildings.features
        .filter(f => portfolioIds.has(f.properties.id) && f.properties.id !== SUBSTATION_ID)
        .map(f => ({
          type: 'Feature' as const,
          properties: { id: f.properties.id },
          geometry: { type: 'LineString' as const, coordinates: [subCoord, polygonCentroid(f.geometry.coordinates[0])] },
        }));
      (m.getSource('radials') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: radialFeatures });
    } else {
      (m.getSource('substation') as GeoJSONSource | undefined)?.setData(EMPTY_FC);
      (m.getSource('radials') as GeoJSONSource | undefined)?.setData(EMPTY_FC);
    }

    // 300 m walking catchment around selected bus stop (Move lens)
    if (lens === 'move' && selectedStopName) {
      const stopFeat = campus.stops.features.find(f => f.properties.name === selectedStopName);
      if (stopFeat) {
        (m.getSource('catchment') as GeoJSONSource | undefined)?.setData({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: { name: selectedStopName },
            geometry: { type: 'Polygon', coordinates: [circlePolygon(stopFeat.geometry.coordinates, 300)] },
          }],
        });
      } else {
        (m.getSource('catchment') as GeoJSONSource | undefined)?.setData(EMPTY_FC);
      }
    } else {
      (m.getSource('catchment') as GeoJSONSource | undefined)?.setData(EMPTY_FC);
    }

    m.setLayoutProperty('photo', 'visibility', photo ? 'visible' : 'none');
  }, [lens, ready, photo, campus, selectedBuildingId, portfolioIds, selectedStopName]);

  // Twin data
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const set = (id: string, d: any) => (m.getSource(id) as GeoJSONSource | undefined)?.setData(d ?? EMPTY_FC);
    set('ndvi', twin.ndvi?.grid);
    set('water', twin.eco?.water);
    set('bio', twin.eco?.bio.pins);
    set('docks', { type: 'FeatureCollection', features: (twin.live?.docks.data ?? []).map(d => ({ type: 'Feature', properties: d, geometry: { type: 'Point', coordinates: [d.lon, d.lat] } })) });
    set('vd', { type: 'FeatureCollection', features: (twin.live?.road.data ?? []).map(f => ({ type: 'Feature', properties: { ...f, label: f.label.join(' / ') }, geometry: { type: 'Point', coordinates: [f.lon, f.lat] } })) });
  }, [ready, twin.ndvi, twin.eco, twin.live]);

  // Twin visibility + camera: tilt into 3D on entering the Twin lens, flat elsewhere
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const on = (k: TwinLayer) => lens === 'twin' && twin.layers.has(k);
    const vis = (id: string, v: boolean) => m.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none');
    vis('ndvi', on('green'));
    vis('water-area', on('water')); vis('water-line', on('water'));
    vis('bio', on('bio'));
    vis('docks', on('flow')); vis('vd', on('flow'));
    vis('bld-3d', on('b3d'));
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (lens === 'twin' && twin.layers.has('b3d')) {
      m.dragRotate.enable(); m.touchZoomRotate.enableRotation();
      if (m.getPitch() < 10) m.easeTo({ pitch: 55, bearing: -18, duration: reduced ? 0 : 500 });
    } else {
      m.dragRotate.disable(); m.touchZoomRotate.disableRotation();
      if (m.getPitch() > 0 || m.getBearing() !== 0) m.easeTo({ pitch: 0, bearing: 0, duration: reduced ? 0 : 300 });
    }
  }, [lens, ready, twin.layers]);

  // Smoothly focus on selected building or stop (respects reduced motion)
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !focusCoord) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    m.easeTo({
      center: focusCoord.coord,
      zoom: Math.max(m.getZoom(), 16.5),
      duration: reduced ? 0 : 280,
    });
  }, [focusCoord, ready]);

  const resetView = () => {
    const m = map.current;
    if (!m) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    m.fitBounds(BOUNDS, { padding: 28, duration: reduced ? 0 : 240, pitch: m.getPitch(), bearing: m.getBearing() });
  };

  let legend: string;
  if (hoverText) {
    const parsed = JSON.parse(hoverText);
    if (parsed.kind === 'docks') {
      const d = parsed.p;
      legend = `YouBike · ${l === 'en' ? DOCK_EN[d.id] ?? d.en : d.zh} · ${d.bikes} ${l === 'en' ? 'bikes' : '車'} · ${d.free}/${d.capacity} ${l === 'en' ? 'docks free' : '空位'}`;
    } else if (parsed.kind === 'vd') {
      const f = parsed.p; const lab = String(f.label).split(' / ');
      legend = `${l === 'en' ? lab[0] : lab[1]} · ${f.speed ?? '—'} km/h · ${Number(f.vph).toLocaleString('en-US')} ${l === 'en' ? 'veh/h' : '輛/時'} · Freeway Bureau VD`;
    } else if (parsed.kind === 'bio') {
      legend = `${parsed.p.vn && parsed.p.vn !== parsed.p.sp ? parsed.p.vn + ' · ' : ''}${parsed.p.sp} · ${parsed.p.y} · ±${parsed.p.u} m · GBIF`;
    } else if (parsed.kind === 'stop') {
      legend = `${l === 'en' ? 'Bus stop' : '公車站'} · ${parsed.name}`;
    } else {
      const p = parsed.p;
      const anchor = CAMPUS_ANCHORS[p.id];
      const name = (l === 'en' ? p.name_en ?? p.name : p.name) ?? (l === 'en' ? 'Unnamed building' : '未命名建物');
      const role = anchor ? ` · ${l === 'en' ? anchor.tag[0] : anchor.tag[1]}` : '';
      const ht = p.height_m ? ` · ${p.height_m} m${p.levels ? ` (${p.levels}F)` : ''}` : '';
      legend = `${name}${role} · ${p.area_m2} m²${ht}${p.kwp ? ` · ${Math.round(p.kwp)} kWp` : ''}`;
    }
  } else if (lens === 'power') {
    legend = portfolioIds.size
      ? (l === 'en'
        ? `Amber = rooftop kWp · dashed = straight-line to HV substation (${portfolioIds.size} selected)`
        : `琥珀 = 屋頂潛力 · 虛線 = 至高壓變電站直線距離（已選 ${portfolioIds.size} 棟）`)
      : (l === 'en'
        ? 'Click any roof to inspect or add to microgrid · ring = HV substation'
        : '點選任一建物檢視或加入微電網 · 圓環 = 高壓變電站');
  } else if (lens === 'find') {
    legend = l === 'en' ? 'Tap “Map ›” in the directory to locate a building · dashed = OSM boundary' : '點名錄中的「地圖 ›」定位建物 · 虛線 = OSM 校界';
  } else if (lens === 'twin') {
    legend = l === 'en'
      ? 'Brighter = greener (Sentinel-2) · amber = NDVI down ≥0.15 YoY · drag to rotate · 3D = NLSC measured BUILD_H'
      : '越亮越綠（Sentinel-2）・琥珀 = NDVI 較去年降 ≥0.15・拖曳旋轉・3D 採國土測繪實測高度';
  } else if (lens === 'move') {
    legend = selectedStopName
      ? (l === 'en' ? `${selectedStopName} · dashed ring = 300 m (~4 min walk)` : `${selectedStopName} · 虛線圓 = 300 公尺（步行約 4 分）`)
      : (l === 'en' ? 'Click an on-campus stop (white dot) for 300 m walk catchment' : '點選校內白點公車站檢視 300 m 步行圈');
  } else {
    legend = l === 'en'
      ? 'Select any building for its dossier: height, solar, substation, transit · dashed = OSM boundary'
      : '點選任一建物檢視光電、變電站與公車距離 · 虛線 = OSM 校界';
  }

  return (
    <div className="map" id="map">
      <div ref={el} style={{ position: 'absolute', inset: 0 }} />
      <div className="mapctl">
        <button aria-pressed={!photo} onClick={() => setPhoto(false)}>{l === 'en' ? 'Plan' : '平面'}</button>
        <button aria-pressed={photo} onClick={() => setPhoto(true)}>{l === 'en' ? 'Photo' : '航照'}</button>
        <button onClick={resetView} aria-label={l === 'en' ? 'Reset map view' : '重置地圖視角'}>{l === 'en' ? 'Reset' : '重置'}</button>
      </div>
      <div className="legend">{legend}</div>
    </div>
  );
}
