#!/usr/bin/env node
/**
 * qa-phase4a-smoke — browser smoke for the Phase 4A rendering changes on a
 * served build: submarine cables and radio (enable, click a marker, check
 * the layer's own response, disable, check its primitives are gone) and the
 * traffic flow-decode worker (decode a fixture tile in the built worker).
 * Datacenters and dams have their own smoke in qa-local-geojson-shot.mjs.
 *
 *   node scripts/qa-phase4a-smoke.mjs --url http://localhost:4241
 *
 * Exits non-zero when any check fails or the page raised an error.
 */
import puppeteer from 'puppeteer';
import { readdirSync } from 'node:fs';
import { FIRST_RUN_STORAGE_KEY } from '../src/firstRunExperience.js';
import { trafficFixtureTile } from './traffic-fixtures.mjs';

const VIEWPORT = Object.freeze({ width: 1440, height: 900 });
const url = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://localhost:4241';

async function openApp(pageErrors) {
  const browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 300_000,
    args: [
      ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []),
      '--enable-gpu',
      '--ignore-gpu-blocklist',
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
  await new Promise((resolve) => setTimeout(resolve, 6_000));
  return { browser, page };
}

function setLayer(page, id, enabled) {
  return page.evaluate(
    (layerId, on) =>
      window.__godsEyeView.dataManager.setEnabled(layerId, on, {
        origin: 'user',
      }),
    id,
    enabled,
  );
}

function setView(page, { lon, lat, height }) {
  return page.evaluate(
    (v) => {
      const viewer = window.__godsEyeView.viewer;
      viewer.camera.cancelFlight();
      viewer.camera.setView({
        destination: viewer.scene.globe.ellipsoid.cartographicToCartesian({
          longitude: (v.lon * Math.PI) / 180,
          latitude: (v.lat * Math.PI) / 180,
          height: v.height,
        }),
      });
    },
    { lon, lat, height },
  );
}

