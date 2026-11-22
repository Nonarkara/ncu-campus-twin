// Spatial geometry & verified OSM campus anchor definitions.
// Every coordinate is derived directly from OSM polygons in public/data/campus.json.

export interface BuildingProps {
  id: string;
  name: string | null;
  name_en: string | null;
  kind: string;
  area_m2: number;
  levels: number | null;
  height_m: number | null;
  height_source?: string | null;
  height_tier?: 'observed' | 'modeled' | null;
  nlsc_n?: number;   // NLSC LiDAR roof sections inside this footprint
  nlsc_min?: number; // lowest of them (m); height_m is the tallest
  height_mdate?: string | null;
  kwp: number;
  kwh_yr: number;
}

export interface BuildingFeature {
  type: 'Feature';
  properties: BuildingProps;
  geometry: { type: 'Polygon'; coordinates: number[][][] };
}

export interface StopFeature {
  type: 'Feature';
  properties: { name: string | null; osm: string };
  geometry: { type: 'Point'; coordinates: [number, number] };
}

export interface CampusData {
  meta: {
    source: string;
    tier: string;
    fetchedAt: string;
    heights?: { source: string; tier: string; fetchedAt: string; matched_nlsc: number; matched_osm_floors: number; unknown: number };
  };
  campus: any;
  buildings: { type: 'FeatureCollection'; features: BuildingFeature[] };
  context: any;
  stops: { type: 'FeatureCollection'; features: StopFeature[] };
}

export const ON_CAMPUS_STOPS = [
  '中央大學警衛室',
  '中大湖',
  '依仁堂',
  '中央大學後門',
  '觀景台',
  '國鼎圖書館',
] as const;

export const SUBSTATION_ID = 'way/268824891'; // 高壓變電站 (verified OSM)

export interface CampusAnchor {
  id: string;
  role: 'substation' | 'microgrid' | 'lab' | 'housing' | 'admin';
  tag: [string, string];
  note: [string, string];
}

export const CAMPUS_ANCHORS: Record<string, CampusAnchor> = {
  'way/268824891': {
    id: 'way/268824891',
    role: 'substation',
    tag: ['HV Substation', '高壓變電站'],
    note: ['Primary campus grid tie-in point', '校內高壓電力匯流與併網節點'],
  },
  'way/268841454': {
    id: 'way/268841454',
    role: 'microgrid',
    tag: ['EE Microgrid Lead', '電機系微電網團隊'],
    note: ['Prof. Chen Cheng-yi microgrid research lead', '陳正一教授微電網計畫主持單位'],
  },
  'way/202690841': {
    id: 'way/202690841',
    role: 'lab',
    tag: ['Precision Lab', '精密光電實驗室'],
    note: ['Optoelectronics labs · candidate 4 h islanding load', '光電精密實驗室・4 小時孤島供電候選負荷'],
  },
  'way/217833430': {
    id: 'way/217833430',
    role: 'lab',
    tag: ['CSRSR Satellite', '太空遙測中心'],
    note: ['Taiwan’s first earth-resources satellite receiving station (1994)', '臺灣首座資源衛星接收站（1994）'],
  },
  'way/268561943': {
    id: 'way/268561943',
    role: 'lab',
    tag: ['Advanced R&D', '前瞻科技中心'],
    note: ['Candidate critical precision-lab islanding load', '精密儀器孤島供電候選負荷'],
  },
  'way/202805788': {
    id: 'way/202805788',
    role: 'housing',
    tag: ['Renovation from Jul 2026', '2026.07 起整修'],
    note: ['Female Dorm 14 renovation decants graduate students', '女十四舍 2026 年 7 月整修影響研究生住宿調配'],
  },
  'way/270806669': {
    id: 'way/270806669',
    role: 'admin',
    tag: ['General Affairs', '行政／總務處'],
    note: ['Owns transport, parking, and campus energy policy', '負責交通、停車與校園能源管理'],
  },
};

export const LAB_PRESET_IDS = [
  'way/268841454', // 電機系 (182 kWp)
  'way/202690841', // 國鼎光電大樓 (260 kWp)
  'way/217833430', // 太空及遙測研究中心 (462 kWp)
  'way/268561943', // 前瞻科技研究中心 (104 kWp)
];

export function polygonCentroid(ring: number[][]): [number, number] {
  const n = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.length - 1
    : ring.length;
  let lon = 0, lat = 0;
  for (let i = 0; i < n; i++) {
    lon += ring[i][0];
    lat += ring[i][1];
  }
  return [lon / n, lat / n];
}

export function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371008.8;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export function nearestOnCampusStop(
  coord: [number, number],
  stops: StopFeature[],
): { name: string; distanceM: number; walkMin: number } | null {
  let best: { name: string; distanceM: number; walkMin: number } | null = null;
  for (const s of stops) {
    if (!s.properties.name || !(ON_CAMPUS_STOPS as readonly string[]).includes(s.properties.name)) continue;
    const d = haversineMeters(coord, s.geometry.coordinates);
    if (!best || d < best.distanceM) {
      best = { name: s.properties.name, distanceM: d, walkMin: Math.max(1, Math.round(d / 75)) };
    }
  }
  return best;
}

export function circlePolygon(center: [number, number], radiusM: number, steps = 48): number[][] {
  const R = 6371008.8;
  const latRad = (center[1] * Math.PI) / 180;
  const dLat = (radiusM / R) * (180 / Math.PI);
  const dLon = dLat / Math.cos(latRad);
  const ring: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * 2 * Math.PI;
    ring.push([+(center[0] + dLon * Math.cos(theta)).toFixed(6), +(center[1] + dLat * Math.sin(theta)).toFixed(6)]);
  }
  return ring;
}

export function minutesUntil(nowHm: string, targetHm: string): number {
  const [nh, nm] = nowHm.split(':').map(Number);
  const [th, tm] = targetHm.split(':').map(Number);
  return (th * 60 + tm) - (nh * 60 + nm);
}
