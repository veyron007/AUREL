/** Synthetic Open-Meteo and GIBS fixtures for mountain-weather tests. No live data. */
import { deflateSync } from 'node:zlib';
import {
  FORECAST_FIELDS,
  ENSEMBLE_MODEL,
} from '../sources/mountainWeatherModel.js';

const HOUR = 3600000;
const DAY = 24 * HOUR;
export const CLOCK = Date.parse('2026-11-07T04:20:00.000Z');
const dayStart = (clock) => Math.floor(clock / DAY) * DAY;
const stamp = (at) => new Date(at).toISOString().slice(0, 16);
const hours = (start, count) =>
  Array.from({ length: count }, (_, i) => stamp(start + i * HOUR));

export function forecastRaw({
  lat = 30.5,
  lon = 78,
  elevation = 2000,
  unsupported = [],
  values = {},
  clock = CLOCK,
} = {}) {
  const time = hours(dayStart(clock), 7 * 24);
  const defaults = {
    temperature_2m: 4,
    freezing_level_height: 3900,
    snowfall: 0,
    precipitation: 0.5,
    cloud_cover_low: 40,
    cloud_cover_mid: 20,
    cloud_cover_high: 10,
    visibility: 24000,
    cape: 300,
    wind_speed_700hPa: 6,
    wind_direction_700hPa: 290,
    wind_speed_500hPa: 14,
    wind_direction_500hPa: 300,
  };
  const hourly = { time },
    units = { time: 'iso8601' };
  for (const [key, unit] of Object.values(FORECAST_FIELDS)) {
    const missing = unsupported.includes(key);
    hourly[key] = time.map((_, i) =>
      missing
        ? null
        : typeof values[key] === 'function'
          ? values[key](i)
          : (values[key] ?? defaults[key]),
    );
    units[key] = missing ? 'undefined' : unit;
  }
  return {
    latitude: lat,
    longitude: lon,
    elevation,
    utc_offset_seconds: 0,
    hourly,
    hourly_units: units,
  };
}

export function ensembleRaw({
  members = ENSEMBLE_MODEL.members,
  rate = (m) => (m % 3) * 0.1,
  clock = CLOCK,
} = {}) {
  const time = hours(dayStart(clock), 7 * 24);
  const hourly = { time },
    units = { time: 'iso8601' };
  for (let m = 0; m < members; m++) {
    const key = m
      ? `precipitation_member${String(m).padStart(2, '0')}`
      : 'precipitation';
    hourly[key] = time.map(() => rate(m));
    units[key] = 'mm';
  }
  return {
    latitude: 30.5,
    longitude: 78,
    elevation: 2000,
    utc_offset_seconds: 0,
    hourly,
    hourly_units: units,
  };
}

/** Fifteen days ending yesterday; data stop `lagDays` before today; ERA5-Land optionally empty. */
export function historicalRaw({
  landEmpty = true,
  lagDays = 5,
  rate = 0.25,
  clock = CLOCK,
} = {}) {
  const day0 = dayStart(clock);
  const start = day0 - 15 * DAY;
  const time = hours(start, 15 * 24);
  const cutoff = day0 - lagDays * DAY;
  const series = (empty) =>
    time.map((t) =>
      empty || Date.parse(t + ':00.000Z') >= cutoff ? null : rate,
    );
  return {
    latitude: 30.5,
    longitude: 78,
    elevation: 2000,
    utc_offset_seconds: 0,
    hourly: {
      time,
      precipitation_era5_land: series(landEmpty),
      precipitation_era5: series(false),
    },
    hourly_units: {
      time: 'iso8601',
      precipitation_era5_land: 'mm',
      precipitation_era5: 'mm',
    },
  };
}

export const metaRaw = (runAt = '2026-11-06T18:00:00.000Z') => ({
  last_run_initialisation_time: Date.parse(runAt) / 1000,
  update_interval_seconds: 21600,
});

export const LATEST_IMERG = '2026-11-06T22:30:00Z';
export const domainsXml = (latest = LATEST_IMERG) =>
  `<Domains><DimensionDomain><ows:Identifier>time</ows:Identifier><Domain>2026-11-05/${latest}/PT30M</Domain></DimensionDomain></Domains>`;

