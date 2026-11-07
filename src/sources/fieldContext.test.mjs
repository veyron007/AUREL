import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeFieldProvider,
  validateFieldContextPayload,
  fieldQueryPoint,
} from './fieldContextModel.js';
import { createFieldContextSource } from './fieldContext.js';
const now = Date.parse('2026-11-07T12:00:00Z');
export function fixture(kind = 'weather') {
  const time = Array.from({ length: 48 }, (_, i) =>
    new Date(now + i * 3600000).toISOString().slice(0, 16),
  );
  const hourly =
    kind === 'weather'
      ? {
          time,
          temperature_2m: time.map(() => 20),
          precipitation: time.map(() => 0),
          precipitation_probability: time.map(() => 5),
          wind_speed_10m: time.map(() => 2),
          wind_gusts_10m: time.map(() => 3),
          weather_code: time.map(() => 0),
        }
      : {
          time,
          pm2_5: time.map(() => 12),
          pm10: time.map(() => 20),
          us_aqi: time.map(() => 42),
        };
  const hourly_units =
    kind === 'weather'
      ? {
          temperature_2m: '°C',
          precipitation: 'mm',
          precipitation_probability: '%',
          wind_speed_10m: 'm/s',
          wind_gusts_10m: 'm/s',
          weather_code: 'wmo code',
        }
      : { pm2_5: 'μg/m³', pm10: 'μg/m³', us_aqi: 'USAQI' };
  return {
    latitude: 30.3,
    longitude: 78,
    utc_offset_seconds: 0,
    hourly,
    hourly_units,
  };
}
function payload() {
  return {
    version: 1,
    requested: { lat: 30.3165, lon: 78.0322 },
    queried: { lat: 30.3165, lon: 78.0322 },
    weather: normalizeFieldProvider(fixture(), 'weather', now),
    airQuality: normalizeFieldProvider(
      fixture('airQuality'),
      'airQuality',
      now,
    ),
  };
}
test('source projection preserves UTC, unknown issuance, model cells, units and nulls', () => {
  const raw = fixture();
  raw.hourly.temperature_2m[0] = null;
  raw.hourly.precipitation[1] = -1;
  const out = normalizeFieldProvider(raw, 'weather', now);
  assert.equal(out.hours.length, 48);
  assert.equal(out.hours[0].temperatureC, null);
  assert.equal(out.hours[1].precipitationMm, null);
  assert.equal(out.hours[0].time, '2026-11-07T12:00:00.000Z');
  assert.equal(out.issuedAt, null);
  assert.equal(out.kind, 'forecast');
  assert.deepEqual(out.grid, { lat: 30.3, lon: 78 });
  assert.equal(out.resolutionM, null);
  assert.equal(out.units.windSpeedMps, 'm/s');
  assert.equal(
    normalizeFieldProvider(fixture('airQuality'), 'airQuality', now)
      .resolutionM,
    45000,
  );
  assert.deepEqual(validateFieldContextPayload(payload()), payload());
  assert.deepEqual(fieldQueryPoint({ lat: 30.316567, lon: 78.032267 }), {
    lat: 30.31657,
    lon: 78.03227,
  });
});
test('malformed, offset, duplicate, unbounded or impossible provider data cannot become evidence', () => {
  for (const mutate of [
    (p) => p.hourly.time.push('2026-11-10T00:00'),
    (p) => (p.hourly.time[1] = p.hourly.time[0]),
    (p) => (p.utc_offset_seconds = 3600),
    (p) => (p.latitude = 91),
    (p) => (p.hourly.time[0] = 'bad'),
  ]) {
    const raw = fixture();
    mutate(raw);
    assert.throws(() => normalizeFieldProvider(raw, 'weather', now));
  }
  const bad = payload();
  bad.weather.sourceId = 'paid';
  assert.throws(() => validateFieldContextPayload(bad));
  assert.throws(() => fieldQueryPoint({ lat: '30', lon: 78 }));
});
test('client requests only local context and validates returned requested coordinates', async () => {
  let url;
  const source = createFieldContextSource({
    fetchImpl: async (u) => {
      url = u;
      return new Response(JSON.stringify(payload()));
    },
  });
  assert.deepEqual(
    await source.getContext({ lat: 30.3165, lon: 78.0322 }),
    payload(),
  );
  assert.match(url, /^\/api\/field-context\?/);
  assert.ok(!url.includes('key'));
  await assert.rejects(() => source.getContext({ lat: 31, lon: 78 }));
  const denied = createFieldContextSource({
    fetchImpl: async () => new Response('{}', { status: 429 }),
  });
  await assert.rejects(() => denied.getContext({ lat: 30, lon: 78 }));
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(() =>
    source.getContext({ lat: 30, lon: 78 }, { signal: aborted.signal }),
  );
});

test('wire validation accepts reordered unit keys and rejects contradictory availability/timing', () => {
  const reordered = payload();
  reordered.weather.units = Object.fromEntries(
    Object.entries(reordered.weather.units).reverse(),
  );
  assert.deepEqual(validateFieldContextPayload(reordered), payload());
  for (const change of [
    (p) => (p.version = 2),
    (p) => (p.queried.lat = 1),
    (p) => (p.weather.validTo = p.weather.validFrom),
    (p) => (p.weather.state = 'unavailable'),
    (p) => (p.weather.hours[0].time = '2026-02-30T00:00:00.000Z'),
    (p) => (p.weather.hours[0].windSpeedMps = '2'),
    (p) => (p.weather.reason = 'secret-text'),
    (p) => (p.airQuality.units.pm25 = 'ppm'),
  ]) {
    const p = payload();
    change(p);
    assert.throws(() => validateFieldContextPayload(p));
  }
  const raw = fixture();
  for (const key of Object.keys(raw.hourly))
    if (key !== 'time') raw.hourly[key].fill(null);
  assert.throws(() => normalizeFieldProvider(raw, 'weather', now));
  const wrong = fixture();
  wrong.hourly_units.wind_speed_10m = 'km/h';
  assert.throws(() => normalizeFieldProvider(wrong, 'weather', now));
});

test('client bodies and transports are bounded even if abort is ignored', async () => {
  const timeout = createFieldContextSource({
    fetchImpl: () => new Promise(() => {}),
    timeoutMs: 5,
  });
  await assert.rejects(() => timeout.getContext({ lat: 30, lon: 78 }), {
    name: 'TimeoutError',
  });
  const oversized = createFieldContextSource({
    fetchImpl: async () => new Response('x'.repeat(140000)),
  });
  await assert.rejects(() => oversized.getContext({ lat: 30, lon: 78 }));
});

test('client accepts the explicit fetch injection alias without touching global transport', async () => {
  const source = createFieldContextSource({
    fetch: async () => new Response(JSON.stringify(payload())),
  });
  assert.deepEqual(
    await source.getContext({ lat: 30.3165, lon: 78.0322 }),
    payload(),
  );
});
