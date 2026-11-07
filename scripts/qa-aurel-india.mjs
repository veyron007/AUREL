/**
 * AUREL WP8 acceptance: the Indian presets, the Free-only status and the radio
 * priority line. Fresh browser profile; every request off this machine is
 * blocked, so the run uses the offline overview map and needs no network.
 *
 *   QA_BASE_URL=http://127.0.0.1:4188 node scripts/qa-aurel-india.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const output = path.resolve(
  process.env.QA_OUTPUT || 'docs/design/aurel/phase-6/wp8/evidence',
);
fs.mkdirSync(output, { recursive: true });
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:4173';

/** The Indian presets and their first landmark, from src/cityPoisIndia.js. */
const INDIAN_PRESETS = Object.freeze({
  dehradun: { lat: 30.3245, lon: 78.0413 },
  mussoorie: { lat: 30.4597, lon: 78.0773 },
  rishikesh: { lat: 30.1241, lon: 78.3154 },
  delhi: { lat: 28.6129, lon: 77.2295 },
  mumbai: { lat: 18.922, lon: 72.8347 },
  bengaluru: { lat: 12.9791, lon: 77.5913 },
  chennai: { lat: 13.0418, lon: 80.281 },
  kolkata: { lat: 22.5448, lon: 88.3426 },
});
/** A flight has arrived when the camera is this close to the landmark... */
const ARRIVAL_KM = 10;
/** ...and this low, in metres above the ellipsoid. */
const ARRIVAL_HEIGHT_M = 15000;
const FLIGHT_TIMEOUT_MS = 20000;