/** A four-class colormap shaped like GIBS GPM_Precipitation_Rate.xml. */
export const COLORMAP_ENTRIES = [
  { ref: 0, rgb: [128, 128, 128], nodata: true },
  { ref: 1, rgb: [191, 191, 191], value: '[-INF,0.1)' },
  { ref: 2, rgb: [0, 118, 78], value: '[0.1,1)' },
  { ref: 3, rgb: [58, 3, 48], value: '[1,+INF)' },
];
export function colormapXml(entries = COLORMAP_ENTRIES) {
  const rows = entries
    .map((e) =>
      e.nodata
        ? `<ColorMapEntry rgb="${e.rgb}" transparent="true" nodata="true" ref="${e.ref}"/>`
        : `<ColorMapEntry rgb="${e.rgb}" transparent="false" sourceValue="${e.value}" value="${e.value}" ref="${e.ref}"/>`,
    )
    .join('\n');
  return `<?xml version="1.0"?><ColorMaps><ColorMap><Entries>${rows}</Entries></ColorMap></ColorMaps>`;
}

function crc32(bytes) {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
/** Indexed-colour PNG; `pixel(x, y)` returns the palette index; rows use filter 0 or 2. */
export function palettePng({
  width = 512,
  height = 512,
  palette = COLORMAP_ENTRIES.map((e) => e.rgb),
  pixel = () => 1,
  filter = 0,
} = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 3;
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = filter;
    for (let x = 0; x < width; x++) {
      const value = pixel(x, y);
      const up = y ? pixel(x, y - 1) : 0;
      raw[y * (width + 1) + 1 + x] = filter === 2 ? (value - up) & 255 : value;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('PLTE', Buffer.from(palette.flat())),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const tiles = new Map();
/** One cached synthetic tile per palette index keeps fixture runs fast. */
function uniformTile(index) {
  if (!tiles.has(index)) tiles.set(index, palettePng({ pixel: () => index }));
  return tiles.get(index);
}
const json = (value) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
const text = (value) => new Response(value, { status: 200 });

/**
 * A fixture transport for the whole sheet. `override(url)` may return a
 * Response (or throw) to replace the default for one request.
 */
export function fixtureFetch({
  override = () => null,
  imergIndex = () => 2,
  calls = [],
  clock = CLOCK,
} = {}) {
  return async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    const replaced = await override(url);
    if (replaced) return replaced;
    if (
      url.hostname === 'api.open-meteo.com' &&
      url.pathname.startsWith('/data/')
    )
      return json(metaRaw());
    if (url.hostname === 'api.open-meteo.com')
      return json(
        forecastRaw({
          unsupported:
            url.searchParams.get('models') === 'ecmwf_ifs025'
              ? ['freezing_level_height', 'visibility']
              : [],
          elevation: Number(url.searchParams.get('elevation') || 1446),
          clock,
        }),
      );
    if (url.hostname === 'ensemble-api.open-meteo.com')
      return json(ensembleRaw({ clock }));
    if (url.hostname === 'archive-api.open-meteo.com')
      return json(historicalRaw({ clock }));
    if (url.pathname.includes('/colormaps/')) return text(colormapXml());
    if (url.pathname.endsWith('.xml'))
      return text(
        domainsXml(
          clock === CLOCK
            ? LATEST_IMERG
            : new Date(Math.floor((clock - 6 * HOUR) / (HOUR / 2)) * (HOUR / 2))
                .toISOString()
                .replace('.000Z', 'Z'),
        ),
      );
    if (url.pathname.endsWith('.png'))
      return new Response(uniformTile(imergIndex(url)), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    return new Response('not found', { status: 404 });
  };
}

/** An in-memory ledger for tests that do not assert durable counts. */
export function memoryBudget() {
  const reserved = [];
  return {
    reserved,
    async reserve(units) {
      reserved.push(units);
      return { ok: true };
    },
  };
}

/**
 * A validated sheet payload produced by the real middleware over fixtures.
 * `point` is the checkpoint; `from` an optional UTC hour.
 */
export async function sheetPayload({
  point = { lat: 30.49, lon: 78.04, elevationM: 1987 },
  from = null,
  fixture = {},
  clock = CLOCK,
} = {}) {
  const { createMountainWeatherMiddleware } =
    await import('../../server/providers/mountain-weather/index.js');
  const middleware = createMountainWeatherMiddleware({
    now: () => clock,
    fetchImpl: fixtureFetch({ clock, ...fixture }),
    budget: memoryBudget(),
    gibsBudget: memoryBudget(),
    sleep: async () => {},
  });
  const params = new URLSearchParams({
    lat: String(point.lat),
    lon: String(point.lon),
  });
  if (Number.isFinite(point.elevationM))
    params.set('elev', String(point.elevationM));
  if (from) params.set('from', from);
  const res = {
    setHeader() {},
    end(body) {
      this.body = body;
    },
  };
  await middleware(
    {
      url: `/api/mountain-weather?${params}`,
      method: 'GET',
      headers: { 'sec-fetch-site': 'same-origin', host: 'localhost' },
      socket: { remoteAddress: '127.0.0.1' },
    },
    res,
  );
  if (res.statusCode !== 200) throw new Error(res.body);
  return JSON.parse(res.body);
}
