/**
 * Synthetic OpenAQ v3 and sensor.community payloads, shaped from the published
 * OpenAPI schema and a real Stuttgart sample. Names say "fixture"; no value
 * here is an observation of any real station.
 */
const HOUR_MS = 3_600_000;

export const FIXTURE_POINT = Object.freeze({ lat: 30.3165, lon: 78.0322 });

const sensorsFrom = (base) => [
  {
    id: base + 1,
    name: 'pm25 µg/m³',
    parameter: { id: 2, name: 'pm25', units: 'µg/m³' },
  },
  {
    id: base + 2,
    name: 'pm10 µg/m³',
    parameter: { id: 1, name: 'pm10', units: 'µg/m³' },
  },
  {
    id: base + 3,
    name: 'no2 µg/m³',
    parameter: { id: 15, name: 'no2', units: 'µg/m³' },
  },
  {
    id: base + 4,
    name: 'co µg/m³',
    parameter: { id: 4, name: 'co', units: 'µg/m³' },
  },
  {
    id: base + 5,
    name: 'temperature c',
    parameter: { id: 100, name: 'temperature', units: 'c' },
  },
];

const monitor = (id, name, lat, lon, distance) => ({
  id,
  name,
  locality: 'Dehradun',
  timezone: 'Asia/Kolkata',
  isMobile: false,
  isMonitor: true,
  owner: { id: 4, name: 'Fixture board' },
  provider: { id: 168, name: 'Fixture network' },
  coordinates: { latitude: lat, longitude: lon },
  distance,
  licenses: [{ id: 1, name: 'CC BY 4.0' }],
  sensors: sensorsFrom(id === 9001 ? 9100 : 9200),
  datetimeLast: { utc: '2026-11-07T05:00:00Z' },
});

/** Two monitors near Dehradun plus one low-cost sensor that must be ignored. */
export function openAqLocations({ empty = false } = {}) {
  if (empty) return { meta: { found: 0 }, results: [] };
  return {
    meta: { name: 'openaq-api', page: 1, limit: 20, found: 3 },
    results: [
      monitor(9002, 'Fixture monitor B', 30.35, 78.06, 4500.4),
      monitor(9001, 'Fixture monitor A', 30.32, 78.04, 820.6),
      {
        id: 9003,
        name: 'Fixture low-cost sensor',
        isMobile: false,
        isMonitor: false,
        coordinates: { latitude: 30.31, longitude: 78.03 },
        distance: 300,
        sensors: sensorsFrom(9300),
      },
    ],
  };
}

/** Latest values for a fixture location, observed `ageMs` before `now`. */
export function openAqLatest(
  locationId,
  { now, ageMs = HOUR_MS, pm25 = 62 } = {},
) {
  const base = locationId === 9001 ? 9100 : 9200;
  const at = new Date(
    Math.floor((now - ageMs) / HOUR_MS) * HOUR_MS,
  ).toISOString();
  const row = (sensorsId, value) => ({
    datetime: { utc: at, local: at },
    value,
    coordinates: { latitude: 30.32, longitude: 78.04 },
    sensorsId,
    locationsId: locationId,
  });
  return {
    meta: { found: 4 },
    results: [
      row(base + 1, pm25),
      row(base + 2, 110),
      row(base + 3, 35),
      row(base + 4, 900),
    ],
  };
}

/** `count` hourly aggregates ending at the hour boundary at or before `now`. */
export function openAqHours({
  now,
  value = 62,
  count = 24,
  units = 'µg/m³',
  flaggedEvery = 0,
} = {}) {
  const end = Math.floor(now / HOUR_MS) * HOUR_MS;
  return {
    meta: { found: count },
    results: Array.from({ length: count }, (_, i) => {
      const to = end - i * HOUR_MS;
      return {
        value: typeof value === 'function' ? value(i) : value,
        flagInfo: { hasFlags: flaggedEvery > 0 && i % flaggedEvery === 0 },
        parameter: { id: 2, name: 'pm25', units },
        period: {
          label: 'raw',
          interval: '01:00:00',
          datetimeFrom: { utc: new Date(to - HOUR_MS).toISOString() },
          datetimeTo: { utc: new Date(to).toISOString() },
        },
        coverage: { percentComplete: 100 },
      };
    }),
  };
}

const citizenRow = (id, lat, lon, p2, p1, stamp, indoor = 0) => ({
  id: id * 10,
  timestamp: stamp,
  sampling_rate: null,
  sensor: {
    id,
    pin: '1',
    sensor_type: { id: 14, manufacturer: 'Nova Fitness', name: 'SDS011' },
  },
  location: {
    id,
    country: 'IN',
    indoor,
    exact_location: 0,
    altitude: '640.0',
    latitude: String(lat),
    longitude: String(lon),
  },
  sensordatavalues: [
    { id: id * 100 + 1, value: String(p1), value_type: 'P1' },
    { id: id * 100 + 2, value: String(p2), value_type: 'P2' },
  ],
});

