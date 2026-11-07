"""Build-only PyOsmium 4.3.2 crop; no network requests or runtime dependency."""
import json
import re
import sys
import osmium

source, output, encoded_extent = sys.argv[1:]
west, south, east, north = json.loads(encoded_extent)
if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
    raise ValueError('Invalid crop extent')
factory = osmium.geom.GeoJSONFactory()
features = {}
omitted_boundary = 0

def clean(value, limit=160):
    return re.sub(r'[\x00-\x1f\x7f]', '', str(value)).strip()[:limit]

def inside(position):
    return west <= position[0] <= east and south <= position[1] <= north

def coordinates(value):
    if isinstance(value[0], (float, int)):
        return [[round(value[0], 7), round(value[1], 7)]]
    return [p for child in value for p in coordinates(child)]

def emit(obj, osm_type, osm_id, kind, category, geometry):
    global omitted_boundary
    points = coordinates(geometry['coordinates'])
    if not all(inside(point) for point in points):
        if any(inside(point) for point in points):
            omitted_boundary += 1
        return
    name = clean(obj.tags.get('name', ''))
    aliases = list(dict.fromkeys(clean(obj.tags.get(key, '')) for key in ['name:en', 'name:hi', 'alt_name', 'short_name']))
    aliases = [name2 for name2 in aliases if name2 and name2 != name][:8]
    if not name and aliases:
        name, aliases = aliases[0], aliases[1:]
    height = None
    supplied = obj.tags.get('height', '').strip()
    if kind == 'building' and re.fullmatch(r'\d+(?:\.\d+)?\s*(?:m)?', supplied):
        parsed = float(supplied.rstrip('m').strip())
        if 0 < parsed <= 1000:
            height = parsed
    identity = f'{osm_type}/{osm_id}'
    features[identity] = {'type': 'Feature', 'id': identity, 'properties': {
        'kind': kind, 'name': name, 'aliases': aliases, 'osmId': str(osm_id),
        'osmType': osm_type, 'category': clean(category, 80),
        'heightM': height, 'heightSource': 'height' if height is not None else None,
    }, 'geometry': geometry}
    if len(features) > 10000:
        raise ValueError('Crop exceeds 10000-feature limit; choose a smaller area')

class Crop(osmium.SimpleHandler):
    def node(self, node):
        if not node.location.valid() or not inside([node.location.lon, node.location.lat]):
            return
        if not any(node.tags.get(key) for key in ['name', 'name:en', 'name:hi']):
            return
        category = next((node.tags.get(key) for key in ['place', 'amenity', 'tourism', 'shop', 'historic'] if node.tags.get(key)), 'named')
        emit(node, 'node', node.id, 'place', category, {'type': 'Point', 'coordinates': [node.location.lon, node.location.lat]})

    def way(self, way):
        if len(way.nodes) < 2:
            return
        kind, category = None, None
        if way.tags.get('highway') and not way.tags.get('building'):
            kind, category = 'road', way.tags['highway']
        elif way.tags.get('waterway') and way.tags['waterway'] != 'riverbank':
            kind, category = 'water', way.tags['waterway']
        if kind is None:
            return
        if not any(node.location.valid() and inside([node.location.lon, node.location.lat]) for node in way.nodes):
            return
        try:
            geometry = json.loads(factory.create_linestring(way))
        except osmium.InvalidLocationError:
            return
        emit(way, 'way', way.id, kind, category, geometry)

    def area(self, area):
        kind, category = None, None
        if area.tags.get('building') and area.tags['building'] != 'no':
            kind, category = 'building', area.tags['building']
        elif area.tags.get('natural') == 'water' or area.tags.get('waterway') == 'riverbank':
            kind, category = 'water', area.tags.get('water', area.tags.get('waterway', 'water'))
        if kind is None:
            return
        if not any(node.location.valid() and inside([node.location.lon, node.location.lat]) for ring in area.outer_rings() for node in ring):
            return
        try:
            geometry = json.loads(factory.create_multipolygon(area))
        except (osmium.InvalidLocationError, RuntimeError):
            return
        if len(geometry['coordinates']) == 1:
            geometry = {'type': 'Polygon', 'coordinates': geometry['coordinates'][0]}
        emit(area, 'way' if area.from_way() else 'relation', area.orig_id(), kind, category, geometry)

with osmium.io.Reader(source) as reader:
    extract_at = reader.header().get('osmosis_replication_timestamp')
crop = Crop()
processor = (osmium.FileProcessor(source).with_locations('flex_mem')
             .with_areas(osmium.filter.KeyFilter('building', 'natural', 'waterway'))
             .with_filter(osmium.filter.KeyFilter('highway', 'building', 'waterway', 'natural', 'name', 'name:en', 'name:hi')))
for obj in processor:
    if obj.is_node():
        crop.node(obj)
    elif obj.is_way():
        crop.way(obj)
    elif obj.is_area():
        crop.area(obj)
with open(output, 'w', encoding='utf-8') as stream:
    json.dump({'type': 'FeatureCollection', 'features': sorted(features.values(), key=lambda f: f['id'])}, stream, ensure_ascii=False, separators=(',', ':'))
print(json.dumps({'extractAt': extract_at, 'features': len(features), 'omittedBoundaryFeatures': omitted_boundary}))
