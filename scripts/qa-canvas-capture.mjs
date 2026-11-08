#!/usr/bin/env node
/**
 * qa-canvas-capture — captures still read the globe without preserveDrawingBuffer.
 *
 * WP4.8 turned the WebGL drawing buffer's preservation off. A read of the
 * Cesium canvas is then only valid inside the task that rendered it, so the
 * app's captures copy it inside scene.postRender (src/voice/cesiumFrameCapture.js).
 * Against a built app (`node scripts/serve-built.mjs --port 4236`), this check:
 *  1. copies the canvas inside postRender after a requested render and needs
 *     a lit image (mean luma > 10) that roughly matches a screenshot of the
 *     same region;
 *  2. copies it 100 ms after a frame, outside postRender, and needs it blank:
 *     proof that the buffer really is not preserved.
 *
 * Usage: node scripts/qa-canvas-capture.mjs [--url http://localhost:4236/]
 * Exit: 0 pass, 1 fail.
 */
import puppeteer from 'puppeteer';

const urlIndex = process.argv.indexOf('--url');
const ORIGIN =
  urlIndex > 0 && process.argv[urlIndex + 1]
    ? process.argv[urlIndex + 1]
    : 'http://localhost:4236/';
const VIEW =
  '?welcome=0#v=2&lat=30.3258&lon=78.0438&alt=1800000&map=esri-imagery&l=';
const SETTLE_MS = 8000;
const SAMPLE_W = 64;
const SAMPLE_H = 40;
const MIN_LIT_LUMA = 10;
const MAX_BLANK_LUMA = 2;
/** Mean per-channel difference allowed against the screenshot (0-255). */
const MAX_SCREENSHOT_DIFF = 40;

/** Runs in the page: luma stats and a small RGB grid of a 2D canvas. */
function pageHelpers() {
  window.__qaSample = (source) => {
    const sample = document.createElement('canvas');
    sample.width = 64;
    sample.height = 40;
    const ctx = sample.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, sample.width, sample.height);
    const data = ctx.getImageData(0, 0, sample.width, sample.height).data;
    let luma = 0;
    let opaque = 0;
    for (let i = 0; i < data.length; i += 4) {
      luma += data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      if (data[i + 3] > 8) opaque++;
    }
    const pixels = data.length / 4;
    return { luma: luma / pixels, opaque: opaque / pixels, rgb: [...data] };
  };
  window.__qaCopy = (canvas) => {
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    copy.getContext('2d').drawImage(canvas, 0, 0);
    return copy;
  };
}

/** The app's capture path: request a render, copy inside postRender. */
async function captureInsidePostRender(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const gev = window.__godsEyeView;
        const scene = gev.viewer.scene;
        const timer = setTimeout(() => {
          remove();
          reject(new Error('no postRender within 400 ms'));
        }, 400);
        const remove = scene.postRender.addEventListener(() => {
          clearTimeout(timer);
          remove();
          resolve(window.__qaSample(window.__qaCopy(scene.canvas)));
        });
        (gev.requestRender ?? scene.requestRender.bind(scene))();
      }),
  );
}

/** The old path: copy the canvas 100 ms after a frame was drawn. */
async function captureAfterTimeout(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const gev = window.__godsEyeView;
        const scene = gev.viewer.scene;
        const remove = scene.postRender.addEventListener(() => {
          remove();
          setTimeout(
            () => resolve(window.__qaSample(window.__qaCopy(scene.canvas))),
            100,
          );
        });
        (gev.requestRender ?? scene.requestRender.bind(scene))();
      }),
  );
}

/** Sample a screenshot of the canvas region in the page, the same way. */
async function sampleScreenshot(page) {
  const box = await page.evaluate(() => {
    const rect =
      window.__godsEyeView.viewer.scene.canvas.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  const png = await page.screenshot({ clip: box, encoding: 'base64' });
  return page.evaluate(async (base64) => {
    const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
    const bitmap = await createImageBitmap(blob);
    return window.__qaSample(bitmap);
  }, png);
}

function meanDiff(a, b) {
  let total = 0;
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) total += Math.abs(a[i + c] - b[i + c]);
    count += 3;
  }
  return total / count;
}

const round = (value) => Math.round(value * 10) / 10;

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
let failed = false;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 200)));
  await page.goto(new URL(VIEW, ORIGIN).href, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => window.__godsEyeView?.viewer, {
    timeout: 60000,
  });
  await page.waitForSelector('#loading-screen.hidden', { timeout: 60000 });
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  await page.evaluate(pageHelpers);

  const preserved = await page.evaluate(
    () =>
      window.__godsEyeView.viewer.scene.context._gl.getContextAttributes()
        .preserveDrawingBuffer,
  );
  const inside = await captureInsidePostRender(page);
  const shot = await sampleScreenshot(page);
  const after = await captureAfterTimeout(page);
  const diff = meanDiff(inside.rgb, shot.rgb);

  const checks = [
    ['preserveDrawingBuffer is off', preserved === false, `${preserved}`],
    [
      'postRender copy is lit',
      inside.luma > MIN_LIT_LUMA,
      `luma ${round(inside.luma)}, opaque ${round(inside.opaque * 100)}%`,
    ],
    [
      'postRender copy matches the screenshot',
      diff < MAX_SCREENSHOT_DIFF,
      `mean diff ${round(diff)} (screenshot luma ${round(shot.luma)})`,
    ],
    [
      'copy 100 ms later is blank',
      after.luma < MAX_BLANK_LUMA,
      `luma ${round(after.luma)}, opaque ${round(after.opaque * 100)}%`,
    ],
  ];
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
    if (!ok) failed = true;
  }
  console.log(`sample grid ${SAMPLE_W}x${SAMPLE_H}`);
} catch (error) {
  console.error('FAIL ', error);
  failed = true;
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
