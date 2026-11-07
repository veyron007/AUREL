/** Breath in the real UI with labelled synthetic fixtures; never uses saved credentials. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { normalizeFieldProvider } from '../src/sources/fieldContextModel.js';
import { breathPayload } from '../src/testSupport/airQualityFixtures.mjs';

const origin = process.env.QA_ORIGIN || 'http://127.0.0.1:4173';
const output = path.resolve('docs/design/aurel/phase-6/wp2/evidence');
fs.mkdirSync(output, { recursive: true });
const now = Date.now();
const hour = Math.floor(now / 3600000) * 3600000;
const times = Array.from({ length: 48 }, (_, i) =>
  new Date(hour + i * 3600000).toISOString().slice(0, 16),
);

/** Synthetic CAMS context, shaped exactly like /api/field-context. */
function context(point) {
  const raw = (fields) => ({
    latitude: point.lat + 0.005,
    longitude: point.lon + 0.005,
    utc_offset_seconds: 0,
    hourly: {
      time: times,
      ...Object.fromEntries(
        Object.entries(fields).map(([key, [value]]) => [
          key,
          times.map(() => value),
        ]),
      ),
    },
    hourly_units: Object.fromEntries(
      Object.entries(fields).map(([key, [, unit]]) => [key, unit]),
    ),
  });
  return {
    version: 1,
    requested: point,
    queried: { lat: +point.lat.toFixed(5), lon: +point.lon.toFixed(5) },
    weather: normalizeFieldProvider(
      raw({
        temperature_2m: [18, '°C'],
        precipitation: [0.2, 'mm'],
        precipitation_probability: [20, '%'],
        wind_speed_10m: [2, 'm/s'],
        wind_gusts_10m: [4, 'm/s'],
        weather_code: [2, 'wmo code'],
      }),
      'weather',
      now,
    ),
    airQuality: normalizeFieldProvider(
      raw({
        pm2_5: [41, 'μg/m³'],
        pm10: [70, 'μg/m³'],
        us_aqi: [115, 'USAQI'],
      }),
      'airQuality',
      now,
    ),
  };
}

const browser = await puppeteer.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--no-sandbox'],
});
const checks = [];
const errors = [];
const requested = [];
const external = [];
let stationState = 'ok';
const check = (name, pass) => {
  checks.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
};
const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));