async function settle(page, frames = 120) {
  await page.evaluate(
    (count) =>
      new Promise((resolve) => {
        let ticks = 0;
        const tick = () => {
          window.__godsEyeView.viewer.scene.requestRender();
          if (++ticks < count) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      }),
    frames,
  );
}

/** Window position of a shown point primitive whose id matches `prefix`. */
function visiblePoint(page, prefix) {
  return page.evaluate((idPrefix) => {
    const scene = window.__godsEyeView.viewer.scene;
    const rect = scene.canvas.getBoundingClientRect();
    const matches = (item) => {
      const id = item?.id?.id ?? item?.id;
      return typeof id === 'string' && id.startsWith(idPrefix);
    };
    const find = (collection) => {
      for (let i = 0; i < (collection?.length ?? 0); i++) {
        const item = collection.get(i);
        if (matches(item) && item.show && item.pixelSize && item.position) {
          const xy = scene.cartesianToCanvasCoordinates(item.position);
          if (
            xy &&
            xy.x > 320 &&
            xy.x < rect.width - 60 &&
            xy.y > 140 &&
            xy.y < rect.height - 140
          )
            return { x: rect.left + xy.x, y: rect.top + xy.y };
        } else if (typeof item?.get === 'function') {
          const hit = find(item);
          if (hit) return hit;
        } else if (item?._pointCollection) {
          const hit = find(item._pointCollection);
          if (hit) return hit;
        }
      }
      return null;
    };
    return find(scene.primitives);
  }, prefix);
}

/** Count primitives anywhere in the scene that carry ids with `prefix`. */
function countOwned(page, prefix) {
  return page.evaluate((idPrefix) => {
    const scene = window.__godsEyeView.viewer.scene;
    const owned = (id) => typeof id === 'string' && id.startsWith(idPrefix);
    const walk = (collection) => {
      let count = 0;
      for (let i = 0; i < (collection?.length ?? 0); i++) {
        const item = collection.get(i);
        if (owned(item?.id)) count++;
        else if (item?.geometryInstances?.some?.((g) => owned(g.id))) count++;
        else if (typeof item?.get === 'function') count += walk(item);
      }
      return count;
    };
    return walk(scene.primitives) + walk(scene.groundPrimitives);
  }, prefix);
}

function cameraKey(page) {
  return page.evaluate(() => {
    const p = window.__godsEyeView.viewer.camera.positionWC;
    return `${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}`;
  });
}

async function cablesSmoke(page) {
  await setLayer(page, 'telegeography-submarine-cables', true);
  await setView(page, { lon: -73.5, lat: 40.4, height: 500_000 });
  await settle(page);
  const ownedOn = await countOwned(page, 'gev-cable:');
  const tip = await visiblePoint(page, 'gev-cable:ref:');
  if (!tip) throw new Error('cables: no visible reference tip');
  const before = await cameraKey(page);
  await page.mouse.click(tip.x, tip.y);
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const flew = (await cameraKey(page)) !== before;
  await setLayer(page, 'telegeography-submarine-cables', false);
  await settle(page, 30);
  const ownedOff = await countOwned(page, 'gev-cable:');
  return { ok: ownedOn > 0 && flew && ownedOff === 0, ownedOn, flew, ownedOff };
}

async function radioSmoke(page) {
  await setLayer(page, 'radio', true);
  await setView(page, { lon: 2.35, lat: 48.85, height: 400_000 });
  await page.waitForFunction(
    () =>
      window.__godsEyeView.dataManager.layers
        .get('radio')
        ?.module?.getUIState?.()?.stationCount > 0,
    { timeout: 60_000 },
  );
  await settle(page);
  const marker = await visiblePoint(page, 'radio:');
  if (!marker) throw new Error('radio: no visible station marker');
  await page.mouse.click(marker.x, marker.y);
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const selected = await page.evaluate(
    () =>
      window.__godsEyeView.dataManager.layers.get('radio').module.getUIState()
        .selected?.id ?? null,
  );
  const sourcesOn = await page.evaluate(
    () =>
      window.__godsEyeView.viewer.dataSources.getByName('Radio stations')
        .length,
  );
  await setLayer(page, 'radio', false);
  await settle(page, 30);
  const sourcesOff = await page.evaluate(
    () =>
      window.__godsEyeView.viewer.dataSources.getByName('Radio stations')
        .length,
  );
  return {
    ok: Boolean(selected) && sourcesOn === 1 && sourcesOff === 0,
    selected,
    sourcesOn,
    sourcesOff,
  };
}

async function trafficWorkerSmoke(page) {
  const worker = readdirSync(new URL('../dist/assets', import.meta.url)).find(
    (name) => name.startsWith('flowDecode.worker-'),
  );
  if (!worker) throw new Error('traffic: no built flow-decode worker');
  const bytes = Array.from(trafficFixtureTile(12, true));
  return page.evaluate(
    (path, tile) =>
      new Promise((resolve) => {
        const w = new Worker(path, { type: 'module' });
        w.onmessage = (event) => {
          w.terminate();
          const reply = event.data;
          resolve({
            ok: reply.ok === true && reply.segments.length > 0,
            segments: reply.segments?.length ?? 0,
          });
        };
        w.onerror = (event) => resolve({ ok: false, error: event.message });
        w.postMessage({
          id: 1,
          bytes: new Uint8Array(tile),
          z: 12,
          x: 935,
          y: 1686,
        });
      }),
    `/assets/${worker}`,
    bytes,
  );
}

const pageErrors = [];
const { browser, page } = await openApp(pageErrors);
try {
  const results = {
    cables: await cablesSmoke(page),
    radio: await radioSmoke(page),
    trafficWorker: await trafficWorkerSmoke(page),
    pageErrors,
  };
  console.log(JSON.stringify(results, null, 2));
  const ok =
    results.cables.ok &&
    results.radio.ok &&
    results.trafficWorker.ok &&
    pageErrors.length === 0;
  if (!ok) process.exitCode = 1;
  else console.log('smoke ok');
} finally {
  await browser.close();
}
