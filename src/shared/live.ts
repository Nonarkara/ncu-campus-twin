// Live open feeds that need no key: YouBike 2.0 docks and Freeway Bureau vehicle detectors near NCU.
// Pure parsers so they can be tested on captured payloads. A station or detector missing from the feed is omitted, never zeroed.
import type { Meta } from './today';

export interface Dock { id: string; zh: string; en: string; capacity: number; bikes: number; free: number; lon: number; lat: number; at: string }
export interface Flow { id: string; label: [string, string]; dir: 'S' | 'N'; kind: 'main' | 'exit'; lon: number; lat: number; speed: number | null; vph: number; at: string }
export interface Live { docks: { meta: Meta; data: Dock[] }; road: { meta: Meta; data: Flow[] } }

/** YouBike stations on or at the edge of campus (station_no from the YouBike feed, positions checked against OSM amenity=bicycle_rental). */
export const DOCKS = ['500304001', '500304032', '500305053'];
/** Short English names; the feed's own English for 依仁堂 is an office name, not the place. */
export const DOCK_EN: Record<string, string> = { '500304001': 'Library', '500304032': 'Yiren Hall', '500305053': 'Sports Center' };

/** National Freeway 1 at the Zhongli interchange (62K), the motorway exit that serves NCU. */
/** Positions are the detectors' own PositionLon/Lat from the Freeway Bureau VD.xml static list. */
export const VDS: { id: string; label: [string, string]; dir: 'S' | 'N'; kind: 'main' | 'exit'; lon: number; lat: number }[] = [
  { id: 'VD-N1-S-61.800-M-LOOP', label: ['N1 southbound, Zhongli IC', '國1南向・中壢交流道'], dir: 'S', kind: 'main', lon: 121.2038621, lat: 24.961097 },
  { id: 'VD-N1-N-61.580-M-LOOP', label: ['N1 northbound, Zhongli IC', '國1北向・中壢交流道'], dir: 'N', kind: 'main', lon: 121.2056189, lat: 24.9621239 },
  { id: 'VD-N1-S-62-O-NW-1-中壢', label: ['Zhongli exit, from north', '南向中壢出口匝道'], dir: 'S', kind: 'exit', lon: 121.2007372, lat: 24.9586613 },
  { id: 'VD-N1-N-62-O-SE-1-中壢', label: ['Zhongli exit, from south', '北向中壢出口匝道'], dir: 'N', kind: 'exit', lon: 121.199427, lat: 24.9561729 },
];

/** Below this mainline speed the road is shown as slow (house rule; free flow here is ~100 km/h). */
export const SLOW_KMH = 40;

export function parseYouBike(rows: any[], ids = DOCKS): Dock[] {
  return ids.flatMap(id => {
    const s = rows.find(r => r.station_no === id);
    if (!s || typeof s.parking_spaces !== 'number') return [];
    return [{ id, zh: s.name_tw, en: s.name_en, capacity: s.parking_spaces, bikes: s.available_spaces, free: s.empty_spaces,
      lon: +s.lng, lat: +s.lat, at: String(s.updated_at).replace(' ', 'T') + '+08:00' }];
  });
}

const tag = (b: string, t: string) => [...b.matchAll(new RegExp(`<${t}>([^<]*)</${t}>`, 'g'))].map(m => m[1]);

/** Slices each wanted <VDLive> block out by indexOf (the full file is ~5 MB), then volume-weights lane speeds. */
export function parseVDLive(xml: string, vds = VDS): Flow[] {
  return vds.flatMap(v => {
    const i = xml.indexOf(`<VDID>${v.id}</VDID>`);
    if (i < 0) return [];
    const b = xml.slice(i, xml.indexOf('</VDLive>', i));
    if (tag(b, 'Status')[0] !== '0') return [];
    const lanes = [...b.matchAll(/<Lane>([\s\S]*?)<\/Lane>/g)].map(m => m[1]);
    let vol = 0, sv = 0;
    for (const l of lanes) {
      const speed = +tag(l, 'Speed')[0];
      const n = tag(l, 'Volume').reduce((s, x) => s + (+x > 0 ? +x : 0), 0);
      if (speed > 0 && n > 0) { vol += n; sv += speed * n; }
    }
    const at = tag(b, 'DataCollectTime')[0];
    // Volumes are per one-minute collection; ×60 gives an hourly rate.
    return [{ ...v, speed: vol ? Math.round(sv / vol) : null, vph: vol * 60, at }];
  });
}
