#!/usr/bin/env node
/**
 * Cold-start smoke for the split startup bundle (PERFORMANCE-PLAN.md Phase 2).
 *
 * Against a running app (QA_BASE_URL, default http://localhost:4173), each
 * check opens a fresh page, so every layer, panel, locale and theme is used
 * from a cold start, when its code has not been downloaded yet:
 *   - every layer is turned on through the layer API and off again;
 *   - a share link naming several layers restores all of them;
 *   - voice (`set_layer_visibility`) and the command palette's layer toggle
 *     turn on a layer that has not loaded;
 *   - every rail panel opens and renders a body;
 *   - every locale switches and renders translated text;
 *   - the four looks (Observatory, Field, Instrument, Cyber) apply, with a
 *     computed-style signature of the main surfaces printed per look.
 *   - replaying the Bhote Koshi media shot holds the shot for its clip.
 * `--only layers,share,voice,palette,panels,locales,looks,media` runs a subset.
 * Prints one JSON summary (`--json <file>` writes it too) and exits non-zero on
 * a page error or a failed check. Compare two builds by running it on each.
 */
import { writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';

const base = process.env.QA_BASE_URL || 'http://localhost:4173';
const jsonIndex = process.argv.indexOf('--json');
const jsonPath = jsonIndex > 0 ? process.argv[jsonIndex + 1] : null;
const VIEW = 'lat=30.3258&lon=78.0438&alt=1800000&map=offline-overview';
const SHARED_LAYERS = Object.freeze([
  'earthquakes',
  'wildlife-sightings',
  'bikeshare',
  'alpr-cameras',
  's2-ghostmaps',
  'telegeography-submarine-cables',
  'drone-airspace',
  'traffic',
  'cctv',
  'radio',
  'rocket-launches',
]);
const LAYER_TIMEOUT_MS = 45_000;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
const pageErrors = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), ...(detail ? { detail } : {}) });
  console.log(
    `${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` ${JSON.stringify(detail)}` : ''}`,
  );
}

const browser = await puppeteer.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--no-sandbox'],
});

async function open(label, { hash = `${VIEW}&l=`, query = '?welcome=0' } = {}) {
  const page = await browser.newPage();
  page.on('pageerror', (error) =>
    pageErrors.push({ label, message: error.message }),
  );
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${base}/${query}#v=2&${hash}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  });
  await page.waitForFunction(
    () =>
      window.__godsEyeView?.dataManager &&
      document.querySelector('#loading-screen')?.classList.contains('hidden'),
    { timeout: 90_000 },
  );
  await wait(1500);
  return page;
}

async function layerIds(page) {
  return page.evaluate(() =>
    window.__godsEyeView.dataManager.getAll().map((layer) => layer.id),
  );
}

async function toggleEveryLayer() {
  const page = await open('layers');
  const outcomes = {};
  for (const id of await layerIds(page)) {
    outcomes[id] = await page.evaluate(
      async (layerId, timeout) => {
        const manager = window.__godsEyeView.dataManager;
        const failures = [];
        const off = manager.subscribe((change) => {
          if (change.layerId === layerId && change.type === 'visibility-failed')
            failures.push(change.error?.message || String(change.error));
        });
        const enabled = await Promise.race([
          manager.setEnabled(layerId, true, { origin: 'user' }),
          new Promise((resolve) =>
            setTimeout(() => resolve('timeout'), timeout),
          ),
        ]);
        const on = manager.isEnabled(layerId);
        await manager.setEnabled(layerId, false, { origin: 'user' });
        off();
        return { enabled, on, failures };
      },
      id,
      LAYER_TIMEOUT_MS,
    );
  }
  await page.close();
  const turnedOn = Object.entries(outcomes).filter(([, value]) => value.on);
  check('layers turn on from cold start', turnedOn.length > 0, {
    on: turnedOn.length,
    total: Object.keys(outcomes).length,
  });
  return outcomes;
}

