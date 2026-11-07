/** Real bundled geography in an isolated browser; all external/provider requests blocked or fixture-backed. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';
import {
  emptyFirmsArea,
  FIRMS_AREA_SOURCES,
} from '../src/sources/firmsArea.js';

const output = path.resolve('docs/design/aurel/phase-5/evidence');
fs.mkdirSync(output, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurel-offline-qa-'));
const manifest = JSON.parse(
  fs.readFileSync('public/regions/dehradun-core/manifest.json', 'utf8'),
);
const names = fs.readFileSync('public/regions/dehradun-core/names.json');
const checks = [],
  errors = [],
  requests = [],
  blockedHosts = new Set();
let firmsChecks = 0,
  tamperNames = false,
  page;
const check = (name, pass) => {
  checks.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 400));
const browser = await puppeteer.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--no-sandbox'],
});
const report = () =>
  fs.writeFileSync(
    path.join(output, 'offline-checks.json'),
    JSON.stringify(
      {
        data: 'Real Geofabrik-derived Dehradun pack. FIRMS baseline response is synthetic empty-success solely for lifecycle QA. All external HTTP and other provider routes blocked; isolated browser profile.',
        manifest: {
          extent: manifest.extent,
          counts: manifest.counts,
          assets: manifest.assets,
        },
        checks,
        errors,
        requests,
        blockedHosts: [...blockedHosts],
        firmsChecks,
      },
      null,
      2,
    ),
  );
try {
  page = await browser.newPage();
  page.setDefaultTimeout(60000);
  await page.setCacheEnabled(false);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    const json = (value) =>
      request.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(value),
      });
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !['127.0.0.1', 'localhost'].includes(url.hostname)
    ) {
      blockedHosts.add(url.hostname);
      return request.abort();
    }
    if (url.pathname.startsWith('/regions/')) {
      requests.push(url.pathname);
      if (url.pathname.endsWith('/names.json') && tamperNames) {
        const altered = Buffer.from(names);
        altered[0] = 0;
        return request.respond({
          status: 200,
          contentType: 'application/json',
          body: altered,
        });
      }
    }
    if (url.pathname === '/api/firms/area') {
      firmsChecks++;
      requests.push(url.pathname);
      const now = Date.now(),
        bounds = Object.fromEntries(
          ['west', 'south', 'east', 'north'].map((key) => [
            key,
            Number(url.searchParams.get(key)),
          ]),
        );
      return json({
        ...emptyFirmsArea(
          bounds,
          now,
          'ok',
          'Synthetic offline QA baseline response.',
        ),
        status: 'ok',
        fetchedAt: now,
        sources: FIRMS_AREA_SOURCES.map((id) => ({
          id,
          status: 'ok',
          count: 0,
        })),
      });
    }
    if (url.pathname.startsWith('/api/')) {
      requests.push(url.pathname);
      return request.respond({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error:
            'External provider access intentionally unavailable in offline QA',
        }),
      });
    }
    return request.continue();
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
  const click = async (selector) => {
    await page.waitForSelector(selector);
    await page.$eval(selector, (element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await settle();
    await page.click(selector);
    await settle();
  };
  const fill = async (selector, value) =>
    page.$eval(
      selector,
      (element, next) => {
        element.value = next;
        element.dispatchEvent(new Event('input', { bubbles: true }));
      },
      value,
    );
  const tool = async (label) => {
    await page.evaluate((label) => {
      const button = [
        ...document.querySelectorAll('.workspace-tools button'),
      ].find((element) => element.textContent.trim().endsWith(label));
      if (!button) throw new Error('Missing tool ' + label);
      button.click();
    }, label);
    await settle();
  };
  const visiblePanel = async (selector) =>
    page.$eval(
      selector,
      (element) =>
        getComputedStyle(element).display !== 'none' &&
        element.getBoundingClientRect().height > 100 &&
        element.getBoundingClientRect().top < innerHeight &&
        document.documentElement.scrollWidth <= innerWidth,
    );
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(
    'http://127.0.0.1:4173/?welcome=0#v=2&lat=30.325&lon=78.041&alt=1800000&map=offline-overview&l=',
    { waitUntil: 'domcontentloaded', timeout: 90000 },
  );
  await ready();
  check(
    'startup makes no region asset or watch source request',
    requests.filter((url) => url.startsWith('/regions/')).length === 0 &&
      firmsChecks === 0,
  );
  const unrelated = path.join(temp, 'unrelated-qa.geojson');
  fs.writeFileSync(
    unrelated,
    JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'SYNTHETIC QA unrelated file' },
          geometry: { type: 'Point', coordinates: [78.042, 30.325] },
        },
      ],
    }),
  );
  await (await page.$('#geo-import-input')).uploadFile(unrelated);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.geo-import-name')].some((element) =>
      element.textContent.includes('unrelated-qa'),
    ),
  );
  await click('[data-workspace="library"]');
  await tool('Offline region');
  await click('#region-preview');
  await page.waitForFunction(
    () => document.querySelector('#region-enable')?.disabled === false,
  );
  check(
    'preview fetches only the manifest and does not import geography',
    requests.filter((url) => url.startsWith('/regions/')).join(',') ===
      '/regions/dehradun-core/manifest.json' &&
      (await page.$$('.geo-import-row')).length === 1,
  );
  check(
    'preview discloses real extent date license and footprints',
    await page.$eval(
      '#region-panel',
      (element) =>
        element.textContent.includes('2026-11-05') &&
        element.textContent.includes('ODbL-1.0') &&
        element.textContent.includes('78.022') &&
        element.textContent.includes('footprints'),
    ),
  );
  tamperNames = true;
  await click('#region-enable');
  await page.waitForSelector('#region-panel [role="alert"]');
  check(
    'tampered data is rejected before import without removing existing files',
    (await page.$$('.geo-import-row')).length === 1 &&
      (await page.$eval('#region-panel [role="alert"]', (element) =>
        element.textContent.includes('verified'),
      )),
  );
  await page.screenshot({
    path: path.join(output, 'offline-region-rejected.png'),
  });
  tamperNames = false;
  const start = Date.now();
  await click('#region-enable');
  await page.waitForFunction(
    () => document.querySelector('#region-search')?.disabled === false,
    { timeout: 90000 },
  );
  check(
    'explicit enable loads real verified geometry through the existing importer',
    (await page.$$('.geo-import-row')).length === 2 &&
      (await page.$eval('.region-state', (element) =>
        element.textContent.includes('Verified and loaded'),
      )),
  );
  const render = await page.evaluate(() => {
    const sources = window.__godsEyeView.viewer.dataSources;
    return Array.from(
      { length: sources.length },
      (_, index) =>
        sources.get(index).importedEntities?.length ??
        sources.get(index).entities?.values.length ??
        0,
    );
  });
  check(
    'the globe owns the full bounded real feature collection',
    render.includes(manifest.counts.features),
  );
  requests.push(`local-import-duration-ms:${Date.now() - start}`);
  const beforeSearch = requests.length;
  await fill('#region-search', 'clock');
  await page.waitForSelector('[data-region-result]');
  check(
    'offline name alias search finds the real Clock Tower without a request',
    requests.length === beforeSearch &&
      (await page.$eval('.region-results', (element) =>
        element.textContent.includes('Ghanta Ghar'),
      )),
  );
  await click('[data-region-result]');
  await new Promise((resolve) => setTimeout(resolve, 1500));
  check(
    'local result navigates the existing camera to its approximate location',
    await page.evaluate(() => {
      const p = window.__godsEyeView.viewer.camera.positionCartographic;
      return (
        Math.abs((p.longitude * 180) / Math.PI - 78.0418653) < 0.01 &&
        Math.abs((p.latitude * 180) / Math.PI - 30.3243248) < 0.01
      );
    }),
  );
  await page.screenshot({
    path: path.join(output, 'offline-region-desktop.png'),
  });
  await page.setViewport({ width: 390, height: 844 });
  await settle();
  await click('[aria-label="Full-height inspector"]');
  check(
    'phone region panel remains visible and has no horizontal overflow',
    await visiblePanel('#region-panel'),
  );
  await page.screenshot({
    path: path.join(output, 'offline-region-mobile.png'),
  });
  await page.setViewport({ width: 1440, height: 900 });
  await settle();
  await click('[data-workspace="explore"]');
  await click('#lens-save-place');
  await click('[data-workspace="library"]');
  await fill('#fieldbook-title', 'Offline Dehradun QA');
  await click('#fieldbook-save');
  await tool('Watchlists');
  await page.waitForFunction(
    () => document.querySelectorAll('#watchlist-place option').length > 1,
  );
  const placeId = await page.$eval(
    '#watchlist-place',
    (element) => [...element.options].find((option) => option.value)?.value,
  );
  await page.select('#watchlist-place', placeId);
  await fill('#watchlist-title', 'Synthetic lifecycle check');
  await click('#watchlist-create');
  await page.waitForSelector('.watchlist-card');
  check(
    'creating a watch does not start acquisition',
    firmsChecks === 0 &&
      (await page.$eval('.watchlist-state', (element) =>
        element.textContent.includes('Stopped'),
      )),
  );
  await click('[data-watch-start]');
  await page.waitForFunction(() => {
    const label = document.querySelector('.watchlist-state')?.textContent;
    return label && !['Stopped', 'Checking source'].includes(label.trim());
  });
  assert.equal(
    await page.$eval('.watchlist-state', (element) =>
      element.textContent.trim(),
    ),
    'Monitoring',
  );
  check(
    'explicit start performs one bounded check and establishes a quiet baseline',
    firmsChecks === 1 &&
      (await page.$$('.watchlist-notification')).length === 0 &&
      (await page.$$('.watchlist-baseline')).length === 0,
  );
  await page.screenshot({
    path: path.join(output, 'offline-watchlist-desktop.png'),
  });
  await click('[data-watch-stop]');
  await page.waitForFunction(() =>
    document.querySelector('.watchlist-state')?.textContent.includes('Stopped'),
  );
  await settle();
  check(
    'explicit stop leaves monitoring stopped without extra requests',
    firmsChecks === 1,
  );
  await page.setViewport({ width: 390, height: 844 });
  await settle();
  await click('[aria-label="Full-height inspector"]');
  check(
    'phone watchlist remains usable without horizontal overflow',
    await visiblePanel('#watchlist-panel'),
  );
  await page.screenshot({
    path: path.join(output, 'offline-watchlist-mobile.png'),
  });
  await page.setViewport({ width: 1440, height: 900 });
  await settle();
  await tool('Offline region');
  await click('#region-remove');
  check(
    'region removal preserves unrelated imports and disables its search',
    (await page.$$('.geo-import-row')).length === 1 &&
      (await page.$eval('#region-search', (element) => element.disabled)) &&
      (await page.$eval('.geo-import-name', (element) =>
        element.textContent.includes('unrelated-qa'),
      )),
  );
  const regionFetches = requests.filter((url) =>
    url.startsWith('/regions/'),
  ).length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  await click('[data-workspace="library"]');
  await tool('Watchlists');
  await page.waitForSelector('.watchlist-card');
  check(
    'reload restores saved definitions but does not restart monitoring or region loading',
    firmsChecks === 1 &&
      requests.filter((url) => url.startsWith('/regions/')).length ===
        regionFetches &&
      (await page.$eval('.watchlist-state', (element) =>
        element.textContent.includes('Stopped'),
      )),
  );
  await click('[data-watch-start]');
  await page.waitForFunction(() =>
    document
      .querySelector('.watchlist-state')
      ?.textContent.includes('Waiting for cooldown'),
  );
  check(
    'restart respects the persisted 30 minute minimum check interval',
    firmsChecks === 1,
  );
  await click('[data-watch-stop]');
  check('no runtime exceptions', errors.length === 0);
  report();
  assert.ok(checks.every((entry) => entry.pass));
} catch (error) {
  errors.push(error.message);
  if (page)
    errors.push(
      await page
        .evaluate(() =>
          JSON.stringify({
            watch: document.querySelector('#watchlist-panel')?.textContent,
            region: document.querySelector('#region-panel')?.textContent,
            visibility: document.visibilityState,
          }),
        )
        .catch(() => 'Diagnostic page unavailable'),
    );
  if (page)
    await page
      .screenshot({ path: path.join(output, 'offline-failure.png') })
      .catch(() => {});
  report();
  throw error;
} finally {
  await browser.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