const browser = await puppeteer.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--no-sandbox'],
});
const results = [];
const errors = [];
const external = new Set();
const check = (name, value, detail) => {
  results.push({ name, pass: Boolean(value), ...(detail && { detail }) });
  console.log(`${value ? 'PASS' : 'FAIL'} ${name}`);
};
const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !['localhost', '127.0.0.1'].includes(url.hostname)
    ) {
      external.add(url.hostname);
      request.abort();
    } else request.continue();
  });

  const open = async (query = '') => {
    await page.goto(
      `${base}/?welcome=0${query}#v=2&lat=20&lon=78&alt=9000000&map=offline-overview&l=`,
      { waitUntil: 'networkidle2', timeout: 60000 },
    );
    await page.waitForFunction(
      () =>
        window.__godsEyeView?.viewer &&
        document
          .querySelector('#loading-screen')
          ?.classList.contains('hidden') &&
        document.querySelectorAll('#location-pills [data-location-id]').length >
          0,
      { timeout: 90000 },
    );
    await settle(1200);
  };
  const openLocationTray = async () => {
    const collapsed = await page.$eval('#location-bar', (el) =>
      el.classList.contains('collapsed'),
    );
    if (collapsed) await page.click('#location-bar-toggle');
    await settle();
  };
  const camera = () =>
    page.evaluate(() => {
      const c = window.__godsEyeView.viewer.camera.positionCartographic;
      return {
        lat: (c.latitude * 180) / Math.PI,
        lon: (c.longitude * 180) / Math.PI,
        height: c.height,
      };
    });
  const distanceKm = (a, b) => {
    const rad = Math.PI / 180;
    const h =
      Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
      Math.cos(a.lat * rad) *
        Math.cos(b.lat * rad) *
        Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  };
  /** Click a preset pill and wait for the camera to arrive near its landmark. */
  const flyTo = async (id) => {
    await page.$eval(`[data-location-id="${id}"]`, (el) => {
      el.scrollIntoView({ block: 'nearest', inline: 'center' });
    });
    await settle(200);
    await page.click(`[data-location-id="${id}"]`);
    const target = INDIAN_PRESETS[id];
    const started = Date.now();
    let last = null;
    while (Date.now() - started < FLIGHT_TIMEOUT_MS) {
      await settle(500);
      last = await camera();
      if (
        distanceKm(last, target) <= ARRIVAL_KM &&
        last.height <= ARRIVAL_HEIGHT_M
      )
        return { arrived: true, camera: last };
    }
    return { arrived: false, camera: last };
  };

  // 1. Desktop, English.
  await page.setViewport({ width: 1440, height: 900 });
  await open();
  await openLocationTray();
  const pills = await page.$$eval(
    '#location-pills [data-location-id]',
    (buttons) =>
      buttons.map((button) => ({
        id: button.dataset.locationId,
        label: button.textContent.trim(),
      })),
  );
  const ids = pills.map(({ id }) => id);
  check(
    'the Location tray lists all eight Indian presets',
    Object.keys(INDIAN_PRESETS).every((id) => ids.includes(id)),
    pills,
  );
  for (const id of ['dehradun', 'mussoorie', 'mumbai']) {
    const flight = await flyTo(id);
    check(`${id} preset flies to its landmark`, flight.arrived, flight.camera);
    if (id === 'dehradun')
      await page.screenshot({
        path: path.join(output, 'dehradun-desktop.png'),
      });
  }
  const landmarks = await page.$$eval('#poi-row .poi-pill-name', (names) =>
    names.map((el) => el.textContent.trim()),
  );
  check(
    'the landmark row shows the Mumbai landmarks',
    landmarks.includes('Gateway of India'),
    landmarks,
  );
  const photorealChip = await page.$eval(
    '[data-stack-id="photoreal"]',
    (el) => el.getAttribute('title') || '',
  );
  check(
    'Google 3D keeps the Free-only policy reason over India',
    /Paused by Free-only/.test(photorealChip),
    photorealChip,
  );

  // 2. Provider Settings: Launch Library paused, radio line read-only.
  await open('&setup=1');
  await page.waitForFunction(
    () =>
      document.querySelector('#key-setup')?.classList.contains('visible') &&
      document.querySelector('[data-key-id="launch-library"]'),
    { timeout: 20000 },
  );
  await settle(600);
  const settings = await page.evaluate(() => ({
    launch:
      document
        .querySelector('[data-key-id="launch-library"] .key-setup-policy')
        ?.textContent.trim() ?? '',
    google:
      document
        .querySelector('[data-key-id="google-maps"] .key-setup-policy')
        ?.textContent.trim() ?? '',
    radio:
      document
        .querySelector('[data-key-id="radio-priority"]')
        ?.textContent.replace(/\s+/g, ' ')
        .trim() ?? '',
    radioInputs: document.querySelectorAll(
      '[data-key-id="radio-priority"] input',
    ).length,
  }));
  check(
    'Launch Library reads as a paused token, not a blocked service',
    /still works without a key/.test(settings.launch) &&
      !/entitlement or cost/.test(settings.launch),
    settings.launch,
  );
  check(
    'Google Maps still reads as blocked',
    /entitlement or cost not verified/.test(settings.google),
    settings.google,
  );
  check(
    'the radio priority line is shown read-only',
    /RADIO_PRIORITY_COUNTRIES/.test(settings.radio) &&
      settings.radioInputs === 0,
    settings.radio,
  );
  await page.evaluate(() =>
    document.querySelector('[data-key-id="radio-priority"]')?.scrollIntoView(),
  );
  await settle();
  await page.screenshot({
    path: path.join(output, 'provider-settings-desktop.png'),
  });

  // 3. Another language: preset names follow the UI language.
  await open('&lang=ru');
  const ruLabel = await page.$eval('[data-location-id="dehradun"]', (el) =>
    el.textContent.trim(),
  );
  check('preset names follow the UI language', ruLabel === 'Дехрадун', ruLabel);

  // 4. Phone. The AUREL phone layout hides the Location tray (body.mobile-shell
  // hides #location-bar and its tab bar is not shown), so the preset flight
  // is driven through the Location controls the tray would call.
  await page.setViewport({ width: 390, height: 844 });
  await open();
  const trayHidden = await page.$eval(
    '#location-bar',
    (el) => getComputedStyle(el).display === 'none',
  );
  check(
    'on a phone the Location tray stays hidden (known AUREL layout limit)',
    trayHidden,
  );
  await page.evaluate(() =>
    window.__godsEyeView.styleManager._locationControls.chooseCity('rishikesh'),
  );
  const target = INDIAN_PRESETS.rishikesh;
  const started = Date.now();
  let phoneCamera = null;
  let phoneArrived = false;
  while (!phoneArrived && Date.now() - started < FLIGHT_TIMEOUT_MS) {
    await settle(500);
    phoneCamera = await camera();
    phoneArrived =
      distanceKm(phoneCamera, target) <= ARRIVAL_KM &&
      phoneCamera.height <= ARRIVAL_HEIGHT_M;
  }
  check('on a phone the Rishikesh preset flies', phoneArrived, phoneCamera);
  await page.screenshot({ path: path.join(output, 'rishikesh-phone.png') });
  check(
    'the phone search field stays reachable',
    await page.$eval('#location-search', (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }),
  );
  check(
    'the phone layout has no horizontal page overflow',
    !(await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    )),
  );

  const policy = await page.evaluate(async () =>
    (await fetch('/api/free-only/status')).json(),
  );
  check(
    'Free-only lists Launch Library as paused, not blocked',
    policy.freeOnly === true &&
      !policy.blockedProviders.includes('launch-library') &&
      policy.pausedCredentials?.includes('launch-library'),
    policy,
  );
  check(
    'no paid browser host attempted',
    ![...external].some((host) =>
      /googleapis|openai|generativelanguage|tomtom|api\.cesium/.test(host),
    ),
    [...external],
  );
  check('no runtime errors', errors.length === 0, errors);
} finally {
  fs.writeFileSync(
    path.join(output, 'checks.json'),
    JSON.stringify({ results, errors, externalHosts: [...external] }, null, 2) +
      '\n',
  );
  await browser.close();
}
assert.ok(
  results.every((result) => result.pass),
  'WP8 browser acceptance failed; see evidence/checks.json',
);
