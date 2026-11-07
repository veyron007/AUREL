/**
 * Provenance envelopes for tool results (AUREL Phase 6, WP6).
 *
 * Every Field Kit answer, and every existing read tool's answer, carries one
 * envelope next to its data: the class of what it reports (observed,
 * modelled, derived, simulated or note), the sources with their licences,
 * the time the content applies to, when it was retrieved, and units where the
 * tool states numbers. Agents cite it verbatim. An envelope never claims more
 * than the tool knows: an unknown applicable time stays null and says so.
 *
 * Portable: no DOM, no Node builtins.
 */

export const ENVELOPE_SCHEMA = 'aurel.envelope/1';
export const ENVELOPE_CLASSES = Object.freeze([
  'observed',
  'modelled',
  'derived',
  'simulated',
  'note',
]);

const SEE_SOURCES = 'Per source; see DATA_SOURCES.md';
const src = (id, label, licence, url = null) =>
  Object.freeze({ id, label, licence, url });

const USGS = src(
  'usgs',
  'USGS Earthquake Hazards Program',
  'U.S. public domain',
  'https://earthquake.usgs.gov/earthquakes/feed/',
);
const FIRMS = src(
  'nasa-firms',
  'NASA FIRMS (VIIRS/MODIS active fires)',
  'NASA open data; cite NASA FIRMS',
  'https://firms.modaps.eosdis.nasa.gov/',
);
const LL2 = src(
  'launch-library-2',
  'The Space Devs Launch Library 2',
  'The Space Devs terms of use',
  'https://thespacedevs.com/llapi',
);
const AIRCRAFT = src(
  'flight-feed',
  "God's Eye View flight feed (OpenSky Network, adsb.lol)",
  'OpenSky non-commercial licence; adsb.lol ODbL 1.0',
);
const ADSBDB = src(
  'adsbdb',
  'adsbdb aircraft registry',
  'No licence published; credited as the service asks',
);
const AIS = src(
  'aisstream',
  'AISStream.io live AIS',
  'Free beta service; AIS is a public broadcast',
);
const CELESTRAK = src(
  'celestrak',
  'CelesTrak TLEs propagated with SGP4',
  'US-government-origin data; citation requested',
);
const CCTV = src('cctv-catalog', 'Public traffic camera catalogs', SEE_SOURCES);
const ALPR = src(
  'osm-alpr',
  'OpenStreetMap surveillance tags',
  'ODbL 1.0',
  'https://www.openstreetmap.org/copyright',
);
const RADIO = src(
  'radio-browser',
  'Radio Browser station directory',
  'Public domain station data',
);
const OSM_PLACES = src(
  'place-search',
  'Photon (komoot) on OpenStreetMap data',
  'OpenStreetMap ODbL 1.0',
);
const ROUTING = src(
  'routing',
  'Open routing service on OpenStreetMap data',
  'OpenStreetMap ODbL 1.0',
);
const GBFS = src('gbfs', 'Operator GBFS feeds', SEE_SOURCES);
const GTFS = src('gtfs-rt', 'Operator GTFS-Realtime feeds', SEE_SOURCES);
const TRAFFIC = src(
  'traffic',
  'TomTom flow tiles when keyed, otherwise simulated flow on OpenStreetMap roads',
  'TomTom terms (paused by Free-only); OpenStreetMap ODbL 1.0',
);
const OPEN_METEO = src(
  'open-meteo',
  'Open-Meteo forecast API',
  'CC BY 4.0',
  'https://open-meteo.com/',
);
const WIND = src(
  'wind-models',
  'NOAA GFS or ECMWF IFS open data',
  'NOAA U.S. public domain; ECMWF CC BY 4.0',
);
const WEATHER_MAPS = src(
  'weather-maps',
  'NOAA nowCOAST and model weather maps',
  SEE_SOURCES,
);
const GIBS = src('nasa-gibs', 'NASA GIBS / CMR (HLS, VIIRS)', 'NASA open data');
const CABLES = src(
  'telegeography',
  'TeleGeography submarine cable map',
  'CC BY-NC-SA 3.0',
);
const INFRA = src(
  'infrastructure',
  'OpenStreetMap infrastructure extracts',
  'ODbL 1.0',
);
const EVENTS = src('event-pack', 'Bundled event pack', SEE_SOURCES);
const REGIONAL = src(
  'regional',
  'Regional news and place context',
  SEE_SOURCES,
);
const NHC = src('noaa-nhc', 'NOAA NHC / CPHC advisories', 'U.S. public domain');
const WFIGS = src('nifc-wfigs', 'NIFC WFIGS perimeters', 'U.S. public domain');
const TERRAIN = src('terrain', 'Terrain height service', SEE_SOURCES);
const MILITARY = src(
  'military-installations',
  'OpenStreetMap and Overture military areas',
  'ODbL 1.0',
);
const FEATURES = src('map-features', 'OpenStreetMap features', 'ODbL 1.0');
export const APP_SOURCE = src(
  'gods-eye-view',
  "God's Eye View application",
  'MIT (code); data per layer',
);
const LAYERS = src(
  'loaded-layers',
  "God's Eye View loaded layers",
  SEE_SOURCES,
);

