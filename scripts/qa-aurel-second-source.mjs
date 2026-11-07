/**
 * AUREL WP7 Second Source acceptance.
 *
 * Fresh browser profile; every external host is blocked. The USGS feed, the
 * FIRMS proxy and the /api/second-source routes are answered by LABELLED
 * fixtures built from bounded live samples recorded on 2026-11-07
 * (server/providers/second-source/fixtures/). Quakes and fires are selected
 * through the real click path; the aircraft through the awareness event the
 * flights layer publishes.
 *
 *   QA_BASE_URL=http://127.0.0.1:4173 node scripts/qa-aurel-second-source.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { parseEmscEvents } from '../server/providers/second-source/emsc.js';
import { parseAircraftV2 } from '../server/providers/second-source/aircraft.js';

const FIXTURE_LABEL = 'AUREL QA fixture (recorded bounded sample)';
const output = path.resolve(
  process.env.QA_OUTPUT || 'docs/design/aurel/phase-6/wp7/evidence',
);
fs.mkdirSync(output, { recursive: true });
const fixture = (name) =>
  fs.readFileSync(
    new URL(
      `../server/providers/second-source/fixtures/${name}`,
      import.meta.url,
    ),
    'utf8',
  );
const envelope = (sourceId, parsed) => ({
  sourceId,
  state: parsed.records.length ? 'ok' : 'empty',
  retrievedAt: Date.now(),
  records: parsed.records,
  dropped: 0,
  truncated: false,
  reason: null,
  cache: 'fixture',
  fixture: FIXTURE_LABEL,
});

const USGS_FEED = {
  type: 'FeatureCollection',
  metadata: { title: FIXTURE_LABEL },
  features: [
    {
      type: 'Feature',
      id: 'us6000u1f1',
      properties: {
        mag: 4.4,
        place: '9 km NNE of Uttarkāshi, India',
        time: Date.parse('2026-10-10T14:37:31.202Z'),
      },
      geometry: { type: 'Point', coordinates: [78.4864, 30.8109, 20.964] },
    },
    {
      type: 'Feature',
      id: 'us7000twg9',
      properties: {
        mag: 6.1,
        place: 'off the east coast of Honshu, Japan',
        time: Date.parse('2026-11-06T10:39:27.869Z'),
      },
      geometry: { type: 'Point', coordinates: [142.1175, 34.9677, 29] },
    },
  ],
};
const QUAKE_ANSWER = {
  kind: 'quake',
  sources: {
    emsc: envelope(
      'emsc',
      parseEmscEvents(fixture('emsc-uttarkashi-2026-10-10.json')),
    ),
    geofon: envelope('geofon', { records: [] }),
  },
};
const AIRCRAFT_ANSWER = {
  kind: 'aircraft',
  sources: {
    'adsb-fi': envelope(
      'adsb-fi',
      parseAircraftV2(fixture('adsbfi-hex-8014f9.json'), { hex: '8014f9' }),
    ),
    'adsb-lol': envelope(
      'adsb-lol',
      parseAircraftV2(fixture('adsblol-hex-8014f9.json'), { hex: '8014f9' }),
    ),
  },
};
// Two detections 500 m apart near Dehradun: VIIRS NOAA-20 and MODIS Aqua,
// twenty minutes apart. Times are relative to now so the 24 h window holds.
const fireAt = new Date(Date.now() - 2 * 3_600_000);
const modisAt = new Date(fireAt.getTime() + 20 * 60_000);
const hhmm = (date) =>
  `${String(date.getUTCHours()).padStart(2, '0')}${String(date.getUTCMinutes()).padStart(2, '0')}`;
const FIRMS_PAYLOAD = {
  fixture: FIXTURE_LABEL,
  fetchedAt: Date.now(),
  stale: false,
  ttlMs: 1_800_000,
  sources: [
    { source: 'VIIRS_NOAA20_NRT', count: 1, ok: true },
    { source: 'MODIS_NRT', count: 1, ok: true },
  ],
  count: 2,
  fires: [
    {
      lat: 30.2,
      lon: 78.1,
      frp: 14.2,
      confidence: 'n',
      brightness: 330,
      daynight: 'D',
      acqDate: fireAt.toISOString().slice(0, 10),
      acqTime: hhmm(fireAt),
      satellite: 'N20',
      instrument: 'VIIRS',
    },
    {
      lat: 30.2045,
      lon: 78.1,
      frp: 31.5,
      confidence: 72,
      brightness: 318,
      daynight: 'D',
      acqDate: modisAt.toISOString().slice(0, 10),
      acqTime: hhmm(modisAt),
      satellite: 'Aqua',
      instrument: 'MODIS',
    },
  ],
};

const browser = await puppeteer.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--no-sandbox'],
});
const results = [];
const errors = [];
const external = new Set();
const routeCalls = [];
let quakeOutage = false;
const check = (name, value, detail) => {
  results.push({ name, pass: Boolean(value), ...(detail && { detail }) });
  console.log(`${value ? 'PASS' : 'FAIL'} ${name}`);
};
const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(45000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    const respond = (value, status = 200) =>
      request.respond({
        status,
        contentType: 'application/json',
        // The USGS fixture answers a cross-origin request.
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(value),
      });
    if (url.hostname === 'earthquake.usgs.gov') return respond(USGS_FEED);
    if (url.pathname === '/api/firms') return respond(FIRMS_PAYLOAD);
    if (url.pathname === '/api/second-source/quake') {
      routeCalls.push(`quake ${url.search}`);
      if (quakeOutage) return respond({ error: 'fixture outage' }, 502);
      return respond(QUAKE_ANSWER);
    }
    if (url.pathname === '/api/second-source/aircraft') {
      routeCalls.push(`aircraft ${url.search}`);
      return respond(AIRCRAFT_ANSWER);
    }
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !['localhost', '127.0.0.1'].includes(url.hostname)
    ) {
      external.add(url.hostname);
      return request.abort();
    }
    request.continue();
  });
  await page.setViewport({ width: 1440, height: 900 });
  const base = process.env.QA_BASE_URL || 'http://127.0.0.1:4173';
  await page.goto(
    `${base}/?welcome=0#v=2&lat=30.3258&lon=78.0438&alt=1800000&map=offline-overview&l=`,
    { waitUntil: 'networkidle2', timeout: 60000 },
  );
  await page.waitForFunction(
    () =>
      window.__godsEyeView &&
      document.querySelector('#loading-screen')?.classList.contains('hidden') &&
      getComputedStyle(document.querySelector('#loading-screen')).opacity ===
        '0',
    { timeout: 90000 },
  );
  await settle();

  /** Look straight down at a point and return its page position. */
  const lookAt = (lat, lon, height) =>
    page.evaluate(
      async ({ lat, lon, height }) => {
        const { viewer } = window.__godsEyeView;
        const ellipsoid = viewer.scene.globe.ellipsoid;
        const rad = Math.PI / 180;
        viewer.camera.setView({
          destination: ellipsoid.cartographicToCartesian({
            longitude: lon * rad,
            latitude: lat * rad,
            height,
          }),
        });
        window.__godsEyeView.requestRender?.();
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const point = viewer.scene.cartesianToCanvasCoordinates(
          ellipsoid.cartographicToCartesian({
            longitude: lon * rad,
            latitude: lat * rad,
            height: 0,
          }),
        );
        const box = viewer.scene.canvas.getBoundingClientRect();
        return point ? { x: box.left + point.x, y: box.top + point.y } : null;
      },
      { lat, lon, height },
    );
  const openEvidence = async () => {
    await page.waitForSelector('#lens-tab-evidence', { visible: true });
    await page.click('#lens-tab-evidence');
    await settle();
  };
  const showCard = async () => {
    await page.$eval('.corroboration', (el) =>
      el.scrollIntoView({ block: 'start' }),
    );
    await settle();
  };
  const cardText = () =>
    page.$eval('.corroboration', (el) => el.innerText).catch(() => '');
  const waitForCard = (text) =>
    page
      .waitForFunction(
        (text) =>
          document.querySelector('.corroboration')?.innerText.includes(text),
        { timeout: 20000 },
        text,
      )
      .then(() => true)
      .catch(() => false);

  // ── Quake: USGS event corroborated by EMSC ──────────────────────────────
  await page.evaluate(() =>
    window.__godsEyeView.dataManager.setEnabled('earthquakes', true),
  );
  await page.waitForFunction(
    () =>
      window.__godsEyeView.dataManager.layers
        .get('earthquakes')
        ?.module.getStats().count === 2,
    { timeout: 30000 },
  );
  const quakePoint = await lookAt(30.8109, 78.4864, 350_000);
  // The disc is about 75 px across at this height; the magnitude label's
  // leader can sit on its centre, so try a few points inside the disc.
  let clicked = false;
  for (const [dx, dy] of [
    [0, 20],
    [20, 20],
    [-20, 20],
    [0, 0],
  ]) {
    await page.mouse.click(quakePoint.x + dx, quakePoint.y + dy);
    clicked = await page
      .waitForFunction(
        () =>
          window.__gevContextStore?.selectedEntityId ===
          'earthquake:us6000u1f1',
        { timeout: 3000 },
      )
      .then(() => true)
      .catch(() => false);
    if (clicked) break;
  }
  check('clicking an earthquake disc selects it for Lens', clicked);
  await openEvidence();
  check(
    'quake card reports agreement within tolerance',
    await waitForCard('Sources agree within tolerance'),
  );
  const quakeText = await cardText();
  check(
    'quake card shows EMSC deltas in magnitude, time and position with units',
    /Magnitude difference\s*-0\.2/.test(quakeText) &&
      /Time offset\s*-1\.2 s/.test(quakeText) &&
      /Position residual\s*10\.2 km/.test(quakeText),
    quakeText,
  );
  check(
    'every residual names class, source pair and applicable time',
    quakeText.includes('Derived · EMSC − USGS · 2026-10-10 14:37:31 UTC'),
  );
  check(
    'standard wording: disagreement normal and agreement not truth',
    quakeText.includes('Disagreement between sources is normal') &&
      quakeText.includes('Agreement is not proof'),
  );
  check(
    'dependency note and author are shown',
    quakeText.includes('Shared inputs') &&
      quakeText.includes('Solution authored by NDI'),
  );
  check(
    'GEOFON empty answer reads as no record, not agreement',
    /GFZ GEOFON\s*No record/.test(quakeText),
  );
  check(
    'no automated verified badge',
    !/\bverified\b/i.test(quakeText) && !/\bconfirmed\b/i.test(quakeText),
  );
  await page.$eval('.corroboration', (el) =>
    el.scrollIntoView({ block: 'start' }),
  );
  await settle();
  await page.screenshot({ path: path.join(output, 'quake-card-desktop.png') });
  await page.setViewport({ width: 390, height: 844 });
  await settle(900);
  await page.$eval('.corroboration', (el) =>
    el.scrollIntoView({ block: 'start' }),
  );
  await settle();
  const fits = await page.evaluate(() => {
    const card = document
      .querySelector('.corroboration')
      .getBoundingClientRect();
    return (
      card.right <= window.innerWidth + 1 &&
      document.documentElement.scrollWidth <= window.innerWidth + 1
    );
  });
  check('quake card fits a 390 px phone without horizontal scroll', fits);
  await page.screenshot({ path: path.join(output, 'quake-card-phone.png') });
  await page.setViewport({ width: 1440, height: 900 });
  await settle(900);

  // ── Outage of the second source ─────────────────────────────────────────
  quakeOutage = true;
  await page.evaluate(() =>
    [...document.querySelectorAll('.corroboration button')]
      .find((button) => button.textContent.includes('Check again'))
      ?.click(),
  );
  check(
    'route outage reads as second source unavailable',
    await waitForCard('Second source unavailable'),
  );
  quakeOutage = false;

  // ── Fire: VIIRS NOAA-20 and MODIS, two sensors ──────────────────────────
  await page.evaluate(() =>
    window.__godsEyeView.dataManager.setEnabled('local-firms', true),
  );
  await page.waitForFunction(
    () =>
      window.__godsEyeView.dataManager.layers
        .get('local-firms')
        ?.module.getStats().count >= 2,
    { timeout: 30000 },
  );
  const firePoint = await lookAt(30.2, 78.1, 12_000);
  await page.mouse.click(firePoint.x, firePoint.y);
  await settle(800);
  await openEvidence();
  const fireOk = await waitForCard('Two sensors detect this fire');
  check(
    'fire card reads two sensors for VIIRS NOAA-20 and MODIS',
    fireOk,
    await cardText(),
  );
  if (fireOk) {
    await showCard();
    await page.screenshot({ path: path.join(output, 'fire-card-desktop.png') });
  }
  await page.evaluate(() =>
    window.__godsEyeView.dataManager.setEnabled('local-firms', false),
  );

  // ── Aircraft: adsb.fi against adsb.lol ──────────────────────────────────
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('gev:awareness-subject-selected', {
        detail: {
          layerId: 'flights',
          id: '8014f9',
          label: 'VT-ECG',
          latitude: 30.329,
          longitude: 77.075,
        },
      }),
    ),
  );
  await openEvidence();
  check(
    'aircraft card compares adsb.fi with adsb.lol',
    await waitForCard('adsb.fi'),
  );
  const aircraftText = await cardText();
  check(
    'aircraft card says aggregators may share volunteer receivers',
    aircraftText.includes('may share volunteer receivers') &&
      aircraftText.includes('Independent sources here: between 1 and 2'),
    aircraftText,
  );
  check(
    'aircraft card attributes adsb.fi with a link',
    await page
      .$eval('.corroboration a[href="https://adsb.fi/"]', () => true)
      .catch(() => false),
  );
  await showCard();
  await page.screenshot({
    path: path.join(output, 'aircraft-card-desktop.png'),
  });

  check(
    'routes are asked once per selection plus explicit checks',
    routeCalls.filter((call) => call.startsWith('quake')).length === 2 &&
      routeCalls.filter((call) => call.startsWith('aircraft')).length === 1,
    routeCalls,
  );
  const policy = await page.evaluate(async () =>
    (await fetch('/api/free-only/status')).json(),
  );
  check('Free-only remains active', policy.freeOnly === true);
  check(
    'no paid browser host attempted',
    ![...external].some((host) =>
      /googleapis|openai|generativelanguage|tomtom|api\.cesium/.test(host),
    ),
    [...external],
  );
  check(
    'the browser never contacts EMSC, GEOFON or the aggregators directly',
    ![...external].some((host) =>
      /seismicportal|geofon|adsb\.fi|adsb\.lol/.test(host),
    ),
    [...external],
  );
  check('no runtime errors', errors.length === 0, errors);
} finally {
  fs.writeFileSync(
    path.join(output, 'checks.json'),
    JSON.stringify(
      {
        fixture: FIXTURE_LABEL,
        results,
        errors,
        externalHosts: [...external],
        routeCalls,
      },
      null,
      2,
    ) + '\n',
  );
  await browser.close();
}
assert.ok(
  results.every((result) => result.pass),
  'Second Source browser acceptance failed; see evidence/checks.json',
);
