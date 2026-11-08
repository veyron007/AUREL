#!/usr/bin/env node
/**
 * qa-local-geojson-shot — capture a bundled infrastructure layer (datacenters
 * or dams) at fixed cameras and a fixed scene time for before/after visual
 * identity, or compare two captured sets pixel by pixel.
 *
 *   node scripts/qa-local-geojson-shot.mjs shoot --url http://localhost:4243 \
 *     --layer local-datacenters --tag before --out docs/design/aurel/perf/phase-4a
 *   node scripts/qa-local-geojson-shot.mjs compare --a before --b after \
 *     --layer local-datacenters --out docs/design/aurel/perf/phase-4a
 *   node scripts/qa-local-geojson-shot.mjs smoke --url http://localhost:4243
 *
 * `smoke` enables the layer, clicks a visible tip, requires the context store
 * to select that layer's record, disables the layer and requires that none of
 * its pick objects remain in scene.primitives or scene.groundPrimitives and
 * that the page raised no errors.
 *
 * Shots are 1440x900 JPGs (quality 82). `compare` decodes both sets with
 * sharp (already installed by Vite tooling) and prints, per view, the share of
 * pixels whose largest channel difference exceeds a small threshold.
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { FIRST_RUN_STORAGE_KEY } from '../src/firstRunExperience.js';

const VIEWPORT = Object.freeze({ width: 1440, height: 900 });
const SCENE_TIME = '2026-06-21T12:00:00Z';
const JPEG_QUALITY = 82;
const CHANNEL_THRESHOLD = 24;
const SETTLE_FRAMES = 240;
const VIEWS = Object.freeze({
  'local-datacenters': [
    { name: 'world', lon: 20, lat: 30, height: 12_000_000, pitch: -90 },
    { name: 'close', lon: -77.46, lat: 38.99, height: 2_500, pitch: -35 },
  ],
  'local-dams': [
    { name: 'world', lon: -100, lat: 38, height: 9_000_000, pitch: -90 },
    // Grand Coulee Dam, from the south.
    { name: 'close', lon: -118.99, lat: 47.925, height: 4_000, pitch: -40 },
    // A LineString dam (Clyde, New Zealand): the clamped ground line.
    { name: 'line', lon: 169.359, lat: -45.426, height: 1_500, pitch: -70 },
  ],
});
const SHORT_NAMES = Object.freeze({
  'local-datacenters': 'datacenters',
  'local-dams': 'dams',
});

function option(argv, name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
}

function shotPath(out, layerId, view, tag) {
  return path.join(out, `${SHORT_NAMES[layerId]}-${view}-${tag}.jpg`);
}

async function enableOnly(page, layerId) {
  await page.evaluate(
    async (id, time) => {
      const gev = window.__godsEyeView;
      gev.viewer.camera.cancelFlight();
      gev.viewer.clock.shouldAnimate = false;
      // JulianDate is not global; its class is reachable from any instance.
      const JulianDate = gev.viewer.clock.currentTime.constructor;
      gev.viewer.clock.currentTime = JulianDate.fromIso8601(time);
      for (const [other, entry] of gev.dataManager.layers) {
        if (entry.enabled && other !== id)
          await gev.dataManager.setEnabled(other, false, { origin: 'user' });
      }
      await gev.dataManager.setEnabled(id, true, { origin: 'user' });
    },
    layerId,
    SCENE_TIME,
  );
}

async function settle(page) {
  await page.evaluate(
    (frames) =>
      new Promise((resolve) => {
        const viewer = window.__godsEyeView.viewer;
        let ticks = 0;
        const tick = () => {
          window.__godsEyeView.requestRender?.('qa-shot');
          viewer.scene.requestRender?.();
          const loaded = viewer.scene.globe.tilesLoaded;
          if (++ticks < frames || (!loaded && ticks < frames * 4))
            requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      }),
    SETTLE_FRAMES,
  );
}

async function setView(page, view) {
  await page.evaluate((v) => {
    const viewer = window.__godsEyeView.viewer;
    const ellipsoid = viewer.scene.globe.ellipsoid;
    const toRad = Math.PI / 180;
    viewer.camera.setView({
      destination: ellipsoid.cartographicToCartesian({
        longitude: v.lon * toRad,
        latitude: v.lat * toRad,
        height: v.height,
      }),
      orientation: { heading: 0, pitch: v.pitch * toRad, roll: 0 },
    });
  }, view);
}

/** Launch Chrome on the GPU and open the app with no layers enabled. */
async function openApp(url, pageErrors = []) {
  const browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 300_000,
    args: [
      ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []),
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    ],
  });
  const page = await browser.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewport({ ...VIEWPORT, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((key) => {
    localStorage.setItem(key, 'suppressed');
  }, FIRST_RUN_STORAGE_KEY);
  await page.goto(`${url}/#map=esri-imagery&l=`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(
    () =>
      window.__godsEyeView?.viewer &&
      document.querySelector('#loading-screen')?.classList.contains('hidden'),
    { timeout: 120_000 },
  );
  await new Promise((resolve) => setTimeout(resolve, 8_000));
  return { browser, page };
}

async function shoot(argv) {
  const url = option(argv, 'url', 'http://localhost:4243');
  const layerId = option(argv, 'layer', 'local-datacenters');
  const tag = option(argv, 'tag', 'shot');
  const out = option(argv, 'out', 'qa-shots');
  if (!VIEWS[layerId]) throw new Error(`Unknown layer ${layerId}`);
  mkdirSync(out, { recursive: true });
  const { browser, page } = await openApp(url);
  try {
    await enableOnly(page, layerId);
    for (const view of VIEWS[layerId]) {
      await setView(page, view);
      await settle(page);
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      await settle(page);
      const file = shotPath(out, layerId, view.name, tag);
      const png = await page.screenshot({ type: 'png' });
      await sharp(png).jpeg({ quality: JPEG_QUALITY }).toFile(file);
      console.log(`saved ${file}`);
    }
  } finally {
    await browser.close();
  }
}

/** Count pickable objects in the scene owned by `layerId` (any depth). */
function countLayerPrimitives(page, layerId) {
  return page.evaluate((id) => {
    const scene = window.__godsEyeView.viewer.scene;
    const owned = (object) => object?.id?.__localLayerId === id;
    const walk = (collection) => {
      let count = 0;
      for (let i = 0; i < (collection?.length ?? 0); i++) {
        const item = collection.get(i);
        if (owned(item)) count++;
        else if (item?.geometryInstances?.some?.((g) => owned(g))) count++;
        else if (typeof item?.get === 'function') count += walk(item);
      }
      return count;
    };
    return walk(scene.primitives) + walk(scene.groundPrimitives);
  }, layerId);
}

/** The window position of one visible tip of `layerId`, or null. */
function visibleTip(page, layerId) {
  return page.evaluate((id) => {
    const scene = window.__godsEyeView.viewer.scene;
    const canvas = scene.canvas.getBoundingClientRect();
    const find = (collection) => {
      for (let i = 0; i < (collection?.length ?? 0); i++) {
        const item = collection.get(i);
        if (item?.id?.__localLayerId === id && item.show && item.pixelSize) {
          const xy = scene.cartesianToCanvasCoordinates(item.position);
          if (xy && xy.x > 320 && xy.x < canvas.width - 40 && xy.y > 120)
            return { x: canvas.left + xy.x, y: canvas.top + xy.y };
        } else if (typeof item?.get === 'function') {
          const hit = find(item);
          if (hit) return hit;
        }
      }
      return null;
    };
    return find(scene.primitives);
  }, layerId);
}

/** Enable, click a tip, check the selected context, disable, check cleanup. */
async function smoke(argv) {
  const url = option(argv, 'url', 'http://localhost:4243');
  const layerId = option(argv, 'layer', 'local-datacenters');
  const pageErrors = [];
  const { browser, page } = await openApp(url, pageErrors);
  try {
    await enableOnly(page, layerId);
    await setView(page, VIEWS[layerId][1]);
    await settle(page);
    const tip = await visibleTip(page, layerId);
    if (!tip) throw new Error('no visible tip to click');
    await page.mouse.click(tip.x, tip.y);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const selected = await page.evaluate(
      () => window.__gevContextStore?.selectedEntityId ?? null,
    );
    const ownedWhileOn = await countLayerPrimitives(page, layerId);
    await page.evaluate(async (id) => {
      await window.__godsEyeView.dataManager.setEnabled(id, false, {
        origin: 'user',
      });
    }, layerId);
    await settle(page);
    const ownedWhileOff = await countLayerPrimitives(page, layerId);
    const result = { selected, ownedWhileOn, ownedWhileOff, pageErrors };
    console.log(JSON.stringify(result));
    const ok =
      String(selected).startsWith(`${layerId}:`) &&
      ownedWhileOn > 0 &&
      ownedWhileOff === 0 &&
      pageErrors.length === 0;
    if (!ok) throw new Error('smoke check failed');
    console.log('smoke ok');
  } finally {
    await browser.close();
  }
}

async function rawPixels(file) {
  const { data, info } = await sharp(file)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function compareOne(fileA, fileB) {
  const [a, b] = await Promise.all([rawPixels(fileA), rawPixels(fileB)]);
  if (a.width !== b.width || a.height !== b.height)
    throw new Error(`${fileA} and ${fileB} differ in size`);
  let changed = 0;
  let sumAbs = 0;
  for (let i = 0; i < a.data.length; i += 3) {
    const d = Math.max(
      Math.abs(a.data[i] - b.data[i]),
      Math.abs(a.data[i + 1] - b.data[i + 1]),
      Math.abs(a.data[i + 2] - b.data[i + 2]),
    );
    sumAbs += d;
    if (d > CHANNEL_THRESHOLD) changed++;
  }
  const pixels = a.width * a.height;
  return {
    changedPct: Number(((changed / pixels) * 100).toFixed(3)),
    meanAbs: Number((sumAbs / pixels).toFixed(3)),
  };
}

async function compare(argv) {
  const layerId = option(argv, 'layer', 'local-datacenters');
  const out = option(argv, 'out', 'qa-shots');
  const a = option(argv, 'a', 'before');
  const b = option(argv, 'b', 'after');
  for (const view of VIEWS[layerId] || []) {
    const result = await compareOne(
      shotPath(out, layerId, view.name, a),
      shotPath(out, layerId, view.name, b),
    );
    console.log(JSON.stringify({ layer: layerId, view: view.name, ...result }));
  }
}

const [command, ...rest] = process.argv.slice(2);
const COMMANDS = Object.freeze({ shoot, compare, smoke });
const run = COMMANDS[command];
if (!run) {
  console.error(
    'Usage: qa-local-geojson-shot.mjs shoot|compare|smoke [options]',
  );
  process.exitCode = 1;
} else {
  run(rest).catch((error) => {
    console.error(`[qa-local-geojson-shot] ${error.message}`);
    process.exitCode = 1;
  });
}