/** sensor.community area rows: two outdoor sensors, one indoor, one empty. */
export function sensorCommunityArea({
  now,
  empty = false,
  ageMs = 4 * 60_000,
} = {}) {
  if (empty) return [];
  const stamp = new Date(now - ageMs)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
  return [
    citizenRow(501, 30.33, 78.05, 48.2, 70.1, stamp),
    citizenRow(502, 30.3, 78.0, 55.0, 81.3, stamp),
    citizenRow(503, 30.32, 78.03, 12.0, 20.0, stamp, 1),
    {
      ...citizenRow(504, 30.31, 78.02, '', '', stamp),
      sensordatavalues: [{ value: '', value_type: 'P2' }],
    },
  ];
}

const FIXTURE_HOURLY = Object.freeze({ 1: 62, 2: 110, 3: 35, 4: 900 });

/** A fetch answering OpenAQ and sensor.community URLs from these fixtures. */
export function airQualityFixtureFetch({
  now,
  calls = [],
  latestAgeMs = HOUR_MS,
  empty = false,
} = {}) {
  return async (url, init = {}) => {
    const href = String(url);
    calls.push({ url: href, headers: init.headers || {} });
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (href.includes('data.sensor.community'))
      return json(sensorCommunityArea({ now, empty }));
    if (/\/v3\/locations\?/.test(href)) return json(openAqLocations({ empty }));
    const latest = href.match(/\/v3\/locations\/(\d+)\/latest/);
    if (latest)
      return json(openAqLatest(Number(latest[1]), { now, ageMs: latestAgeMs }));
    const hours = href.match(/\/v3\/sensors\/(\d+)\/hours/);
    if (hours)
      return json(
        openAqHours({
          now,
          value: FIXTURE_HOURLY[Number(hours[1]) % 100] ?? 10,
        }),
      );
    return json({ message: 'not found' }, 404);
  };
}

/** Hour rows in the `/api/air-quality/near` detail shape. */
export function hourRows({ now, value, count = 24, unit = 'µg/m³' }) {
  const end = Math.floor(now / HOUR_MS) * HOUR_MS;
  return Array.from({ length: count }, (_, i) => ({
    endMs: end - (count - 1 - i) * HOUR_MS,
    value,
    unit,
    flagged: false,
  }));
}

/** A complete `/api/air-quality/near` response as the server would send it. */
export function breathPayload({
  now,
  point = FIXTURE_POINT,
  state = 'ok',
  citizenState = 'ok',
  detail = true,
  latestAgeMs = HOUR_MS,
} = {}) {
  const observedAt = new Date(
    Math.floor((now - latestAgeMs) / HOUR_MS) * HOUR_MS,
  ).toISOString();
  const station = (id, name, lat, lon, distanceM) => ({
    id: `openaq:${id}`,
    locationId: id,
    name,
    locality: 'Dehradun',
    owner: 'Fixture board',
    dataProvider: 'Fixture network',
    lat,
    lon,
    distanceM,
    licenses: ['CC BY 4.0'],
    lastObservedAt: observedAt,
    sensors: [
      { sensorId: id * 10 + 1, pollutant: 'pm25', unit: 'µg/m³' },
      { sensorId: id * 10 + 2, pollutant: 'pm10', unit: 'µg/m³' },
      { sensorId: id * 10 + 3, pollutant: 'no2', unit: 'µg/m³' },
    ],
    latest: [
      {
        pollutant: 'pm10',
        sensorId: id * 10 + 2,
        value: 110,
        unit: 'µg/m³',
        observedAt,
      },
      {
        pollutant: 'pm25',
        sensorId: id * 10 + 1,
        value: 62,
        unit: 'µg/m³',
        observedAt,
      },
      {
        pollutant: 'no2',
        sensorId: id * 10 + 3,
        value: 35,
        unit: 'µg/m³',
        observedAt,
      },
    ],
    latestRetrievedAt: new Date(now).toISOString(),
  });
  const listed = ['ok', 'partial', 'stale', 'no-data'].includes(state);
  return {
    version: 1,
    requested: { lat: point.lat, lon: point.lon },
    stations: {
      tier: 'station',
      provider: 'openaq',
      radiusM: 25_000,
      state,
      reason: null,
      retrievedAt: listed ? new Date(now).toISOString() : null,
      stations: listed
        ? [
            station(9001, 'Fixture monitor A', 30.32, 78.04, 821),
            station(9002, 'Fixture monitor B', 30.35, 78.06, 4500),
          ]
        : [],
      detail:
        detail && listed
          ? {
              stationId: 'openaq:9001',
              state: 'ok',
              reason: null,
              retrievedAt: new Date(now).toISOString(),
              series: {
                pm25: hourRows({ now, value: 62 }),
                pm10: hourRows({ now, value: 110 }),
                no2: hourRows({ now, value: 35 }),
              },
            }
          : null,
    },
    citizen: {
      tier: 'citizen',
      provider: 'sensor-community',
      radiusM: 25_000,
      state: citizenState,
      reason: null,
      retrievedAt: new Date(now).toISOString(),
      sensors:
        citizenState === 'ok'
          ? [
              {
                id: 'sensor-community:501',
                locationId: 501,
                sensorType: 'SDS011',
                lat: 30.33,
                lon: 78.05,
                pm25: 48.2,
                pm10: 70.1,
                distanceM: 2100,
                observedAt: new Date(now - 4 * 60_000).toISOString(),
              },
            ]
          : [],
    },
  };
}