const entry = (cls, sources, note = null, units = null) =>
  Object.freeze({ class: cls, sources: Object.freeze(sources), note, units });

/**
 * What each existing read tool reports. A tool not listed here gets class
 * `derived` from the app with a note that its provenance is not recorded,
 * never a guessed observation.
 */
export const READ_TOOL_PROVENANCE = Object.freeze({
  get_earthquakes: entry('observed', [USGS], null, {
    magnitude: 'magnitude as reported by USGS',
    depth_km: 'km',
  }),
  get_active_fires: entry('observed', [FIRMS], null, { frp_mw: 'MW' }),
  get_recent_launches: entry(
    'observed',
    [LL2],
    'Launch times for scheduled launches are announcements, not observations.',
  ),
  aircraft_in_area: entry('observed', [AIRCRAFT]),
  find_aircraft: entry('observed', [AIRCRAFT]),
  get_aircraft_track: entry('observed', [AIRCRAFT]),
  get_aircraft_info: entry('observed', [AIRCRAFT, ADSBDB]),
  vessels_in_area: entry('observed', [AIS]),
  find_vessel: entry('observed', [AIS]),
  get_vessel_track: entry('observed', [AIS]),
  next_satellite_pass: entry(
    'modelled',
    [CELESTRAK],
    'Pass times are SGP4 propagations of the latest TLE epoch.',
  ),
  satellites_overhead: entry(
    'modelled',
    [CELESTRAK],
    'Positions are SGP4 propagations of the latest TLE epoch.',
  ),
  find_cctv_cameras: entry('observed', [CCTV]),
  get_cctv_snapshot: entry('observed', [CCTV]),
  find_alpr_cameras: entry('observed', [ALPR]),
  find_radio_stations: entry('observed', [RADIO]),
  search_places: entry('observed', [OSM_PLACES]),
  places_nearby: entry('observed', [OSM_PLACES]),
  plan_route: entry(
    'derived',
    [ROUTING],
    'Distances and durations are computed by the routing engine.',
  ),
  get_bike_share: entry('observed', [GBFS]),
  get_transit_vehicles: entry('observed', [GTFS]),
  get_traffic_flow: entry(
    'simulated',
    [TRAFFIC],
    'Under Free-only the flow is simulated; treat speeds as illustrative.',
  ),
  get_weather: entry('modelled', [OPEN_METEO]),
  get_weather_map: entry('modelled', [WEATHER_MAPS]),
  get_wind: entry('modelled', [WIND]),
  get_recent_imagery: entry('observed', [GIBS]),
  find_submarine_cables: entry('observed', [CABLES]),
  find_infrastructure: entry('observed', [INFRA]),
  get_bhote_koshi_flood: entry('observed', [EVENTS]),
  get_regional_brief: entry('derived', [REGIONAL]),
  get_cyclones: entry(
    'modelled',
    [NHC],
    'Forecast tracks and cones are official forecasts.',
  ),
  get_fire_perimeters: entry('observed', [WFIGS]),
  get_terrain_height: entry('modelled', [TERRAIN]),
  find_military_installations: entry('observed', [MILITARY]),
  get_map_features: entry('observed', [FEATURES]),
  situation_brief: entry('derived', [LAYERS]),
  military_awareness: entry('derived', [AIRCRAFT, MILITARY]),
  get_hud_caption: entry('derived', [LAYERS]),
  show_in_gods_eye_view: entry('note', [APP_SOURCE]),
});

const TIME_KEYS = [
  'time',
  'observed_at',
  'acquired_at',
  'applicable_time',
  'valid_time',
  'issued_at',
  'updated_at',
  'last_seen',
];
const RETRIEVED_KEYS = ['retrieved_at', 'fetched_at', 'as_of'];
const MAX_ROWS_SCANNED = 500;

/** An ISO 8601 UTC string for an epoch or a parseable string, else null. */
export function isoOrNull(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0)
    return new Date(value).toISOString();
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/**
 * The span of times the content applies to, read from the data the tool
 * returned: top-level time keys and each row's time keys. Null when no time
 * is stated; the envelope then says it is unknown.
 */
