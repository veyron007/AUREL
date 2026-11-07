/** Actual UI with explicit synthetic source fixtures; never uses saved credentials. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { normalizeFieldProvider } from '../src/sources/fieldContextModel.js';
import {
  emptyFirmsArea,
  FIRMS_AREA_SOURCES,
} from '../src/sources/firmsArea.js';
import { createRouteSnapshot } from '../src/layers/directions/snapshot.js';
const output = path.resolve('docs/design/aurel/phase-3/evidence');
fs.mkdirSync(output, { recursive: true });
const now = Date.now();
const hour = Math.floor(now / 3600000) * 3600000;
const times = Array.from({ length: 48 }, (_, i) =>
  new Date(hour + i * 3600000).toISOString().slice(0, 16),
);
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
      raw({ pm2_5: [22, 'μg/m³'], pm10: [35, 'μg/m³'], us_aqi: [72, 'USAQI'] }),
      'airQuality',
      now,
    ),
  };
}
const browser = await puppeteer.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--no-sandbox'],
});
const checks = [],
  errors = [],
  requested = [];
const check = (name, pass) => {
  checks.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 400));
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(45000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    const respond = (value) =>
      request.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(value),
      });
    if (url.pathname === '/api/field-context') {
      requested.push('context');
      return respond(
        context({
          lat: +url.searchParams.get('lat'),
          lon: +url.searchParams.get('lon'),
        }),
      );
    }
    if (url.pathname === '/api/firms/area') {
      requested.push('fires');
      const bounds = Object.fromEntries(
        ['west', 'south', 'east', 'north'].map((key) => [
          key,
          +url.searchParams.get(key),
        ]),
      );
      return respond({
        ...emptyFirmsArea(bounds, now),
        status: 'ok',
        fetchedAt: now,
        sources: FIRMS_AREA_SOURCES.map((id) => ({
          id,
          status: 'ok',
          count: 0,
        })),
      });
    }
    if (url.pathname === '/api/terrain/heights') {
      if (url.searchParams.has('provenance')) requested.push('terrain');
      const points = url.searchParams
        .get('points')
        .split(';')
        .map((pair) => pair.split(',').map(Number));
      return respond({
        results: points.map(([lon, lat], index) =>
          url.searchParams.has('provenance') && index === 2
            ? null
            : {
                elevation: 650 + (lat - 30.32) * 9000,
                lat,
                lon,
                ellipsoid: 607 + (lat - 30.32) * 9000,
                geoid: -43,
                provenance: {
                  tileset: 'mapterhorn-egm08',
                  version: 'fixture',
                  retrievedAt: new Date(now).toISOString(),
                },
              },
        ),
      });
    }
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !['localhost', '127.0.0.1'].includes(url.hostname)
    )
      return request.abort();
    request.continue();
  });
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
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(
    'http://127.0.0.1:4173/?welcome=0#v=2&lat=30.3258&lon=78.0438&alt=1800000&map=offline-overview&l=',
    { waitUntil: 'domcontentloaded', timeout: 90000 },
  );
  await ready();
  check(
    'mount performs no field context or profile requests',
    requested.length === 0,
  );
  await page.focus('#location-search');
  await page.type('#location-search', '30.3258, 78.0438');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#lens-save-place');
  await page.click('[data-workspace="plan"]');
  await settle();
  check(
    'Plan defaults to the selected place',
    await page.$eval('#planner-scope-place', (el) => el.checked),
  );
  const departure = new Date(now + 19800000).toISOString().slice(0, 16);
  await page.$eval(
    '#planner-departure',
    (el, value) => {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    departure,
  );
  await page.click('#planner-analyze');
  await page.waitForFunction(
    () =>
      !document.querySelector('#planner-save')?.disabled &&
      document.querySelector('#planner-save'),
  );
  check(
    'selected-place analysis uses one context request and no route profile',
    requested.filter((v) => v === 'context').length === 1 &&
      !requested.includes('terrain'),
  );
  check(
    'forecast and AQ retain explicit model labels',
    await page.$eval(
      '#planner-panel',
      (el) =>
        el.textContent.includes('CAMS') && el.textContent.includes('US AQI'),
    ),
  );
  await page.click('#planner-save');
  await settle();
  const route = {
    ...createRouteSnapshot(
      {
        mode: 'car',
        distanceM: 23000,
        durationS: 3000,
        geometry: [
          [78.0438, 30.3258],
          [78.05, 30.38],
          [78.0644, 30.4598],
        ],
        steps: [],
      },
      { lat: 30.3258, lon: 78.0438, label: 'QA Dehradun fixture' },
      { lat: 30.4598, lon: 78.0644, label: 'QA Mussoorie fixture' },
      now,
    ),
    source: 'QA synthetic route fixture',
  };
  await page.evaluate(async (route) => {
    const app = window.__godsEyeView;
    await app.dataManager.setEnabled('directions', true);
    app.dataManager.layers.get('directions').module.restoreSavedRoute(route);
  }, route);
  await page.waitForFunction(
    () => document.querySelector('#planner-scope-route')?.disabled === false,
  );
  // A completed analysis intentionally collapses its settings. Reopen through
  // the same disclosure a user uses before choosing a different planning scope.
  if (!(await page.$eval('#planner-settings', (details) => details.open))) {
    await page.$eval('#planner-settings > summary', (summary) =>
      summary.scrollIntoView({ block: 'center' }),
    );
    await page.click('#planner-settings > summary');
    await page.waitForFunction(
      () => document.querySelector('#planner-settings')?.open,
    );
  }
  await page.$eval('label[for="planner-scope-route"]', (label) =>
    label.scrollIntoView({ block: 'center' }),
  );
  await page.click('label[for="planner-scope-route"]');
  await page.waitForFunction(
    () => document.querySelector('#planner-scope-route')?.checked === true,
  );
  await page.click('#planner-analyze');
  await page.waitForFunction(
    () => !document.querySelector('#planner-save')?.disabled,
  );
  check(
    'route uses at most two terrain batches and three context checkpoints',
    requested.filter((v) => v === 'terrain').length <= 2 &&
      requested.filter((v) => v === 'context').length === 4,
  );
  check(
    'profile shows its datum and incomplete data',
    await page.$eval(
      '#planner-panel',
      (el) =>
        el.textContent.includes('EGM2008') &&
        /missing|gaps|partial/i.test(el.textContent),
    ),
  );
  await page.click('#reset-globe-view');
  await new Promise((resolve) => setTimeout(resolve, 1800));
  await page.screenshot({ path: path.join(output, 'planner-desktop.png') });
  await page.click('#planner-save');
  await settle();
  await page.click('[data-workspace="library"]');
  await settle();
  check(
    'saved field snapshot appears in Library',
    await page.$eval(
      '#fieldbook-panel',
      (el) =>
        el.textContent.includes('Saved analyses') &&
        el.textContent.includes('Saved'),
    ),
  );
  const routeBeforePause = await page.evaluate(() =>
    JSON.stringify(
      window.__godsEyeView.dataManager.layers
        .get('directions')
        .module.getRouteSnapshot(),
    ),
  );
  await page.click('[data-pause-feeds]');
  await page.waitForFunction(() =>
    document
      .querySelector('.workspace-session-status')
      ?.textContent.includes('Feeds paused'),
  );
  check(
    'Pause feeds preserves the current unsaved route',
    await page.evaluate(
      (expected) =>
        JSON.stringify(
          window.__godsEyeView.dataManager.layers
            .get('directions')
            .module.getRouteSnapshot(),
        ) === expected,
      routeBeforePause,
    ),
  );
  const before = requested.length;
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
  await ready();
  await page.click('[data-workspace="library"]');
  await settle();
  await page.click('.fieldbook-project-list button');
  await settle();
  await page.evaluate(() =>
    [...document.querySelectorAll('#fieldbook-panel details')].forEach(
      (el) => (el.open = true),
    ),
  );
  check(
    'reopened historical snapshots do not refresh providers',
    requested.length === before,
  );
  check(
    'historical analysis retains source units and forecast context',
    await page.$eval(
      '#fieldbook-panel',
      (el) =>
        el.textContent.includes('EGM2008') && el.textContent.includes('CAMS'),
    ),
  );
  await page.screenshot({ path: path.join(output, 'analysis-library.png') });
  await page.setViewport({ width: 390, height: 844 });
  await settle();
  await page.click('[data-workspace="plan"]');
  await settle();
  check(
    'phone Planner is visible with no horizontal overflow',
    await page.$eval(
      '#planner-panel',
      (el) =>
        getComputedStyle(el).display !== 'none' &&
        document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: path.join(output, 'planner-mobile.png') });
  check('no browser runtime errors', errors.length === 0);
  fs.writeFileSync(
    path.join(output, 'checks.json'),
    JSON.stringify(
      {
        fixture:
          'Synthetic forecasts, thermal empty-result and route heights. No live provider or credential use.',
        checks,
        errors,
        requested,
      },
      null,
      2,
    ),
  );
  assert.ok(checks.every((row) => row.pass));
} finally {
  await browser.close();
}