function intercept(request) {
  const url = new URL(request.url());
  const respond = (value) =>
    request.respond({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(value),
    });
  const point = () => ({
    lat: +url.searchParams.get('lat'),
    lon: +url.searchParams.get('lon'),
  });
  if (url.pathname === '/api/air-quality/near') {
    requested.push(`near:${stationState}`);
    return respond(
      breathPayload({
        now,
        point: point(),
        state: stationState,
        citizenState: stationState === 'ok' ? 'ok' : 'no-sensor',
      }),
    );
  }
  if (url.pathname === '/api/field-context') {
    requested.push('context');
    return respond(context(point()));
  }
  if (
    ['http:', 'https:'].includes(url.protocol) &&
    !['localhost', '127.0.0.1'].includes(url.hostname)
  ) {
    external.push(url.hostname);
    return request.abort();
  }
  return request.continue();
}

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(45000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', intercept);
  const ready = async () => {
    await page.waitForFunction(
      () =>
        window.__godsEyeView &&
        document
          .querySelector('#loading-screen')
          ?.classList.contains('hidden') &&
        getComputedStyle(document.querySelector('#loading-screen')).opacity ===
          '0',
      { timeout: 90000 },
    );
    await settle();
  };
  const select = async (query) => {
    await page.click('#location-search', { clickCount: 3 });
    await page.type('#location-search', query);
    await page.keyboard.press('Enter');
    await page.waitForSelector('#breath-check');
    await page.$eval('#breath-check', (el) =>
      el.scrollIntoView({ block: 'center' }),
    );
    await settle();
  };
  const text = (selector) =>
    page.$eval(selector, (el) => el.textContent.replace(/\s+/g, ' '));

  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(
    `${origin}/?welcome=0#v=2&lat=30.3165&lon=78.0322&alt=1800000&map=offline-overview&l=`,
    { waitUntil: 'domcontentloaded', timeout: 90000 },
  );
  await ready();
  check('mount performs no air-quality requests', requested.length === 0);
  await select('30.3165, 78.0322');
  check(
    'selecting a place does not request air until asked',
    requested.length === 0,
  );
  await page.click('#breath-check');
  await page.waitForSelector('#breath-indices');
  check(
    'one station request and one CAMS request per check',
    requested.join(',') === 'near:ok,context',
  );
  const stations = await text('#breath-stations');
  check(
    'station rows carry pollutant, unit, measurement time and observed class',
    /PM2\.5/.test(stations) &&
      /µg\/m³/.test(stations) &&
      /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(stations) &&
      /Observed/.test(stations),
  );
  const indices = await text('#breath-indices');
  check(
    'NAQI states its 24 h basis and is labelled derived',
    /NAQI \(India\)/.test(indices) &&
      /24 h means \(8 h for CO and O3\) ending/.test(indices) &&
      /Derived/.test(indices),
  );
  check('US AQI is shown separately', /US AQI/.test(indices));
  check(
    'citizen sensors are labelled uncalibrated',
    /uncalibrated/i.test(await text('#breath-citizen')),
  );
  const model = await text('#breath-model');
  check(
    'CAMS stays a separate modelled card',
    /CAMS model \(not a measurement\)/.test(model) &&
      /Modelled/.test(model) &&
      !/Fixture monitor/.test(model),
  );
  check(
    'four separate tiers render',
    (await page.$$('.breath-tier')).length === 4,
  );
  await page.$eval('#breath-stations', (el) =>
    el.scrollIntoView({ block: 'start' }),
  );
  await settle(1200);
  await page.screenshot({ path: path.join(output, 'breath-desktop.png') });
  await page.$eval('#breath-indices', (el) =>
    el.scrollIntoView({ block: 'start' }),
  );
  await settle(600);
  await page.screenshot({
    path: path.join(output, 'breath-desktop-indices.png'),
  });

  const beforeWatch = requested.length;
  await page.select('#breath-watch-category', 'poor');
  await page.click('#breath-watch-save');
  await page.waitForFunction(() =>
    document
      .querySelector('.breath-card')
      ?.textContent.includes('Station watch saved'),
  );
  await settle(800);
  check(
    'a station watch appears in Watch areas',
    await page.$eval('#watchlist-panel', (el) =>
      el.textContent.includes('OpenAQ station'),
    ),
  );
  check(
    'saving a watch starts no monitoring and no provider request',
    requested.length === beforeWatch,
  );

  stationState = 'no-monitor';
  await select('30.1, 78.3');
  check(
    'a new selection clears the previous readings',
    (await page.$('#breath-stations')) === null,
  );
  await page.click('#breath-check');
  await page.waitForSelector('#breath-stations [data-state="no-monitor"]');
  const empty = await text('#breath-stations');
  check(
    'no station reads "no monitor", never clean',
    /No monitor within 25 km/.test(empty) &&
      /does not mean the air is clean/.test(empty) &&
      (await page.$('#breath-indices')) === null,
  );
  await page.$eval('#breath-stations', (el) =>
    el.scrollIntoView({ block: 'start' }),
  );
  await settle(600);
  await page.screenshot({ path: path.join(output, 'breath-no-monitor.png') });

  await page.setViewport({ width: 390, height: 844 });
  await settle(1000);
  stationState = 'ok';
  await page.$eval('#breath-check', (el) =>
    el.scrollIntoView({ block: 'start' }),
  );
  await page.click('#breath-check');
  await page.waitForSelector('#breath-indices');
  await settle(800);
  check(
    'phone Breath card is visible with no horizontal overflow',
    await page.$eval(
      '.breath-card',
      (el) =>
        el.getBoundingClientRect().width > 0 &&
        el.getBoundingClientRect().right <= innerWidth + 1 &&
        document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.$eval('#breath-stations', (el) =>
    el.scrollIntoView({ block: 'start' }),
  );
  await settle(600);
  await page.screenshot({ path: path.join(output, 'breath-mobile.png') });
  check(
    'no request reached OpenAQ, data.gov.in or sensor.community',
    !external.some((host) =>
      /openaq|data\.gov\.in|sensor\.community/.test(host),
    ),
  );
  check('no browser runtime errors', errors.length === 0);
  fs.writeFileSync(
    path.join(output, 'checks.json'),
    JSON.stringify(
      {
        fixture:
          'Synthetic station, citizen and CAMS payloads (src/testSupport/airQualityFixtures.mjs). No live provider or credential use.',
        origin,
        checks,
        errors,
        requested,
        blockedExternalHosts: [...new Set(external)].sort(),
      },
      null,
      2,
    ),
  );
  assert.ok(checks.every((row) => row.pass));
} finally {
  await browser.close();
}
