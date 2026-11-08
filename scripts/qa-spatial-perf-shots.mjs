/**
 * Spatial glass before/after screenshots for the WP5.1 blur budget: the dock,
 * the top bar, the entity card and the palette, at rest and while the camera
 * moves. Writes lossless PNGs (for pixel comparison) and small JPEGs (for the
 * record), named `<label>-<surface>-<state>`.
 *
 *   QA_BASE_URL=http://localhost:4231 QA_LABEL=after \
 *     QA_OUTPUT=docs/design/aurel/spatial/perf QA_PNG_OUTPUT=/tmp/shots \
 *     node scripts/qa-spatial-perf-shots.mjs
 *
 * Compare two PNG sets with `node scripts/qa-spatial-perf-shots.mjs --compare
 * <dirA> <dirB>`: prints the mean absolute channel difference and the share of
 * pixels that differ by more than 8 levels, per pair.
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const VIEWPORT = Object.freeze({ width: 1440, height: 900 });
const SURFACES = Object.freeze({
  dock: '#command-dock',
  topbar: ['#aurel-search', '.workspace-nav'],
  card: '#lens-panel:not(.collapsed)',
  palette: '.command-palette-box',
});
const MOTION_LEAD_MS = 700;
const ROTATE_STEP = 0.003;
const DIFF_THRESHOLD = 8;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function launch() {
  return puppeteer.launch({
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--no-sandbox'],
  });
}

async function open(browser, base) {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  await page.goto(
    `${base}/?welcome=0#v=2&lat=30.3258&lon=78.0438&alt=1800000&map=offline-overview&l=`,
    { waitUntil: 'networkidle2', timeout: 90_000 },
  );
  await page.waitForFunction(
    () =>
      window.__godsEyeView &&
      document.body.dataset.workspaceAppearance &&
      document.querySelector('#loading-screen')?.classList.contains('hidden'),
    { timeout: 90_000 },
  );
  await wait(2500);
  return page;
}

/** The union of the selectors' boxes, padded, or null when none is shown. */
async function clipOf(page, selectors) {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  const box = await page.evaluate((all) => {
    const rects = all
      .map((selector) => document.querySelector(selector))
      .filter(Boolean)
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0);
    if (!rects.length) return null;
    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    const right = Math.max(...rects.map((rect) => rect.right));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    return { left, top, right, bottom };
  }, list);
  if (!box) return null;
  const pad = 16;
  const x = Math.max(0, Math.floor(box.left - pad));
  const y = Math.max(0, Math.floor(box.top - pad));
  return {
    x,
    y,
    width: Math.min(VIEWPORT.width - x, Math.ceil(box.right + pad) - x),
    height: Math.min(VIEWPORT.height - y, Math.ceil(box.bottom + pad) - y),
  };
}

function startMotion(page) {
  return page.evaluate((step) => {
    const view = window.__godsEyeView;
    const spin = () => {
      view.viewer.camera.rotateRight(step);
      window.__qaSpin = requestAnimationFrame(spin);
    };
    spin();
  }, ROTATE_STEP);
}

function stopMotion(page) {
  return page.evaluate(() => cancelAnimationFrame(window.__qaSpin));
}

async function capture(page, surface, state, options) {
  const clip = await clipOf(page, SURFACES[surface]);
  if (!clip) throw new Error(`${surface} is not on screen for ${state}`);
  const name = `${options.label}-${surface}-${state}`;
  await page.screenshot({
    path: path.join(options.pngOutput, `${name}.png`),
    clip,
  });
  await page.screenshot({
    path: path.join(options.output, `${name}.jpg`),
    type: 'jpeg',
    quality: 72,
    clip,
  });
  console.log(`wrote ${name}`);
}

async function captureBoth(page, surfaces, options) {
  await page.mouse.move(720, 450);
  // At rest means settled: no camera-move flag and its fade finished.
  await page.waitForFunction(
    () => !document.documentElement.hasAttribute('data-camera-moving'),
    { timeout: 10_000 },
  );
  await wait(400);
  for (const surface of surfaces) await capture(page, surface, 'rest', options);
  await startMotion(page);
  await wait(MOTION_LEAD_MS);
  for (const surface of surfaces)
    await capture(page, surface, 'moving', options);
  await stopMotion(page);
  await wait(1200);
}