async function shareLinkRestores() {
  const author = await open('share-author');
  await author.evaluate(async (ids) => {
    const manager = window.__godsEyeView.dataManager;
    for (const id of ids)
      await manager.setEnabled(id, true, { origin: 'user' });
  }, SHARED_LAYERS);
  await wait(1500);
  const hash = await author.evaluate(() => location.hash.slice(1));
  await author.close();
  const reader = await open('share-reader', { hash });
  const restored = await reader
    .waitForFunction(
      (ids) =>
        ids.every((id) => window.__godsEyeView.dataManager.isEnabled(id)),
      { timeout: LAYER_TIMEOUT_MS },
      SHARED_LAYERS,
    )
    .then(() => true)
    .catch(() => false);
  const state = await reader.evaluate(
    (ids) =>
      Object.fromEntries(
        ids.map((id) => [id, window.__godsEyeView.dataManager.isEnabled(id)]),
      ),
    SHARED_LAYERS,
  );
  await reader.close();
  check('a share link with several layers restores them all', restored, state);
}

async function voiceEnablesColdLayer() {
  const page = await open('voice');
  const result = await page.evaluate(async () => {
    const app = window.__godsEyeView;
    const outcome = await app.voiceCommands.runner('set_layer_visibility', {
      layerId: 'bikeshare',
      enabled: true,
    });
    return {
      outcome: JSON.parse(JSON.stringify(outcome ?? null)),
      on: app.dataManager.isEnabled('bikeshare'),
    };
  });
  await page.close();
  check('voice turns on a layer that has not loaded', result.on, result);
}

async function paletteEnablesColdLayer() {
  const page = await open('palette');
  await page.keyboard.down('Control');
  await page.keyboard.press('k');
  await page.keyboard.up('Control');
  const opened = await page
    .waitForSelector('.command-palette input', { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  await page.keyboard.type('Wildlife');
  await wait(800);
  const row = await page.evaluate(() => {
    const match = [...document.querySelectorAll('.command-palette-row')].find(
      (option) => /Wildlife Sightings/.test(option.textContent),
    );
    match?.click();
    return match?.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) ?? null;
  });
  const on = await page
    .waitForFunction(
      () => window.__godsEyeView.dataManager.isEnabled('wildlife-sightings'),
      { timeout: LAYER_TIMEOUT_MS },
    )
    .then(() => true)
    .catch(() => false);
  await page.close();
  check('the command palette turns on a layer that has not loaded', on, {
    opened,
    row,
  });
}

// A panel opened while start-up is still running, before its body's code has
// loaded, ends with the same text and height as one opened later.
async function earlyPanelOpens(panelId = 'planner-panel') {
  const measure = (id) => {
    const element = document.getElementById(id);
    return {
      open: Boolean(element && !element.classList.contains('collapsed')),
      height: Math.round(element?.getBoundingClientRect().height ?? 0),
      text: (element?.textContent ?? '').replace(/\s+/g, ' ').trim().length,
    };
  };
  const late = await open('panel-late');
  await late.evaluate((id) => {
    window.__godsEyeView.styleManager._panelNavigation.openPanel(id);
  }, panelId);
  await wait(1500);
  const expected = await late.evaluate(measure, panelId);
  await late.close();
  const page = await browser.newPage();
  page.on('pageerror', (error) =>
    pageErrors.push({ label: 'panel-early', message: error.message }),
  );
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${base}/?welcome=0#v=2&${VIEW}&l=`, {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  });
  await page.waitForFunction(
    () => window.__godsEyeView?.styleManager?._panelNavigation,
    { timeout: 90_000, polling: 20 },
  );
  const placeholder = await page.evaluate((id) => {
    window.__godsEyeView.styleManager._panelNavigation.openPanel(id);
    return Boolean(
      document.querySelector(`#${id} .deferred-panel-body[aria-busy]`),
    );
  }, panelId);
  await page.waitForFunction(
    () =>
      document.querySelector('#loading-screen')?.classList.contains('hidden'),
    { timeout: 90_000 },
  );
  await wait(1500);
  const restored = await page.evaluate(measure, panelId);
  await page.close();
  check(
    'a panel opened during start-up shows its full body and height',
    expected.open &&
      restored.open &&
      restored.text === expected.text &&
      restored.height === expected.height,
    { placeholder, expected, restored },
  );
}

async function everyPanelOpens() {
  const page = await open('panels');
  const panels = await page.evaluate(async () => {
    const navigation = window.__godsEyeView.styleManager._panelNavigation;
    const offered = [
      ...navigation._store.sides.left,
      ...navigation._store.sides.right,
    ].filter((panel) => panel.available);
    const seen = {};
    for (const { id } of offered) {
      navigation.openPanel(id);
      await new Promise((resolve) => setTimeout(resolve, 700));
      const element = document.getElementById(id);
      const box = element?.getBoundingClientRect();
      seen[id] = {
        open: Boolean(element && !element.classList.contains('collapsed')),
        height: Math.round(box?.height ?? 0),
        text: (element?.textContent ?? '').replace(/\s+/g, ' ').trim().length,
      };
    }
    return seen;
  });
  await page.close();
  const failed = Object.entries(panels).filter(
    ([, panel]) => !panel.open || panel.height < 40 || panel.text < 10,
  );
  check('every panel opens and renders its body', failed.length === 0, {
    panels: Object.keys(panels).length,
    failed: Object.fromEntries(failed),
  });
  return panels;
}

async function everyLocaleRenders() {
  const page = await open('locales');
  const locales = await page.evaluate(async () => {
    const shell = window.__godsEyeView.styleManager;
    const sample = () =>
      [...document.querySelectorAll('.workspace-nav button, .panel-title')]
        .map((element) => element.textContent.trim())
        .filter(Boolean)
        .slice(0, 6)
        .join(' | ');
    const english = sample();
    const codes = [
      'ar',
      'de',
      'es',
      'fr',
      'it',
      'ja',
      'pt',
      'ru',
      'uk',
      'zh-CN',
      'zh-Hant',
      'en',
    ];
    const seen = {};
    for (const code of codes) {
      shell._chooseLocale(code);
      const deadline = Date.now() + 15_000;
      while (document.documentElement.lang !== code && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 100));
      await new Promise((resolve) => setTimeout(resolve, 400));
      const text = sample();
      seen[code] = {
        lang: document.documentElement.lang,
        dir: document.documentElement.dir,
        translated: code === 'en' ? text === english : text !== english,
        text,
      };
    }
    return seen;
  });
  await page.close();
  const failed = Object.entries(locales).filter(
    ([code, value]) => value.lang !== code || !value.translated,
  );
  check('every locale switches and renders', failed.length === 0, {
    failed: Object.fromEntries(failed),
  });
  return locales;
}

