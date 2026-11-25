"""Cook NCU parking and walk lines from an OpenStreetMap /api/0.6/map XML export."""
import argparse
import json
import math
import os
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BBOX = '121.1845,24.9648,121.1971,24.972'
PARKING = {'parking', 'parking_space', 'bicycle_parking', 'motorcycle_parking'}
WALK = {'footway', 'pedestrian', 'path', 'steps'}


def edges(ring):
    return zip(ring, ring[1:])


def inside_ring(point, ring):
    x, y = point
    return sum((a[1] > y) != (b[1] > y)
               and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]
               for a, b in edges(ring)) % 2 == 1


def cross(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def crosses(a, b, c, d):
    return cross(a, b, c) * cross(a, b, d) < 0 and cross(c, d, a) * cross(c, d, b) < 0


def meters(a, b):
    return math.hypot((b[0] - a[0]) * 111195 * math.cos(math.radians((a[1] + b[1]) / 2)),
                      (b[1] - a[1]) * 111195)


def collection(features):
    return {'type': 'FeatureCollection', 'features': features}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('xml', type=Path)
    parser.add_argument('--as-of', type=date.fromisoformat, required=True,
                        help='Retrieval date of the local source XML (YYYY-MM-DD)')
    args = parser.parse_args()
    if args.as_of > date.today():
        parser.error('Snapshot date must not be in the future')
    osm = ET.parse(args.xml).getroot()
    cooked = json.loads((ROOT / 'public/data/campus.json').read_text())
    campus = cooked['campus']['geometry']['coordinates']
    footprints = []
    for building in cooked['buildings']['features']:
        geometry = building['geometry']
        polygons = [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']
        for ring, *_ in polygons:
            xs, ys = zip(*ring)
            footprints.append((ring, min(xs), min(ys), max(xs), max(ys)))
    boundary = [ring for polygon in campus for ring in polygon]

    def inside(point):
        return point is not None and any(inside_ring(point, outer) and all(not inside_ring(point, h) for h in holes)
                                         for outer, *holes in campus)

    def on_campus(a, b):
        return inside(a) and inside(b) and inside(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) and not any(
            crosses(a, b, c, d) for ring in boundary for c, d in edges(ring))

    def crosses_building(a, b):
        for ring, left, bottom, right, top in footprints:
            if max(a[0], b[0]) < left or min(a[0], b[0]) > right or max(a[1], b[1]) < bottom or min(a[1], b[1]) > top:
                continue
            midpoint = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            if any(inside_ring(p, ring) for p in (a, midpoint, b)) or any(crosses(a, b, c, d) for c, d in edges(ring)):
                return True
        return False

    nodes = {n.get('id'): (float(n.get('lon')), float(n.get('lat'))) for n in osm.findall('node')}
    parking, paths = [], []
    for obj in osm:
        if obj.tag not in {'way', 'node'}:
            continue
        tags = {t.get('k'): t.get('v') for t in obj.findall('tag')}
        osm_id = f'{obj.tag}/{obj.get("id")}'
        coords = [nodes.get(n.get('ref')) for n in obj.findall('nd')]
        kind = tags.get('amenity')
        if kind in PARKING:
            if obj.tag == 'node' and inside(nodes.get(obj.get('id'))):
                geometry = {'type': 'Point', 'coordinates': nodes[obj.get('id')]}
            elif len(coords) >= 4 and coords[0] == coords[-1] and all(on_campus(a, b) for a, b in edges(coords)):
                geometry = {'type': 'Polygon', 'coordinates': [coords]}
            else:
                continue
            cap = tags.get('capacity', '')
            parking.append({'type': 'Feature', 'geometry': geometry, 'properties': {
                'osm': osm_id, 'kind': kind, 'name': tags.get('name'),
                'capacity': int(cap) if cap.isascii() and cap.isdecimal() else None,
                'access': tags.get('access'),
            }})
        # Model walkers only on explicitly pedestrian-oriented ways. Split at the campus edge.
        if obj.tag != 'way' or tags.get('highway') not in WALK or tags.get('area') == 'yes':
            continue
        if tags.get('access') in {'no', 'private', 'customers'} or tags.get('foot') in {'no', 'private'}:
            continue
        leg, parts = [], []
        for a, b in edges(coords):
            if on_campus(a, b) and not crosses_building(a, b):
                if not leg:
                    leg.append(a)
                if b != a:
                    leg.append(b)
            elif leg:
                parts.append(leg)
                leg = []
        if leg:
            parts.append(leg)
        for i, part in enumerate(parts):
            if sum(meters(a, b) for a, b in edges(part)) >= 15:
                paths.append({'type': 'Feature', 'geometry': {'type': 'LineString', 'coordinates': part},
                              'properties': {'osm': osm_id, 'id': f'{osm_id}/{i}'}})
    if not parking or not paths:
        raise ValueError('Incomplete OSM export: both parking and walk lines are required')
    data = {'meta': {'source': 'OpenStreetMap contributors (ODbL)', 'asOf': args.as_of.isoformat(),
                     'crs': 'EPSG:4326', 'sourceUrl': f'https://api.openstreetmap.org/api/0.6/map?bbox={BBOX}'},
            'parking': collection(parking), 'paths': collection(paths)}
    target = ROOT / 'public/data/campus-layers.json'
    tmp = target.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    os.replace(tmp, target)
    print(f'{len(parking)} parking features, {len(paths)} walk lines, {target.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
