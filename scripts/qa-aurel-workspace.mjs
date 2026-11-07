/** AUREL workspace acceptance: isolated browser storage; external requests blocked. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const output = path.resolve(
  process.env.QA_OUTPUT || 'docs/design/aurel/phase-1/evidence',
);
fs.mkdirSync(output, { recursive: true });
const browser = await puppeteer.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--no-sandbox'],
});
const results = [];
const errors = [];
const external = new Set();
const check = (name, value, detail) => {
  results.push({ name, pass: Boolean(value), ...(detail && { detail }) });
  console.log(`${value ? 'PASS' : 'FAIL'} ${name}`);
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 350));
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept('Dehradun acceptance'));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !['localhost', '127.0.0.1'].includes(url.hostname)
    ) {
      external.add(url.hostname);
      request.abort();
    } else request.continue();
  });
  await page.setViewport({ width: 1440, height: 900 });
  const base = process.env.QA_BASE_URL || 'http://127.0.0.1:4173';
  const url = `${base}/?welcome=0#v=2&lat=30.3258&lon=78.0438&alt=1800000&map=offline-overview&l=`;
  const ready = () =>
    page.waitForFunction(
      () =>
        window.__godsEyeView &&
        document.body.dataset.workspaceAppearance &&
        document
          .querySelector('#loading-screen')
          ?.classList.contains('hidden') &&
        Number(
          getComputedStyle(document.querySelector('#loading-screen')).opacity,
        ) === 0,
      { timeout: 90000 },
    );
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await ready();
  await settle();
  const visible = (selector) =>
    page.$eval(selector, (el) => {
      const r = el.getBoundingClientRect();
      return (
        r.width > 0 &&
        r.height > 0 &&
        getComputedStyle(el).visibility !== 'hidden'
      );
    });
  check(
    'persistent search is visible before opening a tray',
    await visible('#location-search'),
  );
  await page.click('#reset-globe-view');
  await new Promise((resolve) => setTimeout(resolve, 1800));
  await page.screenshot({ path: path.join(output, 'observatory-desktop.png') });
  await page.setViewport({ width: 1280, height: 720 });
  await settle();
  await page.screenshot({ path: path.join(output, 'observatory-laptop.png') });
  await page.setViewport({ width: 1440, height: 900 });
  await settle();
  await page.focus('#location-search');
  await page.keyboard.type('30.3258, 78.0438');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () =>
      !document
        .querySelector('#location-search')
        ?.classList.contains('searching'),
    { timeout: 20000 },
  );
  check(
    'coordinate search completes without external services',
    !(await page.$eval('#location-search-error', (el) =>
      el.textContent.trim(),
    )),
  );
  await page.click('#reset-globe-view');
  await new Promise((resolve) => setTimeout(resolve, 1800));
  for (const destination of ['explore', 'compare', 'plan', 'library']) {
    await page.click(`[data-workspace="${destination}"]`);
    await settle();
    const state = await page.evaluate(() => ({
      destination: document.body.dataset.workspaceDestination,
      open: [
        ...document.querySelectorAll(
          '#left-panel-stack > [data-panel-id], #right-context-rail > [data-panel-id]',
        ),
      ]
        .filter((el) => !el.classList.contains('collapsed') && !el.hidden)
        .map((el) => el.id),
    }));
    check(
      `${destination} opens one existing inspector`,
      state.destination === destination && state.open.length === 1,
      state,
    );
  }
  await page.evaluate(() =>
    [...document.querySelectorAll('.workspace-tools button')]
      .find((button) => button.textContent.trim().endsWith('AUTHORING'))
      ?.click(),
  );
  await settle();
  await page.click('#scene-new-btn');
  await settle();
  await page.click('#scene-capture-btn');
  await settle();
  check(
    'existing scene capture works from Library',
    await page.$$eval(
      '#scene-shot-list [data-scene-shot-id]',
      (rows) => rows.length > 0,
    ),
  );
  await page.screenshot({ path: path.join(output, 'library-desktop.png') });
  const before = await page.evaluate(() => ({
    style: document.querySelector('#active-style-name')?.textContent,
    hash: location.hash,
  }));
  await page.select('.workspace-appearance select', 'field');
  await settle();
  const after = await page.evaluate(() => ({
    style: document.querySelector('#active-style-name')?.textContent,
    hash: location.hash,
  }));
  check(
    'appearance preserves visual style and share state',
    JSON.stringify(before) === JSON.stringify(after),
  );
  await page.screenshot({ path: path.join(output, 'field-desktop.png') });
  await page.reload({ waitUntil: 'networkidle2' });
  await ready();
  check(
    'appearance restores after reload',
    await page.$eval(
      '.workspace-appearance select',
      (el) => el.value === 'field',
    ),
  );
  await page.click('[data-workspace="library"]');
  await settle();
  await page.evaluate(() =>
    [...document.querySelectorAll('.workspace-tools button')]
      .find((button) => button.textContent.trim().endsWith('AUTHORING'))
      ?.click(),
  );
  await settle();
  const savedScene = await page.$$eval(
    '#scene-select option',
    (options) =>
      options.find((option) =>
        option.textContent.includes('Dehradun acceptance'),
      )?.value,
  );
  check('captured project remains available after reload', Boolean(savedScene));
  if (savedScene) {
    await page.select('#scene-select', savedScene);
    await settle();
  }
  await page.select('.workspace-appearance select', 'instrument');
  await settle();
  await page.screenshot({ path: path.join(output, 'instrument-desktop.png') });
  await page.select('.workspace-appearance select', 'observatory');
  await page.setViewport({ width: 390, height: 844 });
  await settle();
  await page.click('[data-workspace="library"]');
  await settle();
  check(
    'phone task navigation retains visible keyboard focus',
    await page.evaluate(() =>
      document.activeElement?.matches('[data-workspace="library"]'),
    ),
  );
  const heights = {};
  for (const size of ['collapsed', 'half', 'full']) {
    await page.click(
      `.workspace-sheet-controls button[aria-label="${{ collapsed: 'Minimize inspector', half: 'Half-height inspector', full: 'Full-height inspector' }[size]}"]`,
    );
    await settle();
    heights[size] = await page.$eval(
      '#left-panel-stack',
      (el) => el.getBoundingClientRect().height,
    );
  }
  check(
    'phone inspector offers three distinct sizes',
    heights.collapsed < heights.half && heights.half < heights.full,
    heights,
  );
  check('phone search stays reachable', await visible('#location-search'));
  check(
    'sheet resizing preserves captured scene',
    await page.$$eval(
      '#scene-shot-list [data-scene-shot-id]',
      (rows) => rows.length > 0,
    ),
  );
  await page.click(
    '.workspace-sheet-controls button[aria-label="Half-height inspector"]',
  );
  await settle();
  await page.screenshot({ path: path.join(output, 'observatory-mobile.png') });
  await page.emulateMediaFeatures([
    { name: 'prefers-reduced-motion', value: 'reduce' },
  ]);
  await page.setViewport({ width: 720, height: 450 });
  await settle();
  await page.screenshot({ path: path.join(output, 'zoom-equivalent.png') });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  check('720px layout has no document horizontal overflow', !overflow);
  await page.setViewport({ width: 667, height: 375 });
  await settle();
  await page.screenshot({ path: path.join(output, 'landscape.png') });
  const sizeControlsReachable = await page.$$eval(
    '.workspace-sheet-controls button',
    (buttons) =>
      buttons.every((button) => {
        const r = button.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2,
        );
        return (
          r.width >= 44 &&
          r.height >= 44 &&
          (hit === button || button.contains(hit))
        );
      }),
  );
  check(
    'short-screen inspector sizing controls are unobscured touch targets',
    sizeControlsReachable,
  );
  await page.setViewport({ width: 1440, height: 900 });
  await settle();
  await page.focus('[data-workspace="plan"]');
  await page.keyboard.press('Enter');
  await settle();
  check(
    'keyboard activates Plan',
    await page.evaluate(
      () => document.body.dataset.workspaceInspector === 'utilities-panel',
    ),
  );
  check(
    'focused destination has a visible focus outline',
    await page.$eval(
      '[data-workspace="plan"]',
      (el) => getComputedStyle(el).outlineStyle !== 'none',
    ),
  );
  await page.evaluate(() =>
    window.__godsEyeView.styleManager._locationControls.setSearchError(
      'No matching place. Try coordinates.',
    ),
  );
  await page.screenshot({ path: path.join(output, 'search-error.png') });
  check(
    'search errors are associated with the field',
    await page.$eval(
      '#location-search',
      (el) =>
        el.getAttribute('aria-invalid') === 'true' &&
        el.getAttribute('aria-describedby') === 'location-search-error',
    ),
  );
  await page.evaluate(() =>
    window.__godsEyeView.styleManager._locationControls.setSearchError(null),
  );
  await page.evaluate(() => {
    const manager = window.__godsEyeView.styleManager;
    manager.setPanelCollapsed('data-panel', false, {
      restore: true,
      persist: false,
      syncShare: false,
    });
    manager.setPanelCollapsed('pp-toggles', false, {
      restore: true,
      persist: false,
      syncShare: false,
    });
  });
  await settle();
  const restored = await page.evaluate(() => {
    const ids = ['data-panel', 'pp-toggles'];
    // Responsive layout may mark a restored panel accordion-collapsed while
    // retaining the user's expanded preference. Inspect the same canonical
    // capture the share-link provider uses, rather than presentation classes.
    const shared = window.__godsEyeView.styleManager._buildSharePanelState();
    const preferences = ids.map((id) =>
      shared.specs.find((entry) => entry.id === id),
    );
    return {
      open: preferences.every((entry) => entry?.collapsed === false),
      preferences,
      presentation: ids.map((id) => ({
        id,
        classes: document.getElementById(id).className,
      })),
      visible: [
        ...document.querySelectorAll(
          '#left-panel-stack > [data-panel-id], #right-context-rail > [data-panel-id]',
        ),
      ].filter(
        (el) =>
          !el.classList.contains('collapsed') &&
          el.getBoundingClientRect().width > 0,
      ).length,
    };
  });
  check(
    'legacy open panels remain stored while only one inspector paints',
    restored.open && restored.visible === 1,
    restored,
  );
  const policy = await page.evaluate(async () =>
    (await fetch('/api/free-only/status')).json(),
  );
  check('Free-only remains active', policy.freeOnly === true);
  check(
    'no paid browser host attempted',
    ![...external].some((host) =>
      /googleapis|openai|generativelanguage|tomtom|api\.cesium/.test(host),
    ),
    [...external],
  );
  check('no runtime errors', errors.length === 0, errors);
} finally {
  fs.writeFileSync(
    path.join(output, 'checks.json'),
    JSON.stringify({ results, errors, externalHosts: [...external] }, null, 2) +
      '\n',
  );
  await browser.close();
}
assert.ok(
  results.every((result) => result.pass),
  'Workspace browser acceptance failed; see evidence/checks.json',
);
