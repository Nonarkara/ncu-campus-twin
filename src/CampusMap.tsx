import { useEffect, useMemo, useRef, useState } from 'react';
import type { Layer, Ndvi, VegetationView } from './TwinLens';
import { makeWalkers, walkerFeatures, type CampusLayers, type ParkingKind } from './shared/campus-layers';
import type { Appearance } from './shared/appearance';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {
  setWorkerUrl,
  Map as MLMapCtor,
  LngLatBounds,
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
export interface TwinData {
  eco: any;
  campusLayers: CampusLayers | null;
  ndvi: Ndvi | null;
  vegetationView: VegetationView;
  live: import('./shared/live').Live | null;
  nbs: import('./NbsInspector').NbsDataset | null;
  selectedNbsId: string | null;
  onSelectNbs: (id: string) => void;
  layers: Set<Layer>;
}
const PARKING_NAMES: Record<ParkingKind, [string, string]> = {
  parking: ['Car parking', '汽車停車區'],
  parking_space: ['Parking space', '車位'],
  bicycle_parking: ['Bicycle parking', '自行車停車區'],
  motorcycle_parking: ['Motorcycle parking', '機車停車區'],
};
const BOUNDS: [number, number, number, number] = [121.1849, 24.9651, 121.1968, 24.9717]; // OSM relation/18727079 bbox
// Global style state changes paint expressions without rebuilding the canvas or its sources.
const tone = (dark: string, light: string): ExpressionSpecification =>
  ['case', ['boolean', ['global-state', 'light'], false], light, dark];
const GROUND = tone('#0a0e14', '#f7f5ef');
const INK = tone('#e6edf3', '#202b33');
const DIM = tone('#9aa7b4', '#505d66');
const AMBER = tone('#f59e0b', '#a84e00');
const ink = (opacity: number) => tone(`rgba(230,237,243,${opacity})`, `rgba(26,36,44,${opacity})`);
const tyrian = (opacity: number) => tone(`rgba(91,160,204,${opacity})`, `rgba(18,53,78,${opacity})`);
const amber = (opacity: number) => tone(`rgba(245,158,11,${opacity})`, `rgba(168,78,0,${opacity})`);
const HEIGHT_RAMP = [4, tone('#24384a', '#dce5ec'), 18, tone('#4c7494', '#63849c'), 42, tone('#b6d0e4', '#12354e')] as const;
const ndviPaint = (view: VegetationView): ExpressionSpecification => {
  const shift: ExpressionSpecification = view === 'repeat'
    ? ['coalesce', ['get', 'repeated'], 'masked']
    : ['coalesce', ['get', 'shift'], ['case', ['<=', ['get', 'd'], -0.15], 'lower', ['>=', ['get', 'd'], 0.15], 'higher', 'other']];
  // Never smear unchanged cells into a gray graph-paper checkerboard in repeat mode; highlight only verified change.
  const other: ExpressionSpecification = view === 'repeat' ? ink(0)
    : ['interpolate', ['linear'], ['get', 'v'], 0.1, ink(0), 0.4, tyrian(0.10), 0.8, tyrian(0.28)];
  return ['match', shift, 'lower', amber(0.68), 'higher', tyrian(0.58), 'masked', ink(0), other];
};

const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] };

const style: StyleSpecification = {
  version: 8,
  state: { light: { default: false } },
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
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
    { id: 'bg', type: 'background', paint: { 'background-color': GROUND } },
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
  appearance: Appearance;
  lens: Lens;
  l: 'en' | 'zh';
  campus: CampusData | null;
  selectedBuildingId: string | null;
  onSelectBuilding: (id: string) => void;
  portfolioIds: Set<string>;
  selectedStopName: string | null;
  onSelectStop: (name: string | null) => void;
  focusCoord: { coord: [number, number]; seq: number; stopRadius?: true } | null;
  twin: TwinData;
}

