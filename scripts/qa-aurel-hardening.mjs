/** Isolated accessibility/layout and repeated-owner resource checks; no live providers. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const mode = process.argv.includes('--stress-only') ? 'stress' : 'layout';
const output = path.resolve('docs/design/aurel/phase-5/evidence');
fs.mkdirSync(output, { recursive: true });
const checks = [],
  errors = [],
  blockedHosts = new Set(),
  apiAttempts = [];
const measurements = {};
const check = (name, pass, detail) => {
  checks.push({
    name,
    pass: Boolean(pass),
    ...(detail === undefined ? {} : { detail }),
  });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
};
const pause = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));
const panels = [
  ['explore', 'Lens', 'lens-panel'],
  ['library', 'Fieldbook', 'fieldbook-panel'],
  ['plan', 'Field planner', 'planner-panel'],
  ['compare', 'Chronicle', 'chronicle-panel'],
  ['compare', 'Research', 'research-panel'],
  ['library', 'Watchlists', 'watchlist-panel'],
  ['library', 'Offline region', 'region-panel'],
  ['library', 'Local commands', 'local-commands-panel'],
];
const browser = await puppeteer.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--no-sandbox'],
});
let page;
const report = () =>
  fs.writeFileSync(
    path.join(output, `hardening-${mode}.json`),
    JSON.stringify(
      {
        mode,
        generatedAt: new Date().toISOString(),
        scope:
          'Isolated Chromium profile. All external HTTP and every /api/ request blocked. Local coordinate fixtures and two empty local project fixtures exercise existing owners. This is not a live-source, populated-result, screen-reader or complete WCAG audit. Latencies are owner action through two animation frames, not FPS.',
        checks,
        errors,
        blockedHosts: [...blockedHosts],
        apiAttempts,
        measurements,
      },
      null,
      2,
    ),
  );
try {
  page = await browser.newPage();
  page.setDefaultTimeout(45000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !['localhost', '127.0.0.1'].includes(url.hostname)
    ) {
      blockedHosts.add(url.hostname);
      return request.abort();
    }
    if (url.pathname.startsWith('/api/')) {
      apiAttempts.push(url.pathname);
      return request.respond({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error:
            'Provider access intentionally blocked by isolated hardening QA',
        }),
      });
    }
    return request.continue();
  });
  await page.setViewport({ width: 1440, height: 900 });
  await page.emulateMediaFeatures([
    { name: 'prefers-reduced-motion', value: 'reduce' },
  ]);
  await page.goto(
    `${process.env.QA_BASE_URL || 'http://127.0.0.1:4173'}/?welcome=0#v=2&lat=30.3258&lon=78.0438&alt=1800000&map=offline-overview&l=`,
    { waitUntil: 'domcontentloaded', timeout: 90000 },
  );
  await page.waitForFunction(
    () =>
      window.__godsEyeView &&
      document.body.dataset.workspaceAppearance &&
      document.querySelector('#loading-screen')?.classList.contains('hidden') &&
      Number(
        getComputedStyle(document.querySelector('#loading-screen')).opacity,
      ) === 0,
    { timeout: 90000 },
  );
  await pause(1000);
  const open = async ([destination, label, id]) => {
    await page.evaluate(
      ({ destination, label }) => {
        document.querySelector(`[data-workspace="${destination}"]`).click();
        return Promise.resolve().then(() => {
          const button = [
            ...document.querySelectorAll('.workspace-tools button'),
          ].find((item) => item.textContent.trim().endsWith(label));
          if (!button) throw new Error(`Missing tool: ${label}`);
          button.click();
        });
      },
      { destination, label },
    );
    await page.waitForFunction(
      (id) => document.body.dataset.workspaceInspector === id,
      {},
      id,
    );
    await pause();
  };
  const fill = async (selector, value) =>
    page.$eval(
      selector,
      (input, value) => {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      },
      value,
    );
  // Coordinate parsing runs through the existing navigation/search owner, with no geocoder.
  await page.evaluate(async () => {
    await window.__godsEyeView.styleManager._locationControls.onSearch(
      '30.3258, 78.0438',
    );
    window.__godsEyeView.viewer.camera.cancelFlight();
  });
  if (mode === 'layout') {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
      { width: 667, height: 375 },
    ]) {
      await page.setViewport(viewport);
      await pause(500);
      for (const entry of panels) {
        const [, label, id] = entry;
        await open(entry);
        const geometry = await page.$eval(`#${id}`, (panel) => {
          const rect = panel.getBoundingClientRect(),
            style = getComputedStyle(panel);
          const scroller =
            panel.querySelector(`[class="${panel.id}-inner ui-scroll"]`) ||
            panel.querySelector(`.${panel.id}-inner`);
          const header = panel.querySelector('.ui-panel__head');
          const headerStyle = header ? getComputedStyle(header) : null;
          const controls = [
            ...panel.querySelectorAll(
              'button,input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]),select,textarea,summary',
            ),
          ].filter((element) => {
            const r = element.getBoundingClientRect();
            return (
              !element.disabled &&
              getComputedStyle(element).display !== 'none' &&
              r.width > 0 &&
              r.height > 0
            );
          });
          // Phone sheets own scrolling outside the panel; desktop panels scroll inside.
          let viewport = scroller || panel;
          for (
            let ancestor = panel.parentElement;
            ancestor;
            ancestor = ancestor.parentElement
          ) {
            const overflow = getComputedStyle(ancestor).overflowY;
            if (
              ['auto', 'scroll'].includes(overflow) &&
              ancestor.scrollHeight > ancestor.clientHeight + 2
            ) {
              viewport = ancestor;
              break;
            }
          }
          const viewportRect = viewport.getBoundingClientRect();
          const navigationTop =
            innerWidth <= 720
              ? document.querySelector('.workspace-nav').getBoundingClientRect()
                  .top
              : innerHeight;
          const reducedMotion = controls.every((element) => {
            const style = getComputedStyle(element);
            return (
              style.animationName === 'none' &&
              style.transitionDuration
                .split(',')
                .every((duration) => parseFloat(duration) <= 0.00001)
            );
          });
          const small = controls
            .filter((el) => el.getBoundingClientRect().height < 43)
            .map((el) => ({
              tag: el.tagName,
              id: el.id,
              text: el.textContent.trim().slice(0, 45),
              height: el.getBoundingClientRect().height,
            }));
          return {
            visible:
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              rect.width > 100 &&
              rect.height > 60 &&
              viewportRect.top >= 0 &&
              viewportRect.top < innerHeight &&
              viewportRect.bottom <= innerHeight + 2 &&
              viewportRect.bottom <= navigationTop + 1,
            documentOverflow: document.documentElement.scrollWidth > innerWidth,
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
            contentOverflow: scroller
              ? scroller.scrollWidth > scroller.clientWidth + 2
              : null,
            headerVisible: headerStyle?.display !== 'none',
            headerBackground: headerStyle?.backgroundColor,
            smallControls: small,
            navigationTop,
            reducedMotion,
            scrollOwner: {
              id: viewport.id,
              className: viewport.className,
              height: viewport.clientHeight,
              scrollHeight: viewport.scrollHeight,
              top: viewportRect.top,
              bottom: viewportRect.bottom,
            },
          };
        });
        const key = `${viewport.width}x${viewport.height} ${label}`;
        check(
          `${key}: inspector remains within the viewport without horizontal overflow`,
          geometry.visible &&
            !geometry.documentOverflow &&
            !geometry.contentOverflow,
          geometry,
        );
        const keyboard = await page.evaluate((id) => {
          const panel = document.getElementById(id);
          const target = [
            ...panel.querySelectorAll(
              'input:not([type="hidden"]),button,select,textarea,summary',
            ),
          ].find(
            (element) =>
              !element.disabled &&
              element.getBoundingClientRect().width > 0 &&
              element.getBoundingClientRect().height > 0,
          );
          target?.focus();
          return Boolean(target);
        }, id);
        await page.keyboard.press('Tab');
        const focus = await page.evaluate(() => {
          const element = document.activeElement,
            style = getComputedStyle(element),
            rect = element.getBoundingClientRect();
          return {
            tag: element.tagName,
            id: element.id,
            visibleFocus:
              element.matches(':focus-visible') &&
              ((parseFloat(style.outlineWidth) > 0 &&
                style.outlineStyle !== 'none') ||
                style.boxShadow !== 'none'),
            onScreen:
              rect.top >= 0 && rect.bottom <= innerHeight && rect.width > 0,
            animation: style.animationName,
            transition: style.transitionDuration,
          };
        });
        check(
          `${key}: keyboard focus is visible and reduced motion applies`,
          keyboard &&
            focus.visibleFocus &&
            focus.onScreen &&
            geometry.reducedMotion,
          focus,
        );
        const reach = await page.evaluate((id) => {
          const panel = document.getElementById(id);
          const controls = [
            ...panel.querySelectorAll(
              'button,input:not([type="hidden"]),select,textarea,summary',
            ),
          ].filter(
            (element) =>
              !element.disabled &&
              element.getBoundingClientRect().width > 0 &&
              element.getBoundingClientRect().height > 0,
          );
          const last = controls.at(-1);
          if (!last) return { reachable: true, reason: 'No enabled control' };
          last.scrollIntoView({ block: 'nearest' });
          const rect = last.getBoundingClientRect();
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          const topHit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + 2,
          );
          const bottomHit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.bottom - 2,
          );
          const belongsToControl = (element) =>
            last === element || last.contains(element);
          return {
            reachable:
              rect.top >= 0 &&
              rect.bottom <= innerHeight &&
              belongsToControl(hit) &&
              belongsToControl(topHit) &&
              belongsToControl(bottomHit),
            id: last.id,
            text: last.textContent.trim().slice(0, 60),
            top: rect.top,
            bottom: rect.bottom,
            hit: hit?.id || hit?.tagName,
          };
        }, id);
        check(
          `${key}: bottom controls remain reachable in the actual scroll owner`,
          reach.reachable,
          reach,
        );
        if (['research-panel', 'watchlist-panel', 'region-panel'].includes(id))
          await page.screenshot({
            path: path.join(output, `hardening-${id}-${viewport.width}.png`),
          });
      }
    }
  } else {
    await open(panels[1]);
    for (const title of ['QA local project A', 'QA local project B']) {
      await fill('#fieldbook-new-title', title);
      await page.$eval('.fieldbook-create-form', (form) =>
        form.requestSubmit(),
      );
      await page.waitForFunction(
        (title) => document.querySelector('#fieldbook-title')?.value === title,
        {},
        title,
      );
      await page.$eval('#fieldbook-save', (button) => button.click());
      await page.waitForFunction(
        (title) =>
          [...document.querySelectorAll('.fieldbook-project-list strong')].some(
            (item) => item.textContent === title,
          ) &&
          document.querySelector('.fieldbook-save-state')?.textContent ===
            'Saved',
        {},
        title,
      );
    }
    const cdp = await page.createCDPSession();
    await cdp.send('Performance.enable');
    const sample = async (iteration) => {
      await cdp.send('HeapProfiler.collectGarbage');
      const dom = await cdp.send('Memory.getDOMCounters');
      const perf = await cdp.send('Performance.getMetrics');
      const owners = await page.evaluate(() => {
        const app = window.__godsEyeView,
          viewer = app.viewer;
        return {
          entities: viewer.entities.values.length,
          dataSources: viewer.dataSources.length,
          imageryLayers: viewer.imageryLayers.length,
          primitives: viewer.scene.primitives.length,
          renderGovernor: app.getRenderGovernorDiagnostics(),
          resources: performance.getEntriesByType('resource').length,
          canvasCount: document.querySelectorAll('canvas').length,
          projectCount: document.querySelectorAll(
            '.fieldbook-project-list button',
          ).length,
        };
      });
      return {
        iteration,
        ...dom,
        heapUsedBytes: perf.metrics.find(
          (item) => item.name === 'JSHeapUsedSize',
        )?.value,
        owners,
      };
    };
    const cycle = async (index) =>
      page.evaluate(async (index) => {
        const frame = () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
        const coordinate = index % 2 ? '30.3258, 78.0438' : '30.3358, 78.0538';
        let start = performance.now();
        await window.__godsEyeView.styleManager._locationControls.onSearch(
          coordinate,
        );
        window.__godsEyeView.viewer.camera.cancelFlight();
        await frame();
        const locationMs = performance.now() - start;
        document.querySelector('[data-workspace="library"]').click();
        await frame();
        const title = index % 2 ? 'QA local project A' : 'QA local project B';
        const button = [
          ...document.querySelectorAll('.fieldbook-project-list button'),
        ].find((item) => item.querySelector('strong')?.textContent === title);
        start = performance.now();
        button.click();
        await new Promise((resolve, reject) => {
          const deadline = performance.now() + 5000;
          const tick = () => {
            if (
              document.querySelector('#fieldbook-title')?.value === title &&
              button.getAttribute('aria-pressed') === 'true'
            )
              return resolve();
            if (performance.now() > deadline)
              return reject(new Error('Project switch did not finish'));
            requestAnimationFrame(tick);
          };
          tick();
        });
        await frame();
        return { index, locationMs, projectMs: performance.now() - start };
      }, index);
    await cycle(0);
    await cycle(1);
    await pause(1000);
    measurements.samples = [await sample(0)];
    measurements.controls = [];
    for (let index = 0; index < 50; index++) {
      measurements.controls.push(await cycle(index));
      if ((index + 1) % 10 === 0)
        measurements.samples.push(await sample(index + 1));
    }
    const percentile = (key) =>
      [...measurements.controls].map((row) => row[key]).sort((a, b) => a - b)[
        Math.ceil(measurements.controls.length * 0.95) - 1
      ];
    measurements.p95 = {
      locationMs: percentile('locationMs'),
      projectMs: percentile('projectMs'),
    };
    const first = measurements.samples[0],
      last = measurements.samples.at(-1);
    measurements.delta = {
      nodes: last.nodes - first.nodes,
      jsEventListeners: last.jsEventListeners - first.jsEventListeners,
      documents: last.documents - first.documents,
      heapUsedBytes: last.heapUsedBytes - first.heapUsedBytes,
    };
    check(
      '50 coordinate and 50 saved-project switches completed through existing owners',
      measurements.controls.length === 50 && last.owners.projectCount === 2,
      measurements.p95,
    );
    check(
      'post-GC DOM and listener counts remain bounded after repeated switches',
      measurements.delta.nodes <= 300 &&
        measurements.delta.jsEventListeners <= 32 &&
        measurements.delta.documents <= 1,
      measurements.delta,
    );
    check(
      'globe resource owners do not accumulate layers or data sources',
      [
        'entities',
        'dataSources',
        'imageryLayers',
        'primitives',
        'canvasCount',
      ].every((key) => last.owners[key] <= first.owners[key]),
      { before: first.owners, after: last.owners },
    );
    check(
      'render diagnostics remain capped without accumulating continuous-render owners',
      last.owners.renderGovernor.recentRequests.length <= 64 &&
        last.owners.renderGovernor.holds.every((owner) =>
          first.owners.renderGovernor.holds.includes(owner),
        ),
      last.owners.renderGovernor,
    );
    check(
      'measured fixture control p95 remains below 250 ms',
      measurements.p95.locationMs < 250 && measurements.p95.projectMs < 250,
      measurements.p95,
    );
  }
  check('no uncaught page errors', errors.length === 0, errors);
  report();
  assert.ok(
    checks.every((item) => item.pass),
    'Hardening checks failed; inspect the evidence report.',
  );
} catch (error) {
  if (page)
    await page
      .screenshot({ path: path.join(output, `hardening-${mode}-failure.png`) })
      .catch(() => {});
  measurements.failure = error.stack;
  report();
  throw error;
} finally {
  await browser.close();
}