const STYLE_TARGETS = Object.freeze([
  'body',
  '.workspace-nav',
  '.workspace-nav button',
  '#aurel-search',
  '#data-panel',
  '#data-panel .panel-title',
  '#pp-toggles',
  '#intel-hud',
  '.command-dock',
]);
const STYLE_PROPERTIES = Object.freeze([
  'color',
  'background-color',
  'background-image',
  'border-top-color',
  'border-radius',
  'box-shadow',
  'backdrop-filter',
  'font-family',
  'font-size',
  'font-weight',
  'letter-spacing',
  'opacity',
  'width',
  'height',
]);

async function styleSignature(page) {
  return page.evaluate(
    (targets, properties) =>
      Object.fromEntries(
        targets.map((selector) => {
          const element = document.querySelector(selector);
          if (!element) return [selector, null];
          const style = getComputedStyle(element);
          return [
            selector,
            Object.fromEntries(
              properties.map((name) => [name, style.getPropertyValue(name)]),
            ),
          ];
        }),
      ),
    STYLE_TARGETS,
    STYLE_PROPERTIES,
  );
}

async function everyLookApplies() {
  const looks = {};
  for (const appearance of ['observatory', 'field', 'instrument']) {
    const page = await open(`look-${appearance}`);
    await page.evaluate((id) => {
      const select = document.querySelector('.workspace-appearance select');
      select.value = id;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, appearance);
    await wait(800);
    const applied = await page.evaluate(
      () => document.body.dataset.workspaceAppearance,
    );
    looks[appearance] = { applied, styles: await styleSignature(page) };
    await page.close();
  }
  const page = await open('look-cyber');
  await page.evaluate(() =>
    window.__godsEyeView.styleManager.setHudLayout('cyber'),
  );
  await page
    .waitForFunction(
      () =>
        [...document.styleSheets].some((sheet) =>
          /cyber[^/]*\.css/.test(sheet.href ?? ''),
        ) || document.querySelector('style[data-vite-dev-id*="cyber"]'),
      { timeout: 15_000 },
    )
    .catch(() => {});
  await wait(800);
  looks.cyber = {
    applied: await page.evaluate(
      () => document.documentElement.dataset.uiTheme,
    ),
    styles: await styleSignature(page),
  };
  await page.close();
  check(
    'every look applies',
    ['observatory', 'field', 'instrument'].every(
      (id) => looks[id].applied === id,
    ) && looks.cyber.applied === 'cyber',
    Object.fromEntries(
      Object.entries(looks).map(([id, look]) => [id, look.applied]),
    ),
  );
  check(
    'Cyber restyles the shell',
    JSON.stringify(looks.cyber.styles) !==
      JSON.stringify(looks.observatory.styles),
  );
  return looks;
}

const MEDIA_BEAT = 'immediate-collapse-viewpoint';

// Replaying the Bhote Koshi evidence shot from a cold start grants the event
// layer its media owner before the shot enables it (and before its code has
// loaded); only an owned shot autoplays its clip.
async function bhoteKoshiMediaPlays() {
  const page = await open('bhote-koshi-media');
  const result = await page.evaluate(
    async (beatId, timeout) => {
      const app = window.__godsEyeView;
      const director = app.sceneDirector;
      await director.ready?.();
      const isMediaShot = (shot) =>
        shot.sourcePackId &&
        shot.layers?.['bhote-koshi-2026']?.params?.beatId === beatId;
      const scene = director
        .getProjectSnapshot()
        .scenes.find((candidate) => candidate.shots.some(isMediaShot));
      const shot = scene?.shots.find(isMediaShot);
      if (!shot) return { found: false };
      void director.replayShot(scene.id, shot.id);
      const autoplaying = () =>
        [...document.querySelectorAll('iframe, video')].some(
          (element) =>
            /[?&]autoplay=1/.test(element.src || '') ||
            (element.tagName === 'VIDEO' && !element.paused),
        );
      const deadline = Date.now() + timeout;
      let playing = false;
      while (Date.now() < deadline && !playing) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        playing = autoplaying();
      }
      director.stopScene();
      return {
        found: true,
        enabled: app.dataManager.isEnabled('bhote-koshi-2026'),
        playing,
      };
    },
    MEDIA_BEAT,
    LAYER_TIMEOUT_MS,
  );
  await page.close();
  check(
    'Bhote Koshi evidence media autoplays from a cold start',
    result.found && result.playing,
    result,
  );
}

const onlyIndex = process.argv.indexOf('--only');
const only = onlyIndex > 0 ? process.argv[onlyIndex + 1].split(',') : null;
const want = (name) => !only || only.includes(name);
const summary = {};
try {
  if (want('layers')) summary.layers = await toggleEveryLayer();
  if (want('share')) await shareLinkRestores();
  if (want('voice')) await voiceEnablesColdLayer();
  if (want('palette')) await paletteEnablesColdLayer();
  if (want('panels')) summary.panels = await everyPanelOpens();
  if (want('panels')) await earlyPanelOpens();
  if (want('locales')) summary.locales = await everyLocaleRenders();
  if (want('looks')) summary.looks = await everyLookApplies();
  if (want('media')) await bhoteKoshiMediaPlays();
} finally {
  await browser.close();
}
check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 10));
summary.results = results;
summary.pageErrors = pageErrors;
if (jsonPath) writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
const failed = results.filter((result) => !result.pass);
console.log(`${results.length - failed.length}/${results.length} checks pass`);
process.exitCode = failed.length ? 1 : 0;
