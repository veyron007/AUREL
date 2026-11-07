/**
 * Orbit Witness browser acceptance. Fresh profile; every Orbit Witness route
 * is served by labelled fixtures (real TLE sets from 2026-11-07, a synthetic
 * catalogue answer, a synthetic cloud forecast, a synthetic ESA-schema plan);
 * every other external request is blocked and recorded.
 * Usage: node scripts/qa-aurel-orbit-witness.mjs [base-url]  (default http://127.0.0.1:4173)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';
import {
  FIXTURE_TLE,
  MUSSOORIE,
  syntheticPlan,
  boxAround,
} from '../src/orbitWitness/testFixtures.mjs';

const base = process.argv[2] || process.env.QA_BASE || 'http://127.0.0.1:4173';
const output = path.resolve('docs/design/aurel/phase-6/wp4/evidence');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aurel-orbit-qa-'));
const planDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurel-orbit-plan-'));
const today = new Date().toISOString().slice(0, 10);
const day = (offset) =>
  new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86400000)
    .toISOString()
    .slice(0, 10);
// A synthetic plan in ESA's schema covering the next ten days over Mussoorie.
const planName = `S2A_MP_ACQ__KML_${day(-4).replace(/-/g, '')}T150000_${day(10).replace(/-/g, '')}T180000.kml`;
const planFile = path.join(planDir, planName);
fs.writeFileSync(
  planFile,
  syntheticPlan(
    Array.from({ length: 15 }, (_, i) => ({
      id: `QA-${i}`,
      start: `${day(i - 4)}T05:20:00.000`,
      end: `${day(i - 4)}T05:55:00.000`,
      ring: boxAround(MUSSOORIE, 1.5),
    })),
  ),
);
const catalogue = (url) => ({
  version: 1,
  retrievedAt: new Date().toISOString(),
  sources: [
    { id: 'earth-search', status: 'ok', count: 1, truncated: false },
    { id: 'cmr-stac-lpcloud', status: 'ok', count: 0, truncated: false },
  ],
  scenes: [
    {
      id: `QA-SYNTHETIC-S2_${url.searchParams.get('to')}`,
      collection: 'sentinel-2-l2a',
      source: 'earth-search',
      platform: 'sentinel-2b',
      datetime: `${url.searchParams.get('from')}T05:40:30.000Z`,
      cloudCover: 7,
      productId: null,
      footprint: boxAround(MUSSOORIE, 0.5),
    },
  ],
});
const cloud = () => ({
  version: 1,
  status: 'ok',
  retrievedAt: new Date().toISOString(),
  model: 'best_match',
  hours: Array.from({ length: 14 * 24 }, (_, i) => ({
    time: new Date(
      Date.parse(`${today}T00:00:00Z`) + i * 3600000,
    ).toISOString(),
    cloudCoverPct: (i * 7) % 100,
  })),
});

const browser = await puppeteer.launch({
  headless: true,
  userDataDir: profile,
  args: ['--use-angle=metal', '--enable-gpu', '--no-sandbox'],
});
const checks = [],
  errors = [],
  requests = [],
  blocked = new Set();
const check = (name, pass) => {
  checks.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
};
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = new URL(req.url());
    const json = (value) =>
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(value),
      });
    if (u.pathname === '/api/celestrak/active') {
      requests.push('tle');
      return req.respond({
        status: 200,
        contentType: 'text/plain',
        body: FIXTURE_TLE,
      });
    }
    if (u.pathname === '/api/orbit-witness/scenes') {
      requests.push('scenes');
      return json(catalogue(u));
    }
    if (u.pathname === '/api/orbit-witness/cloud') {
      requests.push('cloud');
      return json(cloud());
    }
    if (
      ['http:', 'https:'].includes(u.protocol) &&
      !['127.0.0.1', 'localhost'].includes(u.hostname)
    ) {
      blocked.add(u.hostname);
      return req.abort();
    }
    req.continue();
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
  const tool = async (label) => {
    await page.evaluate((label) => {
      const b = [...document.querySelectorAll('.workspace-tools button')].find(
        (el) => el.textContent.trim().endsWith(label),
      );
      if (!b) throw new Error('Missing tool ' + label);
      b.click();
    }, label);
    await settle();
  };
  const panelText = () =>
    page.$eval('#orbit-witness-panel', (el) => el.textContent);
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(
    `${base}/?welcome=0#v=2&lat=${MUSSOORIE.lat}&lon=${MUSSOORIE.lon}&alt=1800000&map=offline-overview&l=`,
    { waitUntil: 'domcontentloaded', timeout: 120000 },
  );
  await ready();
  await page.focus('#location-search');
  await page.type('#location-search', `${MUSSOORIE.lat}, ${MUSSOORIE.lon}`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#lens-save-place');
  await page.click('[data-workspace="compare"]');
  await settle();
  await tool('Orbit Witness');
  check(
    'opening Orbit Witness makes no orbit, catalogue or cloud request',
    !requests.some((r) => ['tle', 'scenes', 'cloud'].includes(r)),
  );
  await page.click('#orbit-witness-predict');
  await page.waitForSelector('[data-mission="sentinel-2b"] [data-pass]');
  check(
    'one prediction reads the cached TLE group, one catalogue search and one cloud forecast',
    ['tle', 'scenes', 'cloud'].every(
      (r) => requests.filter((x) => x === r).length === 1,
    ),
  );
  const missions = await page.$$eval('[data-mission]', (els) =>
    els.map((el) => el.dataset.mission),
  );
  check(
    'all six spacecraft are listed',
    JSON.stringify(missions) ===
      JSON.stringify([
        'sentinel-2a',
        'sentinel-2b',
        'sentinel-2c',
        'landsat-8',
        'landsat-9',
        'iss',
      ]),
  );
  const text = await panelText();
  check(
    'four lanes are labelled with their classes',
    [
      'Predicted pass',
      'Planned acquisition',
      'Available product',
      'Dramatised ride',
      'modelled',
      'derived',
      'observed',
      'simulated',
    ].every((s) => text.includes(s)),
  );
  check(
    'every spacecraft shows "propagated, epoch" and its age',
    (text.match(/propagated, epoch/g) || []).length >= 6 &&
      text.includes('days old'),
  );
  check(
    'cloud forecast is joined per pass with its hour',
    /total cloud at \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/.test(text),
  );
  check(
    'Landsat states that no admissible plan is published',
    text.includes('USGS acquisition calendar ends'),
  );
  check(
    'nothing claims a photograph',
    !/photographed|was imaged|captured your/i.test(text),
  );
  const input = await page.$('[data-orbit-witness-plan-file]');
  await input.uploadFile(planFile);
  await page.waitForFunction(() =>
    document
      .querySelector('#orbit-witness-panel')
      .textContent.includes('Plan-confirmed'),
  );
  check(
    'a loaded plan file confirms Sentinel-2A passes in session only',
    (await panelText()).includes('loaded for this session only'),
  );
  await page.click(
    '[data-mission="sentinel-2b"] [data-orbit-witness-footprint]',
  );
  await settle();
  check(
    'the predicted swath is drawn on the globe as a modelled footprint',
    await page.evaluate(() => {
      const viewer = window.__godsEyeView?.viewer || window.viewer;
      const sources = viewer?.dataSources;
      if (!sources)
        return (
          document.querySelector(
            '[data-orbit-witness-footprint][aria-pressed="true"]',
          ) !== null
        );
      for (let i = 0; i < sources.length; i += 1)
        if (sources.get(i).name === 'orbit-witness')
          return Boolean(
            sources.get(i).entities.getById('orbit-witness-predicted-swath'),
          );
      return false;
    }),
  );
  await page.screenshot({
    path: path.join(output, 'orbit-witness-desktop.png'),
  });
  await page.click('[data-mission="sentinel-2b"] [data-orbit-witness-ride]');
  await page.waitForSelector('#orbit-witness-ride-caption');
  await settle(2500);
  const caption = await page.$eval('#orbit-witness-ride-caption', (el) => ({
    text: el.textContent,
    visible:
      el.getBoundingClientRect().height > 0 &&
      getComputedStyle(el).visibility !== 'hidden',
  }));
  check(
    'the ride caption shows "Dramatised ride · orbit propagated, epoch" in recording mode',
    caption.visible &&
      /Dramatised ride · orbit propagated, epoch \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/.test(
        caption.text,
      ),
  );
  check(
    'the director owns the ride',
    await page.evaluate(() =>
      document.body.classList.contains('recording-mode'),
    ),
  );
  await page.screenshot({
    path: path.join(output, 'orbit-witness-ride-desktop.png'),
  });
  await page.click('#orbit-witness-ride-caption button');
  await settle(1500);
  check(
    'stopping the ride removes the caption',
    !(await page.$('#orbit-witness-ride-caption')),
  );
  await page.evaluate(() => document.body.classList.remove('recording-mode'));
  await page.click('#orbit-witness-watch');
  await page.waitForFunction(() =>
    document
      .querySelector('#orbit-witness-panel')
      .textContent.includes('Scene watch saved'),
  );
  await page.click('[data-workspace="library"]');
  await settle();
  await tool('Watchlists');
  check(
    'the scene watch is the second Watchlist type and starts stopped',
    await page.$eval(
      '#watchlist-panel',
      (el) =>
        el.textContent.includes('Earth Search and NASA CMR-STAC scenes') &&
        el.textContent.includes('Stopped'),
    ),
  );
  check(
    'no catalogue polling happens until monitoring is started',
    requests.filter((r) => r === 'scenes').length === 1,
  );
  await page.screenshot({
    path: path.join(output, 'watchlist-scene-desktop.png'),
  });
  await page.setViewport({ width: 390, height: 844 });
  await page.click('[data-workspace="compare"]');
  await settle(800);
  await tool('Orbit Witness');
  await settle(800);
  check(
    'phone Orbit Witness sheet is usable without horizontal overflow',
    await page.$eval(
      '#orbit-witness-panel',
      (el) =>
        getComputedStyle(el).display !== 'none' &&
        el.getBoundingClientRect().height > 100 &&
        document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: path.join(output, 'orbit-witness-mobile.png'),
  });
  check('no runtime exceptions', errors.length === 0);
  check(
    'Free-only: no billable host was even attempted (external requests are blocked regardless)',
    ![...blocked].some((host) =>
      /googleapis|google\.com|cesium\.com|openai|tomtom|opensky|generativelanguage/.test(
        host,
      ),
    ),
  );
  fs.writeFileSync(
    path.join(output, 'checks.json'),
    JSON.stringify(
      {
        fixture:
          'Real CelesTrak TLE sets retrieved 2026-11-07; synthetic labelled catalogue, cloud forecast and ESA-schema plan. All other external traffic blocked; real free-source probes are recorded in SOURCE-ADMISSION.md.',
        base,
        checks,
        errors,
        requests,
        blockedHosts: [...blocked].sort(),
      },
      null,
      2,
    ),
  );
  assert.ok(checks.every((c) => c.pass));
} finally {
  await browser.close();
  fs.rmSync(profile, { recursive: true, force: true });
  fs.rmSync(planDir, { recursive: true, force: true });
}
