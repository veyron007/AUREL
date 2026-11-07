import { admitSameSiteKeyless } from '../common/same-site.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import {
  FORECAST_MODELS,
  FORECAST_FIELDS,
  FORECAST_DAYS,
  ENSEMBLE_MODEL,
  ANTECEDENT_DATASETS,
  SHEET_WINDOW_HOURS,
  SOURCES,
  emptyPart,
  imdDayStart,
  mountainQueryPoint,
  validateMountainWeatherPayload,
} from '../../../src/sources/mountainWeatherModel.js';
import { createAcquirer, createSourceCache } from './acquire.js';
import {
  createMountainWeatherBudget,
  createGibsBudget,
  META_DECI_UNITS,
} from './budget.js';
import {
  WEIGHTS,
  HISTORICAL_DAYS,
  forecastUrl,
  ensembleUrl,
  historicalUrl,
  metaUrl,
  normalizeForecastModel,
  normalizeEnsemble,
  normalizeHistorical,
  normalizeRunMeta,
  imdWindows,
  sumAccumulated,
  isoDay,
  antecedentWindows,
} from './openMeteo.js';
import { createImergSource } from './imerg.js';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const MAX_JSON = 512 * 1024;
const TTL = {
  forecast: { ttlMs: 60 * 60000, staleMs: 6 * HOUR },
  ensemble: { ttlMs: 3 * HOUR, staleMs: 6 * HOUR },
  historical: { ttlMs: 12 * HOUR, staleMs: 48 * HOUR },
  meta: { ttlMs: 5 * 60000, staleMs: 0 },
};
const FIELD_NAMES = Object.keys(FORECAST_FIELDS);
const iso = (ms) => new Date(ms).toISOString();

export function parseMountainQuery(url, clock) {
  if (url.search.length > 256) throw new Error('query');
  for (const key of url.searchParams.keys())
    if (
      !['lat', 'lon', 'elev', 'from'].includes(key) ||
      url.searchParams.getAll(key).length !== 1
    )
      throw new Error('query');
  const number = (key, optional = false) => {
    const raw = url.searchParams.get(key);
    if (raw === null && optional) return null;
    if (!raw || !/^-?\d{1,4}(?:\.\d{1,17})?$/.test(raw))
      throw new Error('query');
    return Number(raw);
  };
  const requested = {
    lat: number('lat'),
    lon: number('lon'),
    elevationM: number('elev', true),
  };
  const queried = mountainQueryPoint(requested);
  const rawFrom = url.searchParams.get('from');
  const from =
    rawFrom === null ? Math.floor(clock / HOUR) * HOUR : Date.parse(rawFrom);
  if (
    rawFrom !== null &&
    (!/^\d{4}-\d\d-\d\dT\d\d:00:00(?:\.000)?Z$/.test(rawFrom) ||
      !Number.isFinite(from))
  )
    throw new Error('query');
  if (
    rawFrom !== null &&
    new Date(from).toISOString().slice(0, 13) !== rawFrom.slice(0, 13)
  )
    throw new Error('query');
  if (!fromCovered(from, clock)) throw new Error('query');
  return { requested, queried, from };
}
/**
 * The forecast request covers today 00 UTC plus FORECAST_DAYS; a 24 h window of
 * hour-ending sums must fit inside it.
 */
export function fromCovered(from, clock) {
  const today = Math.floor(clock / DAY) * DAY;
  return from >= today && from + DAY < today + FORECAST_DAYS * DAY;
}