export function applicableTimeOf(data) {
  const times = [];
  const collect = (record) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return;
    for (const key of TIME_KEYS) {
      const iso = isoOrNull(record[key]);
      if (iso) times.push(iso);
    }
  };
  collect(data);
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  rows.slice(0, MAX_ROWS_SCANNED).forEach(collect);
  if (!times.length) return null;
  times.sort();
  return { from: times[0], to: times.at(-1) };
}

function retrievedTimeOf(data) {
  for (const key of RETRIEVED_KEYS) {
    const iso = isoOrNull(data?.[key]);
    if (iso) return iso;
  }
  return null;
}

function invalid(field) {
  throw new TypeError(`Invalid provenance envelope: ${field}`);
}

function validateSources(sources) {
  if (!Array.isArray(sources) || !sources.length) invalid('sources');
  for (const source of sources) {
    for (const key of ['id', 'label', 'licence'])
      if (typeof source?.[key] !== 'string' || !source[key])
        invalid(`sources.${key}`);
    if (source.url !== null && typeof source.url !== 'string')
      invalid('sources.url');
  }
}

function validateTime(time) {
  if (time === null) return;
  if (
    !time ||
    isoOrNull(time.from) !== time.from ||
    isoOrNull(time.to) !== time.to ||
    time.from > time.to
  )
    invalid('applicable_time');
}

/** Validate an envelope; returns it or throws a TypeError naming the field. */
export function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') invalid('envelope');
  if (envelope.schema !== ENVELOPE_SCHEMA) invalid('schema');
  if (typeof envelope.tool !== 'string' || !envelope.tool) invalid('tool');
  if (!ENVELOPE_CLASSES.includes(envelope.class)) invalid('class');
  validateSources(envelope.sources);
  validateTime(envelope.applicable_time);
  if (isoOrNull(envelope.retrieved_at) !== envelope.retrieved_at)
    invalid('retrieved_at');
  if (
    envelope.units !== null &&
    (typeof envelope.units !== 'object' || Array.isArray(envelope.units))
  )
    invalid('units');
  if (typeof envelope.note !== 'string' || !envelope.note) invalid('note');
  return envelope;
}

const UNKNOWN_TIME_NOTE =
  'Applicable time is not stated by the source; treat it as unknown.';

/** Build one validated, frozen envelope. */
export function createEnvelope({
  tool,
  cls,
  sources,
  applicableTime = null,
  retrievedAt,
  units = null,
  note = null,
}) {
  const notes = [note, applicableTime === null ? UNKNOWN_TIME_NOTE : null];
  return Object.freeze(
    validateEnvelope({
      schema: ENVELOPE_SCHEMA,
      tool,
      class: cls,
      sources: sources.map((source) => ({
        id: source.id,
        label: source.label,
        licence: source.licence,
        url: source.url ?? null,
      })),
      applicable_time: applicableTime,
      retrieved_at: retrievedAt,
      units: units ? { ...units } : null,
      note: notes.filter(Boolean).join(' ') || 'No caveats recorded.',
    }),
  );
}

function readNote(known, data) {
  if (!known)
    return 'Provenance for this tool is not recorded; it reports what the app derived.';
  if (known.note) return known.note;
  return data?.stale === true
    ? 'The source answered from cache; data may be stale.'
    : null;
}

/** The envelope for a read tool's result, without changing its data. */
export function envelopeForResult(toolName, result, { now = Date.now() } = {}) {
  const known = READ_TOOL_PROVENANCE[toolName];
  const data = result?.data;
  return createEnvelope({
    tool: toolName,
    cls: known?.class ?? 'derived',
    sources: known?.sources ?? [APP_SOURCE],
    applicableTime: applicableTimeOf(data),
    retrievedAt: retrievedTimeOf(data) ?? new Date(now).toISOString(),
    units: known?.units ?? null,
    note: readNote(known, data),
  });
}

/**
 * Catalog interceptor that stamps an envelope on every result that does not
 * carry one. `result.data` is passed through untouched. Nested calls (one
 * tool composing another) are stamped once, by the outer call.
 */
export function envelopeInterceptor({ now = Date.now } = {}) {
  return async (call, next) => {
    const result = await next(call);
    // App-only tools (the panel's loader) answer the panel, not a model.
    const appOnly = call.tool.ui?.visibility?.includes('model') === false;
    if (result?.envelope || appOnly || call.parent) return result;
    return {
      ...result,
      envelope: envelopeForResult(call.tool.name, result, { now: now() }),
    };
  };
}
