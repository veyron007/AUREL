#!/usr/bin/env node
/** Rendered attribution clearance for AUREL's workspace geometry. */
import puppeteer from 'puppeteer';

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:4173';
const browser = await puppeteer.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--no-sandbox'],
});
const failures = [];
const cases = [
  { width: 1440, height: 900 },
  { width: 980, height: 700 },
  { width: 820, height: 500 },
  { width: 390, height: 844 },
  { width: 390, height: 650 },
  { width: 375, height: 667 },
  { width: 700, height: 500 },
  { width: 667, height: 375 },
];
const overlap = (a, b) =>
  Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 &&
  Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1;
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) =>
    failures.push(`page error: ${error.message}`),
  );
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !['127.0.0.1', 'localhost'].includes(url.hostname)
    )
      request.abort();
    else request.continue();
  });
  for (const { width, height } of cases) {
    await page.setViewport({ width, height });
    await page.goto(
      `${base}/?welcome=0#v=2&lat=30.3258&lon=78.0438&alt=30000&map=offline-overview&l=`,
      { waitUntil: 'networkidle2', timeout: 60000 },
    );
    await page.waitForFunction(
      () => {
        const curtain = document.getElementById('loading-screen');
        return (
          curtain?.classList.contains('hidden') &&
          Number(getComputedStyle(curtain).opacity) === 0
        );
      },
      { timeout: 90000 },
    );
    // The offline overview may not publish a Cesium credit before its first tile.
    // A representative line makes the existing fixed credit container measurable.
    await page.evaluate(() => {
      const credit = document.getElementById('cesium-credits');
      if (credit) {
        credit.textContent = 'Attribution geometry probe · Data attribution';
        credit.style.height = '28px';
      }
    });
    const states =
      width <= 720
        ? ['closed', 'half', 'collapsed', 'full']
        : ['closed', 'inspector'];
    for (const state of states) {
      if (state === 'half' || state === 'inspector')
        await page.click('[data-workspace="explore"]');
      if (state === 'collapsed' || state === 'full')
        await page.click(
          `#aurel-workspace-sheet-controls button[aria-label="${state === 'collapsed' ? 'Minimize inspector' : 'Full-height inspector'}"]`,
        );
      const sample = await page.evaluate(() => {
        const credit = document.getElementById('cesium-credits');
        const creditRect = credit?.getBoundingClientRect();
        const rect = (node) => {
          const r = node.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        };
        const blockers = [
          '#left-panel-stack',
          '#right-context-rail',
          '#command-dock',
          '#aurel-workspace-sheet-controls',
        ]
          .map((selector) => document.querySelector(selector))
          .filter(
            (node) =>
              node &&
              getComputedStyle(node).display !== 'none' &&
              getComputedStyle(node).visibility !== 'hidden' &&
              node.getClientRects().length,
          )
          .map((node) => ({ id: node.id, box: rect(node) }));
        return {
          visible: Boolean(
            credit &&
            creditRect?.width > 0 &&
            creditRect?.height > 0 &&
            getComputedStyle(credit).display !== 'none' &&
            getComputedStyle(credit).visibility !== 'hidden' &&
            Number(getComputedStyle(credit).opacity) > 0,
          ),
          credit: credit ? rect(credit) : null,
          blockers,
        };
      });
      const label = `${width}x${height} ${state}`;
      if (!sample.visible) failures.push(`${label}: attribution hidden`);
      if (
        sample.credit &&
        (sample.credit.left < 0 ||
          sample.credit.right > width ||
          sample.credit.top < 0 ||
          sample.credit.bottom > height)
      )
        failures.push(`${label}: attribution outside viewport`);
      for (const blocker of sample.blockers)
        if (sample.credit && overlap(sample.credit, blocker.box))
          failures.push(`${label}: attribution overlaps ${blocker.id}`);
      console.log(
        `[${failures.some((item) => item.startsWith(label)) ? 'FAIL' : 'PASS'}] ${label}`,
      );
    }
  }
} finally {
  await browser.close();
}
if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
}
