/**
 * Fixed, keyless upstreams for Raindrop:
 *  - NASA GIBS `IMERG_Precipitation_Rate_30min` tiles and colormap, read
 *    numerically through the published colormap (no Earthdata login);
 *  - Open-Meteo forecast (hourly precipitation) at up to three points;
 *  - Open-Meteo Flood API (GloFAS v4 `river_discharge`, 91 past + 7 forecast days).
 * No caller-supplied URL, variable or host reaches any request.
 */
import zlib from 'node:zlib';
import {
  readResponseBytesCapped,
  readResponseJsonCapped,
  readResponseTextCapped,
} from '../common/http.js';
import {
  GIBS_IMERG,
  decodePalettePng,
  gibsPixel,
  gibsTileUrl,
  latestFromDomains,
  parseColormap,
  rateAt,
  stepTimes,
} from '../../../src/hydro/imerg.js';

const USER_AGENT = 'AUREL-personal-raindrop/1.0';
const TILE_MAX_BYTES = 512 * 1024;
const COLORMAP_MAX_BYTES = 256 * 1024;
const JSON_MAX_BYTES = 256 * 1024;
const TILE_CACHE_MAX = 192;
const DOMAIN_TTL_MS = 10 * 60_000;
const COLORMAP_TTL_MS = 24 * 3600_000;
/** Recent half-hours can be replaced as Early becomes Late; keep tiles six hours. */
const TILE_TTL_MS = 6 * 3600_000;
/** Open-Meteo weights: one unit per location for ≤ 14 days and ≤ 10 variables. */
export const FORECAST_UNITS_PER_POINT = 1;
/** 98 days of one daily variable: 98 / 14 = 7 weighted units. */
export const GLOFAS_UNITS = 7;
export const GLOFAS_PAST_DAYS = 91;
export const GLOFAS_FORECAST_DAYS = 7;

const iso = (ms) => new Date(ms).toISOString().slice(0, 19) + 'Z';