function projectForecastModel(spec, result, window) {
  if (!result)
    return emptyPart('forecast').models.find((m) => m.id === spec.id);
  const data = result.value;
  const index = new Map(data.times.map((at, i) => [at, i]));
  const hours = [];
  for (let at = window.from; at < window.to; at += HOUR) {
    const i = index.get(at);
    if (i === undefined) continue;
    hours.push({
      time: iso(at),
      ...Object.fromEntries(FIELD_NAMES.map((n) => [n, data.columns[n][i]])),
    });
  }
  const first = imdDayStart(window.from);
  const precipitation = imdWindows(
    data.times,
    data.columns.precipitationMm,
    first,
    FORECAST_DAYS,
  );
  const snowfall = imdWindows(
    data.times,
    data.columns.snowfallCm,
    first,
    FORECAST_DAYS,
  );
  const days = precipitation
    .map((row, i) => ({
      ...isoDay(row.start),
      precipitationMm: row.sum,
      snowfallCm: data.unsupported.includes('snowfallCm')
        ? null
        : snowfall[i].sum,
    }))
    .filter((d) => d.precipitationMm !== null || d.snowfallCm !== null);
  return {
    id: spec.id,
    model: spec.model,
    label: spec.label,
    resolutionKm: spec.resolutionKm,
    state: 'ready',
    runAt: data.runAt ?? null,
    grid: data.grid,
    elevationM: data.elevationM,
    unsupported: [...data.unsupported],
    next24h: {
      precipitationMm: sumAccumulated(
        data.times,
        data.columns.precipitationMm,
        window.from,
        window.to,
      ),
      snowfallCm: data.unsupported.includes('snowfallCm')
        ? null
        : sumAccumulated(
            data.times,
            data.columns.snowfallCm,
            window.from,
            window.to,
          ),
    },
    hours,
    days: trimDays(days),
  };
}
function trimDays(days) {
  const out = [];
  for (const day of days) {
    if (
      out.length &&
      Date.parse(day.start) - Date.parse(out.at(-1).start) !== DAY
    )
      break;
    out.push(day);
  }
  return out;
}
function partState(results, failures) {
  if (!results.length) {
    const blocked = failures.find((f) => f?.state === 'blocked');
    return {
      state: blocked ? 'blocked' : 'unavailable',
      reason:
        (blocked || failures.find(Boolean))?.reason || 'upstream-unavailable',
    };
  }
  const stale = results.find((r) => r.stale);
  if (stale) return { state: 'stale', reason: stale.reason };
  const failure = failures.find(Boolean);
  if (failure) return { state: 'partial', reason: failure.reason };
  return { state: 'ready', reason: null };
}
const earliest = (results) =>
  iso(Math.min(...results.map((r) => r.retrievedAt)));

function forecastPart(settled, window) {
  const results = settled.map((s) =>
    s.status === 'fulfilled' ? s.value : null,
  );
  const failures = settled.map((s) =>
    s.status === 'rejected' ? s.reason : null,
  );
  const models = FORECAST_MODELS.map((spec, i) =>
    projectForecastModel(spec, results[i], window),
  );
  const used = results.filter(Boolean);
  let { state, reason } = partState(used, failures);
  if (state === 'ready' && models.some((m) => m.state === 'ready' && !m.runAt))
    state = 'partial';
  if (used.length && models.every((m) => !m.hours.length)) {
    state = 'empty';
    reason = 'no-data';
  }
  return {
    ...SOURCES.forecast,
    state,
    reason,
    retrievedAt: used.length ? earliest(used) : null,
    models,
  };
}
function ensemblePart(settled, window) {
  if (settled.status === 'rejected')
    return emptyPart(
      'ensemble',
      settled.reason?.state || 'unavailable',
      settled.reason?.reason || 'upstream-unavailable',
    );
  const result = settled.value,
    data = result.value;
  const first = imdDayStart(window.from);
  const perMember = data.members.map((values) =>
    imdWindows(data.times, values, first, FORECAST_DAYS),
  );
  const days = trimDays(
    perMember[0]
      .map((row, day) => ({
        ...isoDay(row.start),
        members: perMember.map((m) => m[day].sum),
      }))
      .filter((d) => d.members.some((v) => v !== null)),
  );
  const { state, reason } = partState([result], []);
  return {
    ...SOURCES.ensemble,
    state: !days.length
      ? 'empty'
      : state === 'ready' && !data.runAt
        ? 'partial'
        : state,
    reason: !days.length ? 'no-data' : reason,
    retrievedAt: iso(result.retrievedAt),
    model: ENSEMBLE_MODEL.model,
    label: ENSEMBLE_MODEL.label,
    resolutionKm: ENSEMBLE_MODEL.resolutionKm,
    runAt: data.runAt ?? null,
    grid: data.grid,
    memberCount: data.members.length,
    days,
  };
}
function antecedentPart(settled, clock) {
  if (settled.status === 'rejected')
    return emptyPart(
      'antecedent',
      settled.reason?.state || 'unavailable',
      settled.reason?.reason || 'upstream-unavailable',
    );
  const result = settled.value;
  const first =
    imdDayStart(Math.floor(clock / DAY) * DAY - HISTORICAL_DAYS * DAY) + DAY;
  const best = antecedentWindows(result.value, first, HISTORICAL_DAYS);
  if (!best)
    return {
      ...emptyPart('antecedent', 'empty', 'no-data'),
      retrievedAt: iso(result.retrievedAt),
      grid: result.value.grid,
    };
  const days = best.days.map((row) => ({
    ...isoDay(row.start),
    precipitationMm: row.sum,
  }));
  const complete = days.length === 7;
  const { state, reason } = partState([result], []);
  return {
    ...SOURCES.antecedent,
    state: complete ? state : 'partial',
    reason: complete ? reason : 'no-data',
    retrievedAt: iso(result.retrievedAt),
    dataset: best.dataset,
    resolutionKm: ANTECEDENT_DATASETS[best.dataset].resolutionKm,
    grid: result.value.grid,
    days,
    totalMm: complete
      ? Math.round(days.reduce((s, d) => s + d.precipitationMm, 0) * 100) / 100
      : null,
  };
}

