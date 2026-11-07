// i18n-ignore-file: browser QA script with labelled fixtures
/**
 * Kshitij horizon QA on the actual UI. Fresh browser profile; every external
 * request is aborted; `/api/horizon/terrain` is served from a labelled
 * synthetic DEM fixture (a Doon-like ridge and a summit on Bandarpunch I's
 * bearing), so no DEM host, credential or paid service is touched. The bundled
 * peaks pack is read from the local server.
 *
 *   QA_PORT=4173 [QA_HOST=localhost] node scripts/qa-aurel-horizon.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { syntheticPayload } from '../src/horizon/testFixtures.mjs';
import { bearingDeg, distanceM } from '../src/horizon/geodesy.js';

const PORT = Number(process.env.QA_PORT || 4173);
const HOST = process.env.QA_HOST || 'localhost';
const output = path.resolve('docs/design/aurel/phase-6/wp1/evidence');
fs.mkdirSync(output, { recursive: true });
const PIN = { lat: 30.4597, lon: 78.1058 };
const BANDARPUNCH = { lat: 31.0035014, lon: 78.5531283 };
const summitAz = bearingDeg(PIN, BANDARPUNCH),
  summitD = distanceM(PIN, BANDARPUNCH);
const fixture = syntheticPayload({
  ...PIN,
  groundM: 2000,
  radiusKm: 200,
  height: (az, d) => {
    if (Math.abs(az - summitAz) <= 0.5 && Math.abs(d - summitD) < 600) return 6200;
    // A Mussoorie-like ridge to the east-south-east, 2.3 km away.
    if (az >= 80 && az <= 140 && Math.abs(d - 2300) < 40) return 2210;
    return 1200;
  },
});
fixture.source = {
  ...fixture.source,
  label: 'QA synthetic DEM fixture (not Copernicus data)',
  attribution: 'QA fixture: synthetic heights for browser verification',
};

const browser = await puppeteer.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--no-sandbox'],
});
const checks = [],
  errors = [],
  requested = [],
  blocked = [];
const check = (name, pass) => {
  checks.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
};
const measurements = {};
const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/horizon/terrain') {
      requested.push(url.search);
      return request.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixture),
      });
    }
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !['localhost', '127.0.0.1'].includes(url.hostname)
    ) {
      blocked.push(url.hostname);
      return request.abort();
    }
    request.continue();
  });
  const ready = async () => {
    await page.waitForFunction(
      () =>
        window.__godsEyeView &&
        document.querySelector('#loading-screen')?.classList.contains('hidden') &&
        getComputedStyle(document.querySelector('#loading-screen')).opacity === '0',
      { timeout: 120000 },
    );
    await settle();
  };
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(
    `http://${HOST}:${PORT}/?welcome=0#v=2&lat=${PIN.lat}&lon=${PIN.lon}&alt=400000&map=offline-overview&l=`,
    { waitUntil: 'domcontentloaded', timeout: 120000 },
  );
  await ready();
  check('mount performs no horizon request', requested.length === 0);
  await page.focus('#location-search');
  await page.type('#location-search', `${PIN.lat}, ${PIN.lon}`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#lens-save-place');
  await page.click('[data-workspace="plan"]');
  await settle();
  await page.waitForSelector('#horizon-planner-compute');
  check('selecting a place computes nothing by itself', requested.length === 0);
  const set = (selector, value) =>
    page.$eval(
      selector,
      (el, next) => {
        el.value = next;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      },
      value,
    );
  await set('#horizon-planner-date', '2026-12-21');
  await set('#horizon-planner-time', '12:30');
  await page.$eval('#horizon-planner-compute', (el) =>
    el.scrollIntoView({ block: 'center' }),
  );
  await page.click('#horizon-planner-compute');
  await page.waitForSelector('#horizon-planner-save', { timeout: 90000 });
  check(
    'one bounded terrain request for the pin',
    requested.length === 1 &&
      requested[0] === `?lat=${PIN.lat}&lon=${PIN.lon}&radiusKm=200`,
  );
  const text = await page.$eval('#planner-panel', (el) => el.textContent);
  check('labelled geometric visibility, terrain-only', text.includes('Geometric visibility, terrain-only'));
  check(
    'sunrise card shows astronomical against terrain-clearing time',
    text.includes('Astronomical sunrise (flat horizon)') &&
      text.includes('Sun clears the terrain') &&
      /\d+ min later/.test(text),
  );
  check('shadow card for the chosen time', /Shadow at/.test(text) && text.includes('Shadow of a 1 m gnomon'));
  check(
    'peaks list names the summit with azimuth, distance, DEM and OSM ele',
    text.includes('Bandarpunch I') && /az 35°/.test(text) && text.includes('OSM ele 6,316 m'),
  );
  check(
    'DEM source, void count and refraction are shown',
    text.includes('QA synthetic DEM fixture') &&
      text.includes('DEM void samples') &&
      text.includes('k = 0.13'),
  );
  check('no guaranteed-view wording', !/guarantee/i.test(text));
  check(
    'horizon ring and peak labels are drawn on the globe',
    await page.evaluate(() => {
      const source = window.__godsEyeView.viewer.dataSources.getByName('kshitij-horizon')[0];
      return Boolean(
        source?.entities.getById('kshitij-horizon-ring') &&
          source.entities.values.some((entity) => entity.label),
      );
    }),
  );
  await page.$eval('#horizon-planner-title', (el) => el.scrollIntoView({ block: 'start' }));
  await settle(1500);
  await page.screenshot({ path: path.join(output, 'horizon-desktop.png') });
  await page.$eval('#planner-panel .horizon-peaks', (el) => el.scrollIntoView({ block: 'start' }));
  await settle(600);
  await page.screenshot({ path: path.join(output, 'horizon-desktop-peaks.png') });
  await page.click('#horizon-planner-save');
  await page.waitForFunction(() =>
    document.querySelector('.horizon-card [role="status"]')?.textContent.includes('Fieldbook'),
  );
  await page.click('[data-workspace="library"]');
  await settle();
  await page.evaluate(() =>
    [...document.querySelectorAll('#fieldbook-panel details')].forEach((el) => (el.open = true)),
  );
  check(
    'Fieldbook keeps a horizon analysis snapshot',
    await page.$eval(
      '#fieldbook-panel',
      (el) => el.textContent.includes('Peaks on the horizon') && el.textContent.includes('Sun clears the terrain'),
    ),
  );
  await page.setViewport({ width: 390, height: 844 });
  await settle();
  await page.click('[data-workspace="plan"]');
  await settle();
  await page.$eval('#horizon-planner-title', (el) => el.scrollIntoView({ block: 'start' }));
  await settle(800);
  const phone = await page.$eval('#horizon-planner-title', (title) => {
    const card = title.closest('.horizon-card');
    const box = card.getBoundingClientRect();
    const wide = [...card.querySelectorAll('*')]
      .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName}.${el.className}`);
    return {
      width: box.width,
      right: box.right,
      innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      wide,
    };
  });
  measurements.phone = phone;
  check(
    'phone horizon card is visible with no horizontal overflow',
    phone.width > 0 &&
      phone.right <= phone.innerWidth + 1 &&
      phone.wide.length === 0 &&
      phone.scrollWidth <= phone.innerWidth,
  );
  await page.screenshot({ path: path.join(output, 'horizon-mobile.png') });
  check('no browser runtime errors', errors.length === 0);
  check(
    'the DEM host was never contacted (terrain came from the fixture)',
    !blocked.includes('copernicus-dem-30m.s3.amazonaws.com') &&
      requested.length === 1,
  );
  fs.writeFileSync(
    path.join(output, 'checks.json'),
    JSON.stringify(
      {
        fixture:
          'Synthetic DEM (labelled) served for /api/horizon/terrain; bundled OSM peaks pack from the local server. No DEM host, credential or paid provider contacted.',
        viewports: ['1440x900', '390x844'],
        checks,
        measurements,
        errors,
        requested,
        blockedHosts: [...new Set(blocked)].sort(),
      },
      null,
      2,
    ),
  );
  assert.ok(checks.every((row) => row.pass));
} finally {
  await browser.close();
}