export function createHydroUpstreams({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = Date.now,
  inflate = (bytes) => zlib.inflateSync(bytes),
} = {}) {
  let colormap = null,
    domain = null;
  const tiles = new Map();
  const get = (url, signal, accept) =>
    fetchImpl(url, {
      signal,
      redirect: 'error',
      headers: { Accept: accept, 'User-Agent': USER_AGENT },
    });

  async function lookup(signal) {
    if (colormap && now() - colormap.at < COLORMAP_TTL_MS)
      return colormap.value;
    const response = await get(GIBS_IMERG.colormap, signal, 'application/xml');
    if (!response.ok) throw upstream('colormap', response.status);
    const xml = await readResponseTextCapped(
      response,
      COLORMAP_MAX_BYTES,
      signal,
    );
    colormap = { at: now(), value: parseColormap(xml) };
    return colormap.value;
  }

  async function latest(signal) {
    if (domain && now() - domain.at < DOMAIN_TTL_MS) return domain.value;
    const range = `${iso(now() - 3 * 86400_000)}--${iso(now() + 3600_000)}`;
    const url = `${GIBS_IMERG.tileBase}/1.0.0/${GIBS_IMERG.layer}/default/${GIBS_IMERG.matrixSet}/all/${range}.xml`;
    const response = await get(url, signal, 'application/xml');
    if (!response.ok) throw upstream('domains', response.status);
    const value = latestFromDomains(
      await readResponseTextCapped(response, 64 * 1024, signal),
    );
    if (!value) throw upstream('domains', 'empty');
    domain = { at: now(), value };
    return value;
  }

  async function tile(time, address, signal) {
    const key = `${time}/${address.row}/${address.col}`;
    const cached = tiles.get(key);
    if (cached && now() - cached.at < TILE_TTL_MS) return cached.value;
    const response = await get(gibsTileUrl(time, address), signal, 'image/png');
    let value = null;
    if (response.ok) {
      const bytes = await readResponseBytesCapped(
        response,
        TILE_MAX_BYTES,
        signal,
      );
      value = decodePalettePng(bytes, inflate);
    } else if (response.status !== 404) throw upstream('tile', response.status);
    else await response.body?.cancel().catch(() => {});
    tiles.delete(key);
    tiles.set(key, { at: now(), value });
    while (tiles.size > TILE_CACHE_MAX) tiles.delete(tiles.keys().next().value);
    return value;
  }

  /**
   * Rate intervals for each requested IMERG cell centre at each half-hour of
   * the window, newest first. A step whose tile is unpublished is marked so.
   */
  async function imerg(cells, steps, signal) {
    const [table, newest] = await Promise.all([lookup(signal), latest(signal)]);
    const rows = [];
    for (const time of stepTimes(newest, steps)) {
      const values = {};
      let published = true;
      for (const { key, center } of cells) {
        const address = gibsPixel(center[0], center[1]);
        const decoded = await tile(time, address, signal);
        if (!decoded) {
          published = false;
          values[key] = null;
          continue;
        }
        values[key] = rateAt(decoded, table, address.px, address.py) ?? null;
      }
      rows.push({ time, published, values });
    }
    return { latest: newest, steps: rows, retrievedAt: iso(now()) };
  }

  async function forecast(points, signal) {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({
      latitude: points.map((p) => p.lat).join(','),
      longitude: points.map((p) => p.lon).join(','),
      hourly: 'precipitation',
      forecast_hours: '48',
      timezone: 'GMT',
    }).toString();
    const response = await get(url.href, signal, 'application/json');
    if (!response.ok) throw upstream('forecast', response.status);
    const body = await readResponseJsonCapped(response, JSON_MAX_BYTES, signal);
    const list = Array.isArray(body) ? body : [body];
    if (list.length !== points.length) throw upstream('forecast', 'shape');
    return {
      retrievedAt: iso(now()),
      points: list.map((entry, index) =>
        normalizeForecast(entry, points[index]),
      ),
    };
  }

  async function glofas(point, signal) {
    const url = new URL('https://flood-api.open-meteo.com/v1/flood');
    url.search = new URLSearchParams({
      latitude: String(point.lat),
      longitude: String(point.lon),
      daily: 'river_discharge',
      past_days: String(GLOFAS_PAST_DAYS),
      forecast_days: String(GLOFAS_FORECAST_DAYS),
      timezone: 'GMT',
    }).toString();
    const response = await get(url.href, signal, 'application/json');
    if (!response.ok) throw upstream('glofas', response.status);
    const body = await readResponseJsonCapped(response, JSON_MAX_BYTES, signal);
    const time = body?.daily?.time,
      values = body?.daily?.river_discharge;
    if (
      !Array.isArray(time) ||
      !Array.isArray(values) ||
      time.length !== values.length ||
      time.length > 400 ||
      !Number.isFinite(body.latitude) ||
      !Number.isFinite(body.longitude)
    )
      throw upstream('glofas', 'shape');
    return {
      retrievedAt: iso(now()),
      requested: point,
      cell: { lat: body.latitude, lon: body.longitude },
      time: time.map(String),
      values: values.map((v) => (Number.isFinite(v) ? v : null)),
    };
  }

  return { imerg, forecast, glofas };
}

function normalizeForecast(entry, requested) {
  const time = entry?.hourly?.time,
    values = entry?.hourly?.precipitation;
  if (
    !Array.isArray(time) ||
    !Array.isArray(values) ||
    time.length !== values.length ||
    time.length > 72 ||
    entry?.hourly_units?.precipitation !== 'mm'
  )
    throw upstream('forecast', 'shape');
  return {
    requested,
    grid: { lat: entry.latitude, lon: entry.longitude },
    elevationM: Number.isFinite(entry.elevation) ? entry.elevation : null,
    unit: 'mm',
    time: time.map((t) => `${t}:00Z`),
    precipitation: values.map((v) => (Number.isFinite(v) ? v : null)),
  };
}

function upstream(stage, status) {
  return Object.assign(new Error(`${stage} ${status}`), {
    code: status === 429 ? 'rate-limited' : 'upstream-unavailable',
  });
}
