/** WP3 browser QA: real UI, synthetic labelled fixtures, no live provider or credential use. */
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
import { FORBIDDEN_WORDS } from '../src/planner/checkpointSheet.js';
import { sheetPayload } from '../src/testSupport/mountainWeatherFixtures.mjs';

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:4173';
const output = path.resolve('docs/design/aurel/phase-6/wp3/evidence');
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
        Object.entries(fields).map(([k, [v]]) => [k, times.map(() => v)]),
      ),
    },
    hourly_units: Object.fromEntries(
      Object.entries(fields).map(([k, [, unit]]) => [k, unit]),
    ),
  });
  return {
    version: 1,
    requested: point,
    queried: { lat: +point.lat.toFixed(5), lon: +point.lon.toFixed(5) },
    weather: normalizeFieldProvider(
      raw({
        temperature_2m: [14, '°C'],
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
// GFS runs 3 °C warmer so the sheet shows real disagreement.
const disagreeing = {
  override: async (url) => {
    if (
      url.pathname !== '/v1/forecast' ||
      url.searchParams.get('models') !== 'gfs_seamless'
    )
      return null;
    const { forecastRaw } =
      await import('../src/testSupport/mountainWeatherFixtures.mjs');
    return new Response(
      JSON.stringify(
        forecastRaw({ clock: now, values: { temperature_2m: 7 } }),
      ),
    );
  },
};
const browser = await puppeteer.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--no-sandbox'],
});
const checks = [],
  errors = [],
  requested = [],
  external = [];
const check = (name, pass) => {
  checks.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
};
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    const url = new URL(request.url());
    const respond = (value) =>
      request.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(value),
      });
    if (url.pathname === '/api/mountain-weather') {
      requested.push({
        kind: 'mountain',
        lat: +url.searchParams.get('lat'),
        lon: +url.searchParams.get('lon'),
        elev: url.searchParams.get('elev'),
        from: url.searchParams.get('from'),
      });
      const elev = url.searchParams.get('elev');
      return respond(
        await sheetPayload({
          clock: now,
          point: {
            lat: +url.searchParams.get('lat'),
            lon: +url.searchParams.get('lon'),
            elevationM: elev === null ? null : +elev,
          },
          from: url.searchParams.get('from'),
          fixture: disagreeing,
        }),
      );
    }
    if (url.pathname === '/api/field-context') {
      requested.push({ kind: 'context' });
      return respond(
        context({
          lat: +url.searchParams.get('lat'),
          lon: +url.searchParams.get('lon'),
        }),
      );
    }
    if (url.pathname === '/api/firms/area') {
      const bounds = Object.fromEntries(
        ['west', 'south', 'east', 'north'].map((k) => [
          k,
          +url.searchParams.get(k),
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
      const points = url.searchParams
        .get('points')
        .split(';')
        .map((pair) => pair.split(',').map(Number));
      return respond({
        results: points.map(([lon, lat]) => ({
          elevation: 650 + (lat - 30.3258) * 8000,
          lat,
          lon,
          ellipsoid: 607 + (lat - 30.3258) * 8000,
          geoid: -43,
          provenance: {
            tileset: 'mapterhorn-egm08',
            version: 'fixture',
            retrievedAt: new Date(now).toISOString(),
          },
        })),
      });
    }
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !['localhost', '127.0.0.1'].includes(url.hostname)
    ) {
      external.push(url.hostname);
      return request.abort();
    }
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
      { timeout: 120000 },
    );
    await settle();
  };
  const departure = new Date(now + 19800000 + 3 * 3600000)
    .toISOString()
    .slice(0, 16);
  async function analyze() {
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
        document.querySelector('#planner-save') &&
        !document.querySelector('#planner-save').disabled,
    );
  }
  async function openSheet(index) {
    const selector = `[data-checkpoint-sheet="${index}"]`;
    await page.waitForSelector(selector);
    await page.$eval(selector, (el) => el.scrollIntoView({ block: 'center' }));
    await page.click(selector);
    await page.waitForFunction(
      () => document.querySelector('#planner-panel .checkpoint-sheet'),
      { timeout: 60000 },
    );
    await settle();
  }
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(
    `${base}/?welcome=0#v=2&lat=30.40&lon=78.05&alt=60000&map=offline-overview&l=`,
    { waitUntil: 'domcontentloaded', timeout: 120000 },
  );
  await ready();
  check('mount performs no mountain-weather request', requested.length === 0);

  // Dehradun → Mussoorie → Kempty: the third checkpoint is near Kempty.
  const route = {
    ...createRouteSnapshot(
      {
        mode: 'car',
        distanceM: 31000,
        durationS: 4200,
        geometry: [
          [78.0438, 30.3258],
          [78.0644, 30.4598],
          [78.04, 30.49],
        ],
        steps: [],
      },
      { lat: 30.3258, lon: 78.0438, label: 'QA Dehradun fixture' },
      { lat: 30.49, lon: 78.04, label: 'QA Kempty fixture' },
      now,
    ),
    source: 'QA synthetic route fixture',
  };
  await page.evaluate(async (route) => {
    const app = window.__godsEyeView;
    await app.dataManager.setEnabled('directions', true);
    app.dataManager.layers.get('directions').module.restoreSavedRoute(route);
  }, route);
  await page.click('[data-workspace="plan"]');
  await page.waitForFunction(
    () => document.querySelector('#planner-scope-route')?.disabled === false,
  );
  await page.$eval('label[for="planner-scope-route"]', (l) =>
    l.scrollIntoView({ block: 'center' }),
  );
  await page.click('label[for="planner-scope-route"]');
  await analyze();
  check(
    'route analysis does not fetch mountain weather until asked',
    !requested.some((r) => r.kind === 'mountain'),
  );
  await openSheet(2);
  const mountain = requested.filter((r) => r.kind === 'mountain');
  check(
    'one sheet request at the Kempty checkpoint with its profile height',
    mountain.length === 1 &&
      mountain[0].lat === 30.49 &&
      mountain[0].lon === 78.04 &&
      Number(mountain[0].elev) > 1900 &&
      mountain[0].from?.endsWith(':00:00.000Z'),
  );
  const sheetText = () =>
    page.$eval('#planner-panel .checkpoint-sheet', (el) => el.textContent);
  const text = await sheetText();
  check(
    'three models side by side with run time and lead',
    ['DWD ICON', 'NOAA GFS', 'ECMWF IFS', 'Run (UTC)', 'Lead', '+'].every((s) =>
      text.includes(s),
    ),
  );
  check(
    'model disagreement is shown as spread',
    /Spread/.test(text) && /3 °C/.test(text),
  );
  check(
    'ensemble member count at or above a threshold',
    /\d+ of 51 members at or above 1 mm/.test(text),
  );
  await page.select(
    '#planner-panel .checkpoint-sheet__threshold select',
    '2.5',
  );
  await settle();
  check(
    'changing the threshold recounts members',
    /\d+ of 51 members at or above 2\.5 mm/.test(await sheetText()),
  );
  check(
    'antecedent total names its reanalysis and window',
    /mm in seven IMD days \(ERA5/.test(text),
  );
  check(
    'IMERG is an observed range drawn against IMD categories',
    /Last 24 h: .*mm/.test(text) &&
      (await page.$$('.checkpoint-sheet__imd')).length > 0 &&
      (await page.$('.checkpoint-sheet__lane [data-class="observed"]')) !==
        null,
  );
  check(
    'card states statistical downscaling and the cloudburst limit',
    text.includes('Elevation downscaling is statistical') &&
      text.includes('cannot resolve a cloudburst'),
  );
  check(
    'IMD is named as the warning authority with a link',
    text.includes('IMD remains the warning authority') &&
      (await page.$(
        '.checkpoint-sheet a[href="https://mausam.imd.gov.in/"]',
      )) !== null,
  );
  check(
    'sheet copy has no go/no-go or safety wording',
    !FORBIDDEN_WORDS.test(text),
  );
  await page.$eval('#planner-panel .checkpoint-sheet', (el) =>
    el.scrollIntoView({ block: 'start' }),
  );
  await settle(800);
  await page.screenshot({ path: path.join(output, 'sheet-desktop.png') });
  await page.click('#planner-save');
  await page.waitForFunction(() =>
    document
      .querySelector('#planner-panel')
      ?.textContent.includes('Planning snapshot saved to Fieldbook.'),
  );
  check('snapshot with sheet saves to Fieldbook', true);

  const before = requested.length;
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
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
  await page.waitForFunction(
    () => document.querySelector('#fieldbook-panel .checkpoint-sheet'),
    { timeout: 30000 },
  );
  check(
    'reopened Fieldbook sheet renders from the snapshot without a refetch',
    requested.length === before &&
      (await page.$eval('#fieldbook-panel .checkpoint-sheet', (el) =>
        el.textContent.includes('ECMWF ENS'),
      )),
  );
  await page.screenshot({ path: path.join(output, 'sheet-library.png') });

  // Place flow at Kempty: terrain lookup height, then the Chronicle lane.
  await page.click('[data-workspace="explore"]').catch(() => {});
  await page.focus('#location-search');
  await page.type('#location-search', '30.49, 78.04');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#lens-save-place');
  await page.click('#lens-save-place');
  await settle(800);
  await page.click('[data-workspace="plan"]');
  await settle();
  if (!(await page.$eval('#planner-settings', (d) => d.open)))
    await page.click('#planner-settings > summary');
  await page.$eval('label[for="planner-scope-place"]', (l) =>
    l.scrollIntoView({ block: 'center' }),
  );
  await page.click('label[for="planner-scope-place"]');
  await analyze();
  await openSheet(0);
  const placeRequest = requested.filter((r) => r.kind === 'mountain').at(-1);
  check(
    'place sheet uses a terrain lookup height',
    placeRequest.elev !== null &&
      (await sheetText()).includes('Height from a terrain lookup'),
  );
  await page.click('#planner-save');
  await page.waitForFunction(() =>
    document
      .querySelector('#planner-panel')
      ?.textContent.includes('Planning snapshot saved to Fieldbook.'),
  );
  await page.click('[data-workspace="compare"]');
  await settle(800);
  check(
    'Chronicle precipitation lane lists the saved sheet',
    await page.$eval(
      '[data-lane="precipitation"]',
      (el) =>
        /IMERG 24 h .*observed/.test(el.textContent) &&
        /ERA5 7-day total/.test(el.textContent),
    ),
  );
  await page.screenshot({ path: path.join(output, 'chronicle-lane.png') });

  await page.setViewport({ width: 390, height: 844 });
  await settle();
  await page.click('[data-workspace="plan"]');
  await settle(800);
  await page.$eval('#planner-panel .checkpoint-sheet', (el) =>
    el.scrollIntoView({ block: 'start' }),
  );
  await settle(600);
  check(
    'phone sheet is visible with no horizontal page overflow',
    await page.$eval(
      '#planner-panel .checkpoint-sheet',
      (el) =>
        el.getBoundingClientRect().width > 0 &&
        document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: path.join(output, 'sheet-mobile.png') });
  check(
    'no request left the machine (Free-only, fixtures only)',
    external.every((host) => !/open-meteo|earthdata|nasa/.test(host)),
  );
  check('no browser runtime errors', errors.length === 0);
  fs.writeFileSync(
    path.join(output, 'checks.json'),
    JSON.stringify(
      {
        fixture:
          'Synthetic Open-Meteo, ENS, ERA5 and IMERG payloads built by the real middleware over labelled fixtures; synthetic route heights. External hosts aborted. No live provider or credential use.',
        base,
        checks,
        errors,
        mountainRequests: requested.filter((r) => r.kind === 'mountain'),
        abortedExternalHosts: [...new Set(external)],
      },
      null,
      2,
    ),
  );
  assert.ok(checks.every((row) => row.pass));
} finally {
  await browser.close();
}