export function CampusMap({
  appearance,
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
  const initialAppearance = useRef(appearance);
  const [ready, setReady] = useState(false);
  const [photo, setPhoto] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [hoverText, setHoverText] = useState<string | null>(null);
  const [playing, setPlaying] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const simSeconds = useRef(0);
  const walkers = useMemo(() => twin.campusLayers ? makeWalkers(twin.campusLayers.paths) : [], [twin.campusLayers]);
  const showStudents = lens === 'twin' && twin.layers.has('students');

  const onSelectBuildingRef = useRef(onSelectBuilding);
  const onSelectStopRef = useRef(onSelectStop);
  const onSelectNbsRef = useRef(twin.onSelectNbs);
  onSelectBuildingRef.current = onSelectBuilding;
  onSelectStopRef.current = onSelectStop;
  onSelectNbsRef.current = twin.onSelectNbs;

  useEffect(() => {
    const m = new MLMapCtor({
      container: el.current!,
      style,
      globalState: { light: initialAppearance.current === 'light' },
      bounds: BOUNDS,
      fitBoundsOptions: { padding: 28 },
      minZoom: 13.5,
      maxZoom: 19,
      maxBounds: [121.168, 24.952, 121.216, 24.982],
      renderWorldCopies: false,
      localIdeographFontFamily: "'Noto Sans TC', 'PingFang TC', sans-serif",
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
      m.addSource('sur-bld', { type: 'geojson', data: EMPTY_FC });
      m.addSource('sur-roads', { type: 'geojson', data: EMPTY_FC });
      m.addSource('sur-waters', { type: 'geojson', data: EMPTY_FC });
      m.addSource('bld-labels', { type: 'geojson', data: EMPTY_FC });
      m.addSource('campus', { type: 'geojson', data: EMPTY_FC, attribution: '© OpenStreetMap contributors' });
      m.addSource('bld', { type: 'geojson', data: EMPTY_FC, promoteId: 'id' });
      m.addSource('stops', { type: 'geojson', data: EMPTY_FC });
      m.addSource('radials', { type: 'geojson', data: EMPTY_FC });
      m.addSource('substation', { type: 'geojson', data: EMPTY_FC });
      m.addSource('catchment', { type: 'geojson', data: EMPTY_FC });

      // Wider Zhongli / Freeway 1 urban fabric (surrounding buildings, waterways, arterial hierarchy)
      m.addLayer({ id: 'sur-waters', type: 'line', source: 'sur-waters', paint: { 'line-color': ink(0.16), 'line-width': ['match', ['get', 'k'], 'river', 2.5, 'canal', 1.5, 1] } });
      m.addLayer({ id: 'sur-bld', type: 'fill', source: 'sur-bld', paint: { 'fill-color': ink(0.055) } });
      m.addLayer({ id: 'sur-bld-line', type: 'line', source: 'sur-bld', paint: { 'line-color': ink(0.12), 'line-width': 0.5 } });
      m.addLayer({ id: 'sur-roads-casing', type: 'line', source: 'sur-roads', filter: ['==', ['get', 'k'], 'motorway'],
        paint: { 'line-color': GROUND, 'line-width': 5.5 } });
      m.addLayer({
        id: 'sur-roads',
        type: 'line',
        source: 'sur-roads',
        paint: {
          'line-color': ['match', ['get', 'k'], 'motorway', ink(0.52), ['motorway_link', 'trunk', 'primary'], ink(0.38), 'secondary', ink(0.30), ink(0.24)],
          'line-width': ['match', ['get', 'k'], 'motorway', 3.2, ['trunk', 'primary'], 2.4, 'motorway_link', 2.0, 'secondary', 1.8, 1.2],
        },
      });

      m.addLayer({ id: 'water', type: 'fill', source: 'ctx', filter: ['==', ['get', 'k'], 'water'], paint: { 'fill-color': ink(0.08) } });
      m.addLayer({ id: 'pitch', type: 'line', source: 'ctx', filter: ['in', ['get', 'k'], ['literal', ['pitch', 'track', 'park']]], paint: { 'line-color': ink(0.13), 'line-width': 1 } });
      m.addLayer({
        id: 'roads',
        type: 'line',
        source: 'ctx',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: {
          'line-color': ink(0.22),
          'line-width': ['match', ['get', 'k'], ['secondary', 'tertiary'], 2, ['footway', 'path', 'steps', 'cycleway'], 0.5, 1],
        },
      });
      m.addLayer({
        id: 'campus',
        type: 'line',
        source: 'campus',
        paint: { 'line-color': ink(0.55), 'line-width': 1, 'line-dasharray': [3, 2] },
      });

      // 300 m bus stop catchment (Move lens)
      m.addLayer({
        id: 'catchment-fill',
        type: 'fill',
        source: 'catchment',
        paint: { 'fill-color': amber(0.08) },
      });
      m.addLayer({
        id: 'catchment-line',
        type: 'line',
        source: 'catchment',
        paint: { 'line-color': AMBER, 'line-width': 1, 'line-dasharray': [3, 3] },
      });

      // Twin lens: Sentinel-2 NDVI grid, water network, wildlife pins, live docks, detectors, and NbS field dots
      for (const id of ['ndvi', 'water', 'bio', 'docks', 'vd', 'nbs', 'students', 'parking']) m.addSource(id, { type: 'geojson', data: EMPTY_FC });
      m.addLayer({ id: 'ndvi', type: 'fill', source: 'ndvi', layout: { visibility: 'none' }, paint: {
        'fill-color': ndviPaint('latest') } });
      m.addLayer({ id: 'water-area', type: 'fill', source: 'water', filter: ['==', ['geometry-type'], 'Polygon'], layout: { visibility: 'none' },
        paint: { 'fill-color': tyrian(0.16), 'fill-outline-color': tyrian(0.42) } });
      m.addLayer({ id: 'water-line', type: 'line', source: 'water', filter: ['==', ['geometry-type'], 'LineString'], layout: { visibility: 'none' },
        paint: { 'line-color': tyrian(0.62), 'line-width': ['match', ['get', 'k'], 'river', 2.8, 'canal', 1.8, 'stream', 1.4, 1],
          'line-dasharray': ['match', ['get', 'k'], ['drain', 'ditch'], ['literal', [2, 1.5]], ['literal', [1, 0]]] } });

      m.addLayer({ id: 'bld', type: 'fill', source: 'bld', paint: { 'fill-color': ink(0.14) } });
      m.addLayer({
        id: 'bld-line',
        type: 'line',
        source: 'bld',
        paint: {
          'line-color': ink(0.38),
          'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2, 0.75],
        },
      });

      // 3D: NLSC measured heights (BUILD_H) + stated OSM floors extruded; unmeasured buildings stay flat
      m.addLayer({ id: 'bld-3d', type: 'fill-extrusion', source: 'bld', filter: ['!=', ['get', 'height_m'], null], layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'height_m'], ...HEIGHT_RAMP],
          'fill-extrusion-height': ['get', 'height_m'],
          'fill-extrusion-opacity': 0.92,
        } });
      m.addLayer({
        id: 'parking-area', type: 'fill', source: 'parking', filter: ['==', ['geometry-type'], 'Polygon'],
        layout: { visibility: 'none' }, paint: { 'fill-color': ink(0.2) },
      });
      m.addLayer({
        id: 'parking-outline', type: 'line', source: 'parking', filter: ['==', ['geometry-type'], 'Polygon'],
        layout: { visibility: 'none' }, paint: { 'line-color': INK, 'line-width': 1, 'line-dasharray': [3, 2] },
      });
      m.addLayer({
        id: 'parking-point', type: 'circle', source: 'parking', filter: ['==', ['geometry-type'], 'Point'],
        layout: { visibility: 'none' },
        paint: { 'circle-radius': 5, 'circle-color': GROUND, 'circle-stroke-color': INK, 'circle-stroke-width': 1 },
      });
      m.addLayer({
        id: 'parking-label', type: 'symbol', source: 'parking',
        layout: {
          visibility: 'none',
          'text-field': ['match', ['get', 'kind'], 'bicycle_parking', 'B', 'motorcycle_parking', 'M', 'P'],
          'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-padding': 1,
        },
        paint: { 'text-color': INK, 'text-halo-color': GROUND, 'text-halo-width': 2 },
      });
      m.addLayer({
        id: 'student-model', type: 'fill-extrusion', source: 'students', minzoom: 17.7,
        filter: ['==', ['geometry-type'], 'Polygon'], layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-color': INK,
        },
      });
      m.addLayer({
        id: 'student-location', type: 'circle', source: 'students',
        filter: ['==', ['geometry-type'], 'Point'], layout: { visibility: 'none' },
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 3, 19, 1.7],
          'circle-color': INK, 'circle-stroke-color': GROUND, 'circle-stroke-width': 1 },
      });
      m.addLayer({ id: 'bio', type: 'circle', source: 'bio', layout: { visibility: 'none' },
        paint: { 'circle-radius': 3.5, 'circle-color': GROUND, 'circle-stroke-color': ink(0.9), 'circle-stroke-width': 1.5 } });
      m.addLayer({ id: 'docks', type: 'circle', source: 'docks', layout: { visibility: 'none' },
        paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'capacity'], 30, 6, 70, 10], 'circle-color': GROUND,
          'circle-stroke-color': ['case', ['<=', ['get', 'bikes'], 2], AMBER, INK], 'circle-stroke-width': 2 } });
      m.addLayer({ id: 'vd', type: 'circle', source: 'vd', layout: { visibility: 'none' },
        paint: { 'circle-radius': 6, 'circle-color': ['case', ['<', ['coalesce', ['get', 'speed'], 999], 40], AMBER, INK], 'circle-stroke-color': GROUND, 'circle-stroke-width': 2 } });
      m.addLayer({ id: 'nbs', type: 'circle', source: 'nbs', layout: { visibility: 'none' },
        paint: { 'circle-radius': 7, 'circle-color': AMBER, 'circle-stroke-color': INK, 'circle-stroke-width': 2 } });

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
          'circle-color': GROUND,
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
          'circle-color': GROUND,
          'circle-stroke-color': ink(0.6),
          'circle-stroke-width': 1,
        },
      });

      // Crisp architectural labels: major roads along lines + major campus buildings
      m.addLayer({
        id: 'sur-road-labels',
        type: 'symbol',
        source: 'sur-roads',
        minzoom: 13.5,
        filter: ['has', 'name'],
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['match', ['get', 'k'], 'motorway', 11, 10],
          'symbol-spacing': 320,
          'text-max-angle': 30,
        },
        paint: {
          'text-color': DIM,
          'text-halo-color': GROUND,
          'text-halo-width': 1.5,
        },
      });
      m.addLayer({
        id: 'campus-bld-labels',
        type: 'symbol',
        source: 'bld-labels',
        minzoom: 15.1,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 10.5,
          'text-padding': 6,
          'text-optional': true,
        },
        paint: {
          'text-color': ink(0.86),
          'text-halo-color': GROUND,
          'text-halo-width': 1.5,
        },
      });

      // Load wider Zhongli / Freeway 1 surroundings asynchronously (non-blocking)
      fetch('/data/surroundings.json')
        .then(r => r.json())
        .then((sur: any) => {
          (m.getSource('sur-bld') as GeoJSONSource | undefined)?.setData(sur.buildings ?? EMPTY_FC);
          (m.getSource('sur-roads') as GeoJSONSource | undefined)?.setData(sur.roads ?? EMPTY_FC);
          (m.getSource('sur-waters') as GeoJSONSource | undefined)?.setData(sur.waters ?? EMPTY_FC);
          (m.getSource('bld-labels') as GeoJSONSource | undefined)?.setData(sur.labels ?? EMPTY_FC);
        })
        .catch(() => {});

      for (const id of ['docks', 'vd', 'bio']) {
        m.on('mousemove', id, (e: any) => { const f = e.features?.[0]; if (f) setHoverText(JSON.stringify({ kind: id, p: f.properties })); });
        m.on('mouseleave', id, () => setHoverText(null));
        // touch has no hover: a tap shows the same line
        m.on('click', id, (e: any) => { const f = e.features?.[0]; if (f) setHoverText(JSON.stringify({ kind: id, p: f.properties })); });
      }
      for (const id of ['parking-area', 'parking-point', 'parking-label']) {
        const identify = (e: { features?: { properties: unknown }[] }) => {
          if (e.features?.[0]) setHoverText(JSON.stringify({ kind: 'parking', p: e.features[0].properties }));
        };
        m.on('mousemove', id, identify);
        m.on('click', id, identify);
        m.on('mouseleave', id, () => setHoverText(null));
      }
      m.on('mouseenter', 'nbs', () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', 'nbs', () => { m.getCanvas().style.cursor = ''; setHoverText(null); });
      m.on('mousemove', 'nbs', (e: any) => {
        const f = e.features?.[0];
        if (f) setHoverText(JSON.stringify({ kind: 'nbs', p: f.properties }));
      });
      m.on('click', 'nbs', (e: any) => {
        const f = e.features?.[0];
        if (f?.properties?.id) onSelectNbsRef.current(f.properties.id);
      });
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
    if (ready) map.current?.setGlobalStateProperty('light', appearance === 'light');
  }, [appearance, ready]);

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
        inPortfolio, amber(0.85),
        isSelected, ink(0.34),
        ['interpolate', ['linear'], ['get', 'kwp'], 0, ink(0.06), 100, amber(0.22), 650, amber(0.58)],
      ]);
    } else {
      m.setPaintProperty('bld', 'fill-color', [
        'case',
        isSelected, ink(0.42), // selection is ink; amber stays 'act' (NDVI loss shares this view)
        isAnchor, ink(0.24),
        ink(0.13),
      ]);
    }

    // Building outline
    const isPowerPortfolio: ExpressionSpecification = lens === 'power' ? inPortfolio : ['==', ['get', 'id'], '__none__'];
    m.setPaintProperty('bld-line', 'line-color', [
      'case',
      isSelected, INK,
      isPowerPortfolio, INK,
      isAnchor, ink(0.7),
      ink(0.35),
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
      ['interpolate', ['linear'], ['get', 'height_m'], ...HEIGHT_RAMP],
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
      lens === 'move' ? ['case', isSelectedStop, AMBER, onCampus, INK, GROUND] : GROUND,
    );
    m.setPaintProperty(
      'stops',
      'circle-stroke-color',
      lens === 'move' ? ['case', isSelectedStop, INK, onCampus, GROUND, ink(0.5)] : ink(0.6),
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

    // 300 m radius around selected bus stop (Move lens)
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
    m.setLayoutProperty('sur-road-labels', 'visibility', showLabels ? 'visible' : 'none');
    m.setLayoutProperty('campus-bld-labels', 'visibility', showLabels ? 'visible' : 'none');
  }, [lens, ready, photo, showLabels, campus, selectedBuildingId, portfolioIds, selectedStopName]);

  // Twin data
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const set = (id: string, d: any) => (m.getSource(id) as GeoJSONSource | undefined)?.setData(d ?? EMPTY_FC);
    set('ndvi', twin.ndvi?.grid);
    set('water', twin.eco?.water);
    set('parking', twin.campusLayers?.parking);
    set('bio', twin.eco?.bio.pins);
    set('docks', { type: 'FeatureCollection', features: (twin.live?.docks.data ?? []).map(d => ({ type: 'Feature', properties: d, geometry: { type: 'Point', coordinates: [d.lon, d.lat] } })) });
    set('vd', { type: 'FeatureCollection', features: (twin.live?.road.data ?? []).map(f => ({ type: 'Feature', properties: { ...f, label: f.label.join(' / ') }, geometry: { type: 'Point', coordinates: [f.lon, f.lat] } })) });
    set('nbs', {
      type: 'FeatureCollection',
      features: (twin.nbs?.items ?? [])
        .filter(it => it.coord !== null)
        .map(it => ({
          type: 'Feature',
          properties: { id: it.id, title_en: it.title[0], title_zh: it.title[1], category: it.category },
          geometry: { type: 'Point', coordinates: it.coord! },
        })),
    });
  }, [ready, twin.ndvi, twin.eco, twin.live, twin.nbs, twin.campusLayers]);

  useEffect(() => {
    if (ready) map.current?.setPaintProperty('ndvi', 'fill-color', ndviPaint(twin.vegetationView));
  }, [ready, twin.vegetationView]);

  // Twin visibility + camera: tilt into 3D on entering the Twin lens, flat elsewhere
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const on = (k: Layer) => lens === 'twin' && twin.layers.has(k);
    const vis = (id: string, v: boolean) => m.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none');
    vis('ndvi', on('green'));
    vis('water-area', on('water')); vis('water-line', on('water'));
    vis('bio', on('bio'));
    vis('docks', on('flow')); vis('vd', on('flow'));
    vis('nbs', on('nbs'));
    for (const id of ['parking-area', 'parking-outline', 'parking-point', 'parking-label']) vis(id, on('parking'));
    vis('student-model', on('students')); vis('student-location', on('students'));
    vis('bld-3d', on('b3d'));
    if (m.getLayer('nbs')) {
      const selNbs: ExpressionSpecification = twin.selectedNbsId ? ['==', ['get', 'id'], twin.selectedNbsId] : ['==', ['get', 'id'], '__none__'];
      m.setPaintProperty('nbs', 'circle-radius', ['case', selNbs, 9.5, 7]);
      m.setPaintProperty('nbs', 'circle-color', ['case', selNbs, INK, AMBER]);
      m.setPaintProperty('nbs', 'circle-stroke-color', ['case', selNbs, AMBER, INK]);
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (lens === 'twin' && twin.layers.has('b3d')) {
      m.dragRotate.enable(); m.touchZoomRotate.enableRotation();
      if (m.getPitch() < 10) m.easeTo({ pitch: 55, bearing: -18, duration: reduced ? 0 : 500 });
    } else {
      m.dragRotate.disable(); m.touchZoomRotate.disableRotation();
      if (m.getPitch() > 0 || m.getBearing() !== 0) m.easeTo({ pitch: 0, bearing: 0, duration: reduced ? 0 : 300 });
    }
  }, [lens, ready, twin.layers, twin.selectedNbsId]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !showStudents) return;
    const source = m.getSource<GeoJSONSource>('students');
    if (!source) return;
    const draw = () => source.setData(walkerFeatures(walkers, simSeconds.current));
    draw();
    if (!playing || !walkers.length) return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const step = (now - last) / 1000;
      last = now;
      if (document.hidden || m.isMoving()) return;
      simSeconds.current += Math.min(0.25, step);
      draw();
    }, 100);
    return () => clearInterval(timer);
  }, [ready, showStudents, walkers, playing]);

  // Smoothly focus on selected building or stop (respects reduced motion)
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !focusCoord) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (focusCoord.stopRadius) {
      const bounds = new LngLatBounds();
      for (const [lon, lat] of circlePolygon(focusCoord.coord, 300)) bounds.extend([lon, lat]);
      m.fitBounds(bounds, { padding: 28, pitch: 0, bearing: 0, duration: reduced ? 0 : 280 });
      return;
    }
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
  const parsed = hoverText ? JSON.parse(hoverText) : null;
  if (parsed && (parsed.kind !== 'parking' || lens === 'twin' && twin.layers.has('parking'))) {
    if (parsed.kind === 'docks') {
      const d = parsed.p;
      legend = `YouBike · ${l === 'en' ? DOCK_EN[d.id] ?? d.en : d.zh} · ${d.bikes} ${l === 'en' ? 'bikes' : '車'} · ${d.free}/${d.capacity} ${l === 'en' ? 'docks free' : '空位'}`;
    } else if (parsed.kind === 'vd') {
      const f = parsed.p; const lab = String(f.label).split(' / ');
      legend = `${l === 'en' ? lab[0] : lab[1]} · ${f.speed ?? '—'} km/h · ${Number(f.vph).toLocaleString('en-US')} ${l === 'en' ? 'veh/h' : '輛/時'} · Freeway Bureau VD`;
    } else if (parsed.kind === 'bio') {
      legend = `${parsed.p.vn && parsed.p.vn !== parsed.p.sp ? parsed.p.vn + ' · ' : ''}${parsed.p.sp} · ${parsed.p.y} · ±${parsed.p.u} m · GBIF`;
    } else if (parsed.kind === 'parking') {
      const p = parsed.p;
      const name = p.name || PARKING_NAMES[p.kind as ParkingKind]?.[l === 'en' ? 0 : 1];
      const capacity = p.capacity != null ? `${p.capacity} ${l === 'en' ? 'mapped spaces' : '登錄車位'}` : (l === 'en' ? 'capacity unknown' : '容量未登錄');
      legend = `${name} · ${capacity} · ${p.access ? `${l === 'en' ? 'access tag' : '通行標籤'}: ${p.access} · ` : ''}OSM ${p.osm}`;
    } else if (parsed.kind === 'nbs') {
      legend = `NbS · ${l === 'en' ? parsed.p.title_en : parsed.p.title_zh} · ${l === 'en' ? 'click to inspect photo' : '點選檢視現地照片'}`;
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
    const overlay = twin.layers.has('green') && twin.ndvi;
    legend = overlay
      ? (twin.vegetationView === 'repeat'
        ? (l === 'en' ? 'Repeat 2026 NDVI · amber ↓ lower · blue ↑ higher · ○ YouBike · ● NbS' : '2026 重複變化・琥珀 ↓ 下降・藍 ↑ 上升・○ YouBike・● 自然解方')
        : (l === 'en' ? 'Latest NDVI · amber ↓ lower · blue ↑ higher · ○ YouBike · ● NbS' : '最新影像・琥珀 ↓ 下降・藍 ↑ 上升・○ YouBike・● 自然解方'))
      : (l === 'en' ? '3D NLSC Tyrian ramp · ○ YouBike · ● NbS · drag to rotate' : '3D 國土測繪光達・○ YouBike・● 自然解方・拖曳旋轉');
  } else if (lens === 'move') {
    legend = selectedStopName
      ? (l === 'en' ? `${selectedStopName} · dashed ring = 300 m straight-line radius` : `${selectedStopName} · 虛線圓 = 直線半徑 300 公尺`)
      : (l === 'en' ? 'Select an on-campus stop (white dot) to show a 300 m radius' : '選擇校內白點公車站以顯示 300 m 半徑');
  } else {
    legend = l === 'en'
      ? 'Select any building for its dossier: height, solar, substation, transit · dashed = OSM boundary'
      : '點選任一建物檢視光電、變電站與公車距離 · 虛線 = OSM 校界';
  }

  return (
    <div className="map" id="map">
      <div className="mapctl">
        <button aria-pressed={!photo} onClick={() => setPhoto(false)}>{l === 'en' ? 'Plan' : '平面'}</button>
        <button aria-pressed={photo} onClick={() => setPhoto(true)}>{l === 'en' ? 'Photo' : '航照'}</button>
        <button aria-pressed={showLabels} onClick={() => setShowLabels(s => !s)}>{l === 'en' ? 'Labels' : '標註'}</button>
        {showStudents && (
          <button onClick={() => setPlaying(p => !p)} aria-label={playing
            ? (l === 'en' ? 'Pause simulated students' : '暫停學生模擬')
            : (l === 'en' ? 'Play simulated students' : '播放學生模擬')}>
            {playing ? (l === 'en' ? 'Pause' : '暫停') : (l === 'en' ? 'Play' : '播放')}
          </button>
        )}
        <button onClick={resetView} aria-label={l === 'en' ? 'Reset map view' : '重置地圖視角'}>{l === 'en' ? 'Reset' : '重置'}</button>
      </div>
      <div className="legend">{legend}
        {lens === 'twin' && twin.layers.has('parking') && (
          <span className="layer-key">{l === 'en' ? 'OSM parking · P car · M motorcycle · B bicycle' : 'OSM 停車 · P 汽車 · M 機車 · B 自行車'}
            {twin.campusLayers && ` · ${twin.campusLayers.meta.asOf}`}</span>
        )}
        {showStudents && (
          <span className="layer-key">{l === 'en' ? 'Simulated students · dots locate walkers · zoom for 1.7 m figures' : '模擬學生・點為行人位置・放大可見 1.7 公尺人像'}</span>
        )}
      </div>
      <div className="map-surface" ref={el} />
    </div>
  );
}