/** Fixed, keyless capability; no hosts, variables or models come from the client. */
export function createMountainWeatherMiddleware({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = Date.now,
  budget = createMountainWeatherBudget({ now }),
  gibsBudget = createGibsBudget({ now }),
  timeoutMs = 9000,
  sleep,
} = {}) {
  const acquire = createAcquirer({ fetchImpl, now, budget, timeoutMs, sleep });
  const acquireGibs = createAcquirer({
    fetchImpl,
    now,
    budget: gibsBudget,
    timeoutMs,
    sleep,
    accept: '*/*',
  });
  const cache = createSourceCache({ now, max: 96 });
  const readImerg = createImergSource({ acquire: acquireGibs, now });
  const admit = makeRateLimiter({ windowMs: 60000, max: 6, globalMax: 12 });
  const cell = (q) => `${q.lat},${q.lon}@${q.elevationM ?? 'dem'}`;
  const json = async (url, units, normalize) =>
    normalize(await acquire({ url, units, maxBytes: MAX_JSON }));
  // Run metadata is read right after the data it labels (at most 5 min old)
  // and stored with that data, so cached values never borrow a newer run.
  const run = (name) =>
    cache(`meta:${name}`, TTL.meta, () =>
      json(metaUrl(name), META_DECI_UNITS, normalizeRunMeta),
    ).then(
      (entry) => entry.value,
      () => null,
    );
  const withRun = (name, load) => async () => ({
    ...(await load()),
    runAt: await run(name),
  });

  async function sheet(query) {
    const { queried } = query;
    const window = {
      from: query.from,
      to: query.from + SHEET_WINDOW_HOURS * HOUR,
    };
    const forecasts = Promise.allSettled(
      FORECAST_MODELS.map((spec) =>
        cache(
          `forecast:${spec.id}:${cell(queried)}`,
          TTL.forecast,
          withRun(spec.meta, () =>
            json(
              forecastUrl(queried, spec),
              WEIGHTS.forecastModel,
              normalizeForecastModel,
            ),
          ),
        ),
      ),
    );
    const ensemble = cache(
      `ensemble:${cell(queried)}`,
      TTL.ensemble,
      withRun(ENSEMBLE_MODEL.meta, () =>
        json(ensembleUrl(queried), WEIGHTS.ensemble, normalizeEnsemble),
      ),
    );
    const clock = now();
    const historical = cache(
      `historical:${cell(queried)}:${iso(clock).slice(0, 10)}`,
      TTL.historical,
      () =>
        json(
          historicalUrl(queried, clock),
          WEIGHTS.historical,
          normalizeHistorical,
        ),
    );
    const [forecastSettled, ensembleSettled, historicalSettled, imerg] =
      await Promise.all([
        forecasts,
        ensemble.then(
          (value) => ({ status: 'fulfilled', value }),
          (reason) => ({ status: 'rejected', reason }),
        ),
        historical.then(
          (value) => ({ status: 'fulfilled', value }),
          (reason) => ({ status: 'rejected', reason }),
        ),
        readImerg(queried),
      ]);
    return validateMountainWeatherPayload({
      version: 1,
      requested: query.requested,
      queried,
      window: { from: iso(window.from), to: iso(window.to) },
      forecast: forecastPart(forecastSettled, window),
      ensemble: ensemblePart(ensembleSettled, window),
      antecedent: antecedentPart(historicalSettled, clock),
      imerg,
    });
  }

  return async function mountainWeatherMiddleware(req, res, next = () => {}) {
    let url;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      return next();
    }
    if (url.pathname !== '/api/mountain-weather') return next();
    const respond = (status, value) => {
      if (res.destroyed || res.writableEnded) return;
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(value));
    };
    if (admitSameSiteKeyless(req, res)) return;
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return respond(405, { error: 'Method not allowed' });
    }
    let query;
    try {
      query = parseMountainQuery(url, now());
    } catch {
      return respond(400, {
        error:
          'Expected latitude, longitude, optional elevation in metres and an optional UTC hour within the forecast range',
      });
    }
    if (!admit(clientKey(req))) {
      res.setHeader('Retry-After', '60');
      return respond(429, { error: 'Mountain weather request limit reached' });
    }
    try {
      respond(200, await sheet(query));
    } catch {
      respond(502, { error: 'Mountain weather could not be assembled' });
    }
  };
}

export function mountainWeatherProxy(options = {}) {
  const install = (server) => {
    server.middlewares.use(createMountainWeatherMiddleware(options));
  };
  return {
    name: 'mountain-weather',
    configureServer: install,
    configurePreviewServer: install,
  };
}
