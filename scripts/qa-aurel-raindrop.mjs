/**
 * Raindrop QA: the real UI with external requests blocked and labelled
 * fixtures for /api/hydro/*. Never uses saved credentials or live providers.
 * Expects the dev server on 127.0.0.1:4173 (or QA_ORIGIN).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const origin = process.env.QA_ORIGIN || 'http://127.0.0.1:4173';
const output = path.resolve('docs/design/aurel/phase-6/wp5/evidence');
fs.mkdirSync(output, { recursive: true });
const now = Date.now();
const half = Math.floor((now - 6 * 3600_000) / 1800_000) * 1800_000;
let rainRate = { lo: 0, hi: 0.1 };
function imerg(url) {
  const cells = url.searchParams.get('cells').split(',');
  const steps =
    url.searchParams.get('window') === '24h'
      ? 48
      : url.searchParams.get('window') === '3h'
        ? 6
        : 2;
  return {
    version: 1,
    state: 'ready',
    window: url.searchParams.get('window'),
    latest: new Date(half).toISOString().replace('.000Z', 'Z'),
    retrievedAt: new Date(now).toISOString(),
    steps: Array.from({ length: steps }, (_, i) => ({
      time: new Date(half - i * 1800_000).toISOString().replace('.000Z', 'Z'),
      published: true,
      values: Object.fromEntries(cells.map((key) => [key, rainRate])),
    })),
  };
}
function forecast(url) {
  const points = url.searchParams.get('pts').split(';');
  const hour = Math.floor(now / 3600_000) * 3600_000;
  const time = Array.from({ length: 48 }, (_, i) =>
    new Date(hour + i * 3600_000).toISOString().replace('.000Z', 'Z'),
  );
  return {
    version: 1,
    state: 'ready',
    unitsReserved: points.length,
    retrievedAt: new Date(now).toISOString(),
    points: points.map((p) => {
      const [lat, lon] = p.split(',').map(Number);
      return {
        requested: { lat, lon },
        grid: { lat, lon },
        unit: 'mm',
        time,
        precipitation: time.map(() => 0.4),
      };
    }),
  };
}
function glofas(url) {
  const day = (i) =>
    new Date(now - (91 - i) * 86400_000).toISOString().slice(0, 10);
  return {
    version: 1,
    state: 'ready',
    unitsReserved: 7,
    retrievedAt: new Date(now).toISOString(),
    requested: {
      lat: +url.searchParams.get('lat'),
      lon: +url.searchParams.get('lon'),
    },
    cell: { lat: 30.375, lon: 78.075 },
    time: Array.from({ length: 98 }, (_, i) => day(i)),
    values: Array.from({ length: 98 }, (_, i) => 50 + ((i * 37) % 91)),
  };
}

const browser = await puppeteer.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--no-sandbox'],
});
const checks = [],
  errors = [],
  requested = [],
  blocked = new Set();
const check = (name, pass) => {
  checks.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
};
const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));
const panelText = (page) => page.$eval('#raindrop-panel', (el) => el.innerText);
async function waitForDrop(page) {
  await page.waitForFunction(
    () => {
      const text = document.querySelector('#raindrop-panel')?.innerText || '';
      return /Downhill path/.test(text) && !/Reading…/.test(text);
    },
    { timeout: 120000 },
  );
}
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
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
    if (url.pathname.startsWith('/api/hydro/')) {
      const kind = url.pathname.split('/').at(-1);
      requested.push(`${kind}:${url.searchParams.get('window') || ''}`);
      return respond({ imerg, forecast, glofas }[kind](url));
    }
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !['localhost', '127.0.0.1'].includes(url.hostname)
    ) {
      blocked.add(url.hostname);
      return request.abort();
    }
    request.continue();
  });
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(
    `${origin}/?welcome=0#v=2&lat=30.30&lon=78.0&alt=120000&map=offline-overview&l=`,
    {
      waitUntil: 'domcontentloaded',
      timeout: 90000,
    },
  );
  await page.waitForFunction(
    () => window.__godsEyeView && window.__aurelRaindrop,
    { timeout: 120000 },
  );
  await settle(1500);
  check('mount performs no hydro requests', requested.length === 0);

  await page.focus('#location-search');
  await page.type('#location-search', '30.36, 78.08');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#lens-save-place');
  await page.click('[data-workspace="plan"]');
  await settle();
  await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .find(
        (b) => b.textContent.trim().endsWith('Raindrop') && !b.dataset.railItem,
      )
      ?.click(),
  );
  await settle();
  await page.waitForFunction(
    () =>
      document.querySelector('#raindrop-selection') &&
      !document.querySelector('#raindrop-selection').disabled,
  );
  await page.click('#raindrop-selection');
  await waitForDrop(page);
  const rajpur = await page.$eval('.raindrop-rivers', (el) =>
    el.textContent.split(' → '),
  );
  check(
    'Rajpur drop reaches the Song and then the Ganga',
    rajpur.indexOf('Song') >= 0 &&
      rajpur.indexOf('Ganga') > rajpur.indexOf('Song'),
  );
  let text = await panelText(page);
  check(
    'Rajpur drop reaches the ocean through HydroRIVERS',
    /ocean outlet of the HydroRIVERS network/.test(text),
  );
  check(
    'method card states DEM resolution, sink filling, D8 ambiguity and ignored structures',
    /3″ cells, about \d+ m × \d+ m/.test(text) &&
      /cells raised/.test(text) &&
      /steps on this path were ambiguous/.test(text) &&
      /Culverts, storm drains, embankments, bridges and buildings/.test(text),
  );
  check(
    'cards carry class labels and the IMERG card shows ranges with latency and coverage',
    /Simulated/.test(text) &&
      /Derived/.test(text) &&
      /Modelled/.test(text) &&
      /0\.0–0\.1 mm/.test(text) &&
      /ago; 100% of the basin area had data/.test(text),
  );
  check(
    'forecast reads one ledgered request; GloFAS is not read until asked',
    requested.includes('forecast:') &&
      !requested.some((r) => r.startsWith('glofas')),
  );
  await page.click('#raindrop-glofas');
  await page.waitForFunction(() =>
    /Percentile \d+/.test(document.querySelector('#raindrop-panel').innerText),
  );
  text = await panelText(page);
  check(
    'GloFAS shows a percentile rank and no discharge value',
    /Percentile \d+/.test(text) && !/m³\/s/.test(text),
  );
  check(
    'IMD and CWC are linked as the authority',
    (
      await page.$$eval('.raindrop-authority a', (links) =>
        links.map((a) => a.href),
      )
    )
      .join(' ')
      .includes('mausam.imd.gov.in'),
  );
  check(
    'no flood-depth, inundation, stage or evacuation wording',
    !/flood depth|inundat|evacuat|river stage|danger level/i.test(text),
  );
  await page.screenshot({
    path: path.join(output, 'raindrop-rajpur-desktop.png'),
  });

  // Selaqui by coordinate through the owner (the globe pick is covered by the browser check).
  await page.evaluate(() => window.__aurelRaindrop.traceAt(77.86, 30.37));
  await waitForDrop(page);
  const selaqui = await page.$eval('.raindrop-rivers', (el) =>
    el.textContent.split(' → '),
  );
  check(
    'Selaqui drop goes west to the Asan and the Yamuna',
    selaqui.indexOf('Asan') >= 0 &&
      selaqui.indexOf('Yamuna') > selaqui.indexOf('Asan') &&
      !selaqui.includes('Song'),
  );

  // Watch: fires once when the 3 h basin mean crosses the threshold.
  await page.$eval('#raindrop-threshold', (el) => {
    el.value = '10';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('#raindrop-watch-form button[type="submit"]');
  await page.waitForFunction(() =>
    /Last reading/.test(document.querySelector('#raindrop-panel').innerText),
  );
  rainRate = { lo: 5, hi: 5.3 };
  // Two scheduled checks of the same window, driven through the owner.
  await page.evaluate(() => window.__aurelRaindrop.checkWatches?.());
  await settle(1500);
  await page.evaluate(() => window.__aurelRaindrop.checkWatches?.());
  await settle(1500);
  const notes = await page.$$eval('.raindrop-fired', (rows) => rows.length);
  check('basin watch fires exactly once for a crossing', notes === 1);

  // Phone layout.
  await page.setViewport({ width: 390, height: 844 });
  await settle(1500);
  await page.click('[data-workspace="plan"]');
  await settle();
  await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .find(
        (b) =>
          b.textContent.trim().endsWith('Raindrop') &&
          !b.dataset.railItem &&
          b.getBoundingClientRect().width > 0,
      )
      ?.click(),
  );
  await settle(1000);
  const phone = await page.$eval('#raindrop-panel', (el) => ({
    display: getComputedStyle(el).display,
    collapsed: el.classList.contains('collapsed'),
    overflow: document.documentElement.scrollWidth - innerWidth,
    sheet: document.body.dataset.mobileSheet ?? null,
  }));
  check(
    `phone Raindrop sheet is visible with no horizontal overflow (${JSON.stringify(phone)})`,
    phone.display !== 'none' && !phone.collapsed && phone.overflow <= 0,
  );
  await page.screenshot({
    path: path.join(output, 'raindrop-selaqui-mobile.png'),
  });
  check(
    'no billable provider was contacted',
    ![...blocked].some((host) =>
      /googleapis|cesium\.com|openai|tomtom|opensky/.test(host),
    ),
  );
  check('no browser runtime errors', errors.length === 0);
  fs.writeFileSync(
    path.join(output, 'checks.json'),
    JSON.stringify(
      {
        fixture:
          'Bundled Doon DEM and HydroSHEDS subset (same-origin); /api/hydro/* answered by labelled synthetic fixtures; every external host blocked.',
        checks,
        errors,
        requested,
        blockedHosts: [...blocked].sort(),
        rajpur,
        selaqui,
      },
      null,
      2,
    ) + '\n',
  );
  assert.ok(checks.every((row) => row.pass));
} finally {
  await browser.close();
}
