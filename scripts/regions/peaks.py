"""Build-only PyOsmium 4.3.2 peak gazetteer; no network requests or runtime dependency."""
import json
import re
import sys
import osmium

source, output, encoded_extent = sys.argv[1:]
west, south, east, north = json.loads(encoded_extent)
if not (-180 <= west < east <= 180 and -85 <= south < north <= 85):
    raise ValueError('Invalid peak extent')
peaks = []
skipped_unnamed = 0
ELE = re.compile(r'^\s*(-?\d+(?:\.\d+)?)\s*(m|metres|meters)?\s*$', re.IGNORECASE)


def clean(value, limit=160):
    return re.sub(r'[\x00-\x1f\x7f]', '', str(value)).strip()[:limit]


def elevation(raw):
    """Only an unambiguous metre value; feet, ranges and words stay unknown."""
    match = ELE.match(raw or '')
    if not match:
        return None
    value = float(match.group(1))
    return round(value, 1) if -500 <= value <= 9000 else None


class Peaks(osmium.SimpleHandler):
    def node(self, node):
        global skipped_unnamed
        if node.tags.get('natural') != 'peak' or not node.location.valid():
            return
        lon, lat = node.location.lon, node.location.lat
        if not (west <= lon <= east and south <= lat <= north):
            return
        name = clean(node.tags.get('name', '')) or clean(node.tags.get('name:en', ''))
        name_hi = clean(node.tags.get('name:hi', '')) or None
        if not name and name_hi:
            name = name_hi
        if not name:
            skipped_unnamed += 1
            return
        peaks.append({
            'id': f'node/{node.id}',
            'name': name,
            'nameHi': name_hi if name_hi != name else None,
            'eleM': elevation(node.tags.get('ele')),
            'lat': round(lat, 7),
            'lon': round(lon, 7),
        })
        if len(peaks) > 10000:
            raise ValueError('Peak extent exceeds 10000-feature limit')


with osmium.io.Reader(source) as reader:
    extract_at = reader.header().get('osmosis_replication_timestamp')
handler = Peaks()
for obj in osmium.FileProcessor(source, osmium.osm.NODE).with_filter(osmium.filter.KeyFilter('natural')):
    handler.node(obj)
peaks.sort(key=lambda entry: entry['id'])
with open(output, 'w', encoding='utf-8') as handle:
    json.dump({'version': 1, 'entries': peaks}, handle, ensure_ascii=False, separators=(',', ':'))
print(json.dumps({'extractAt': extract_at, 'skippedUnnamed': skipped_unnamed}))