async function openPlaceCard(page) {
  await page.click('#location-search');
  await page.keyboard.type('Dehradun');
  await wait(900);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () =>
      document.querySelector('#lens-panel:not(.collapsed) .lens-identity h2'),
    { timeout: 30_000 },
  );
  await wait(4000);
  await page.evaluate(() => document.activeElement?.blur?.());
}

async function shoot(options) {
  fs.mkdirSync(options.output, { recursive: true });
  fs.mkdirSync(options.pngOutput, { recursive: true });
  const browser = await launch();
  try {
    const page = await open(browser, options.base);
    await captureBoth(page, ['dock', 'topbar'], options);
    await openPlaceCard(page);
    await captureBoth(page, ['card'], options);
    await page.keyboard.press('Escape');
    await page.mouse.click(720, 300);
    await page.keyboard.down('Meta');
    await page.keyboard.press('KeyK');
    await page.keyboard.up('Meta');
    await wait(800);
    await captureBoth(page, ['palette'], options);
  } finally {
    await browser.close();
  }
}

/** Per-pair difference of two PNG folders, measured in a browser canvas. */
async function compare(dirA, dirB) {
  const names = fs
    .readdirSync(dirA)
    .filter((name) => name.endsWith('.png'))
    .map((name) => name.replace(/^[^-]+-/, ''));
  const browser = await launch();
  try {
    const page = await browser.newPage();
    for (const name of names) {
      const a = fs.readdirSync(dirA).find((file) => file.endsWith(name));
      const b = fs.readdirSync(dirB).find((file) => file.endsWith(name));
      if (!b) {
        console.log(`${name}: missing in ${dirB}`);
        continue;
      }
      const toUrl = (dir, file) =>
        `data:image/png;base64,${fs.readFileSync(path.join(dir, file)).toString('base64')}`;
      const result = await page.evaluate(diffInPage, {
        a: toUrl(dirA, a),
        b: toUrl(dirB, b),
        threshold: DIFF_THRESHOLD,
      });
      console.log(`${name}: ${JSON.stringify(result)}`);
    }
  } finally {
    await browser.close();
  }
}

async function diffInPage({ a, b, threshold }) {
  const load = (src) =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('image failed to decode'));
      image.src = src;
    });
  const [imageA, imageB] = await Promise.all([load(a), load(b)]);
  const width = Math.min(imageA.width, imageB.width);
  const height = Math.min(imageA.height, imageB.height);
  const pixels = (image) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    return ctx.getImageData(0, 0, width, height).data;
  };
  const pa = pixels(imageA);
  const pb = pixels(imageB);
  let total = 0;
  let changed = 0;
  for (let index = 0; index < pa.length; index += 4) {
    let worst = 0;
    for (let channel = 0; channel < 3; channel++) {
      const delta = Math.abs(pa[index + channel] - pb[index + channel]);
      total += delta;
      worst = Math.max(worst, delta);
    }
    if (worst > threshold) changed++;
  }
  const count = width * height;
  return {
    size: `${imageA.width}x${imageA.height} vs ${imageB.width}x${imageB.height}`,
    meanDiff: Number((total / (count * 3)).toFixed(2)),
    changedShare: Number((changed / count).toFixed(4)),
  };
}

const args = process.argv.slice(2);
const job =
  args[0] === '--compare'
    ? compare(args[1], args[2])
    : shoot({
        base: process.env.QA_BASE_URL || 'http://localhost:4231',
        label: process.env.QA_LABEL || 'after',
        output: path.resolve(
          process.env.QA_OUTPUT || 'docs/design/aurel/spatial/perf',
        ),
        pngOutput: path.resolve(process.env.QA_PNG_OUTPUT || 'qa-shots'),
      });
job.catch((error) => {
  console.error(`[qa-spatial-perf-shots] ${error.message}`);
  process.exitCode = 1;
});
