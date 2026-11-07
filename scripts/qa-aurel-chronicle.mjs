/** Browser acceptance with explicitly synthetic dated pixels/science; all upstream traffic intercepted. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { candidate } from '../src/layers/recentImagery/testDoubles.mjs';
import { resultFixture } from '../src/research/testFixtures.mjs';
const output = path.resolve('docs/design/aurel/phase-4/evidence');
fs.mkdirSync(output, { recursive: true });
const raster = resultFixture(),
  point = raster.requested;
raster.values = raster.values.map((_, index) =>
  index % 9 === 0
    ? null
    : 0.15 +
      (0.75 *
        (Math.sin((index % 128) / 18) * Math.cos(Math.floor(index / 128) / 13) +
          1)) /
        2,
);
const valid = raster.values.filter((value) => value !== null);
raster.statistics = {
  totalPixels: raster.values.length,
  validPixels: valid.length,
  maskedPixels: raster.values.length - valid.length,
  min: Math.min(...valid),
  max: Math.max(...valid),
  mean: valid.reduce((a, b) => a + b, 0) / valid.length,
};
const browser = await puppeteer.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--no-sandbox'],
});
const checks = [],
  errors = [],
  requests = [];
const check = (name, pass) => {
  checks.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
};
const settle = () => new Promise((r) => setTimeout(r, 400));
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  page.on('pageerror', (e) => errors.push(e.message));
  const images = await page.evaluate(() =>
    ['#a7854d', '#4d7d73'].map((color) => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const x = c.getContext('2d');
      x.fillStyle = color;
      x.fillRect(0, 0, 256, 256);
      x.fillStyle = '#fff';
      x.font = '20px sans-serif';
      x.fillText('SYNTHETIC QA', 35, 125);
      return c.toDataURL('image/png').split(',')[1];
    }),
  );
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = new URL(req.url());
    const json = (value) =>
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(value),
      });
    if (u.pathname === '/api/imagery-history/catalog') {
      requests.push('catalog');
      const from = u.searchParams.get('from'),
        to = u.searchParams.get('to');
      return json({
        candidates: ['2026-10-22', '2026-10-25']
          .filter((day) => day >= from && day <= to)
          .map((day) => ({
            ...candidate('S30', day),
            historical: true,
            retrievedAt: new Date().toISOString(),
          })),
        errors: [],
      });
    }
    if (u.pathname === '/api/imagery-history/preview') {
      requests.push('preview');
      const day = u.searchParams.get('day');
      return req.respond({
        status: 200,
        contentType: 'image/png',
        headers: {
          'data-present': 'true',
          'acquisition-time': day,
          'x-aurel-probed-at': new Date().toISOString(),
        },
        body: Buffer.from(images[day === '2026-10-22' ? 0 : 1], 'base64'),
      });
    }
    if (u.hostname === 'gibs.earthdata.nasa.gov')
      return req.respond({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          images[req.url().includes('2026-10-22') ? 0 : 1],
          'base64',
        ),
      });
    if (u.pathname === '/api/research/sentinel-scenes') {
      requests.push('research-search');
      return json({
        version: 1,
        status: 'available',
        reason: null,
        requested: {
          lat: +u.searchParams.get('lat'),
          lon: +u.searchParams.get('lon'),
          fromDay: u.searchParams.get('fromDay'),
          toDay: u.searchParams.get('toDay'),
        },
        retrievedAt: new Date().toISOString(),
        scenes: [
          {
            id: raster.sceneId,
            acquiredAt: raster.acquiredAt,
            cloudCoverPct: 3,
            resolutionM: 10,
            maskResolutionM: 20,
            processingBaseline: '05.13',
          },
        ],
      });
    }
    if (u.pathname === '/api/research/sentinel-ndvi') {
      requests.push('research-analysis');
      return json(raster);
    }
    if (
      ['http:', 'https:'].includes(u.protocol) &&
      !['127.0.0.1', 'localhost'].includes(u.hostname)
    )
      return req.abort();
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
      { timeout: 90000 },
    );
    await settle();
  };
  const fill = async (selector, value) =>
    page.$eval(
      selector,
      (el, v) => {
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      },
      value,
    );
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
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(
    'http://127.0.0.1:4173/?welcome=0#v=2&lat=30.32&lon=78.04&alt=1800000&map=offline-overview&l=',
    { waitUntil: 'domcontentloaded', timeout: 90000 },
  );
  await ready();
  check(
    'research and historical catalogue do not request on startup',
    requests.length === 0,
  );
  await page.focus('#location-search');
  await page.type('#location-search', `${point.lat}, ${point.lon}`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#lens-save-place');
  await page.click('[data-workspace="compare"]');
  await settle();
  await fill('#chronicle-start', '2026-10-01');
  await fill('#chronicle-end', '2026-10-31');
  await page.click('#chronicle-search');
  await page.waitForSelector('[data-candidate="S30:2026-10-22"]');
  check(
    'catalogue search does not automatically probe every image',
    requests.filter((v) => v === 'catalog').length === 1 &&
      !requests.includes('preview'),
  );
  await page.click('[data-candidate="S30:2026-10-22"] [data-slot="a"]');
  await page.waitForFunction(() =>
    document
      .querySelector('[data-image-side="a"]')
      ?.textContent.includes('2026-10-22'),
  );
  await page.click('[data-candidate="S30:2026-10-25"] [data-slot="b"]');
  await page.waitForFunction(
    () => document.querySelector('#chronicle-compare')?.disabled === false,
  );
  await page.click('#chronicle-compare');
  await page.waitForFunction(
    () => window.__gevRecentImagery.layer.getSnapshot().comparison.active,
  );
  check(
    'existing imagery owner displays exact dated A/B pair',
    await page.evaluate(() => {
      const s = window.__gevRecentImagery.layer.getSnapshot();
      return s.shown.a === 'S30:2026-10-22' && s.shown.b === 'S30:2026-10-25';
    }),
  );
  const slider = await page.$(
    'button[role="slider"][aria-orientation="horizontal"]',
  );
  assert.ok(slider);
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  check(
    'existing divider remains keyboard operable',
    await page.evaluate(
      () => window.__gevRecentImagery.layer.getSnapshot().split > 0.5,
    ),
  );
  await page.click('#chronicle-save');
  await page.waitForFunction(
    () => document.querySelector('#chronicle-note')?.disabled === false,
  );
  await fill(
    '#chronicle-note',
    'Synthetic QA interpretation: appearance alone does not prove a physical change.',
  );
  await page.click('#chronicle-note-form button[type="submit"]');
  await settle();
  check(
    'saved interpretation keeps an explicit unresolved classification',
    await page.$eval(
      '#chronicle-panel',
      (el) =>
        el.textContent.includes('Unresolved') &&
        el.textContent.includes('Synthetic QA interpretation'),
    ),
  );
  await page.click('#reset-globe-view');
  await new Promise((resolve) => setTimeout(resolve, 1800));
  await page.$eval('.chronicle-panel-inner', (el) => {
    el.scrollTop = el.scrollHeight * 0.35;
  });
  await page.screenshot({ path: path.join(output, 'chronicle-desktop.png') });
  await page.click('[data-workspace="library"]');
  await settle();
  const before = requests.length;
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#fieldbook-panel button')].find(
      (el) => el.textContent === 'Open in Chronicle',
    );
    if (!b) throw Error('Missing saved comparison');
    b.click();
  });
  await settle();
  check(
    'opening saved comparison metadata makes no provider requests',
    requests.length === before,
  );
  await page.click('[data-workspace="compare"]');
  await tool('Research');
  await fill('#research-start', '2026-10-01');
  await fill('#research-end', '2026-10-31');
  await page.click('#research-search');
  await page.waitForSelector('.research-scenes button');
  await page.click('.research-scenes button');
  await page.click('#research-analyze');
  await page.waitForSelector('#research-heatmap');
  check(
    'explicit scientific analysis displays native grid and mask provenance',
    await page.$eval(
      '#research-panel',
      (el) =>
        el.textContent.includes('NDVI') &&
        el.textContent.includes('20') &&
        el.textContent.includes('0.0001'),
    ),
  );
  const pixels = await page.$eval('#research-heatmap', (canvas) => ({
    width: canvas.width,
    height: canvas.height,
    alpha: canvas.getContext('2d').getImageData(1, 0, 1, 1).data[3],
  }));
  check(
    'science raster uses validated native dimensions',
    pixels.width === 128 && pixels.height === 128 && pixels.alpha === 255,
  );
  await page.screenshot({ path: path.join(output, 'research-desktop.png') });
  await page.setViewport({ width: 390, height: 844 });
  await settle();
  check(
    'phone research inspector remains usable without horizontal overflow',
    await page.$eval(
      '#research-panel',
      (el) =>
        getComputedStyle(el).display !== 'none' &&
        el.getBoundingClientRect().height > 100 &&
        el.getBoundingClientRect().top < innerHeight &&
        document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: path.join(output, 'research-mobile.png') });
  check('no runtime exceptions', errors.length === 0);
  fs.writeFileSync(
    path.join(output, 'checks.json'),
    JSON.stringify(
      {
        fixture:
          'Synthetic labelled imagery, dates and science pixels. All external traffic blocked or mocked; real free-source probes are documented separately.',
        checks,
        errors,
        requests,
      },
      null,
      2,
    ),
  );
  assert.ok(checks.every((c) => c.pass));
} finally {
  await browser.close();
}
