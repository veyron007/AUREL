/** Real offline browser workflow; isolated profile, never the owner's saved keys. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const output = path.resolve('docs/design/aurel/phase-2/evidence');
fs.mkdirSync(output, { recursive: true });
const browser = await puppeteer.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--no-sandbox'],
});
const checks = [];
const errors = [];
const hosts = new Set();
const check = (name, pass) => {
  checks.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 400));
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !['localhost', '127.0.0.1'].includes(url.hostname)
    ) {
      hosts.add(url.hostname);
      request.abort();
    } else request.continue();
  });
  const cdp = await page.createCDPSession();
  await cdp.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: output,
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
  const clickText = async (root, text) => {
    const found = await page.evaluate(
      (root, text) => {
        const button = [...document.querySelectorAll(`${root} button`)].find(
          (el) => el.textContent.trim() === text && !el.disabled,
        );
        if (!button) return false;
        button.click();
        return true;
      },
      root,
      text,
    );
    assert.ok(found, `Button available: ${text}`);
    await settle();
  };
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(
    'http://127.0.0.1:4173/?welcome=0#v=2&lat=30.3258&lon=78.0438&alt=1800000&map=offline-overview&l=',
    { waitUntil: 'domcontentloaded', timeout: 90000 },
  );
  await ready();
  await page.evaluate(() => {
    window.__qaSearch = [];
    window.__godsEyeView.styleManager.subscribeLocationSearch((packet) =>
      window.__qaSearch.push(packet),
    );
  });
  await page.click('[data-workspace="explore"]');
  await page.click('#location-search', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type('#location-search', '30.3258, 78.0438');
  await page.keyboard.press('Enter');
  try {
    await page.waitForSelector('#lens-save-place');
  } catch (error) {
    console.log(
      JSON.stringify(
        await page.evaluate(() => ({
          search: window.__qaSearch,
          lens: document.querySelector('#lens-panel')?.textContent,
          error: document.querySelector('#location-search-error')?.textContent,
          input: document.querySelector('#location-search')?.value,
        })),
        null,
        2,
      ),
    );
    console.log(errors);
    await page.screenshot({ path: path.join(output, 'failure.png') });
    throw error;
  }
  await settle();
  check(
    'coordinate search opens a geographic Lens dossier',
    await page.$eval(
      '#lens-panel',
      (el) =>
        !el.classList.contains('collapsed') &&
        el.textContent.includes('30.32580'),
    ),
  );
  await page.click('#lens-tab-evidence');
  await page.click('#reset-globe-view');
  await new Promise((resolve) => setTimeout(resolve, 1800));
  check(
    'unknown imagery detail is stated honestly',
    await page.$eval('#lens-tabpanel-evidence', (el) =>
      el.textContent.includes('Unknown'),
    ),
  );
  await page.screenshot({
    path: path.join(output, 'lens-evidence-desktop.png'),
  });
  await page.click('#lens-tab-overview');
  await page.click('#lens-save-place');
  await settle();
  await page.waitForFunction(() =>
    document
      .querySelector('#lens-panel')
      ?.textContent.includes('Saved in Fieldbook.'),
  );
  await page.click('#lens-tab-notes');
  await page.type('#lens-note', 'Visit Dehradun with a saved offline note.');
  await page.click('#lens-add-note');
  await settle();
  await page.click('[data-workspace="library"]');
  await settle();
  check(
    'Lens saves place and note in the real local library',
    await page.$eval(
      '#fieldbook-panel',
      (el) =>
        el.textContent.includes('Visit Dehradun with a saved offline note.') &&
        el.textContent.includes('30.32580'),
    ),
  );
  await page.$eval('#fieldbook-title', (el) => {
    el.value = 'Dehradun field acceptance';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('#fieldbook-save');
  await settle();
  await page.screenshot({ path: path.join(output, 'fieldbook-desktop.png') });
  await page.click('#fieldbook-export');
  await settle();
  check(
    'backup preview excludes settings and credentials',
    await page.$eval('.fieldbook-preview', (el) =>
      /keys|credentials/i.test(el.textContent),
    ),
  );
  await page.click('#fieldbook-export-confirm');
  await settle();
  const backupPath = path.join(output, 'Dehradun-field-acceptance.aurel.json');
  await page.waitForFunction(
    () => !document.querySelector('#fieldbook-export-confirm'),
  );
  for (let i = 0; i < 20 && !fs.existsSync(backupPath); i++) await settle();
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  check(
    'downloaded backup contains place, note and source evidence only',
    backup.kind === 'aurel-fieldbook' &&
      backup.places.length === 1 &&
      backup.notes.length === 1 &&
      backup.evidence.length > 0 &&
      !Object.hasOwn(backup, 'settings'),
  );
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
  await ready();
  await page.click('[data-workspace="library"]');
  await settle();
  await page.click('.fieldbook-project-list button');
  await settle();
  check(
    'saved project and note survive browser reload',
    await page.$eval(
      '#fieldbook-panel',
      (el) =>
        el.textContent.includes('Dehradun field acceptance') &&
        el.textContent.includes('Visit Dehradun with a saved offline note.'),
    ),
  );
  await (
    await page.$('input[aria-label="Choose a Fieldbook backup"]')
  ).uploadFile(backupPath);
  await settle();
  check(
    'backup import presents a preview before changing a project',
    await page.$eval('.fieldbook-preview', (el) =>
      el.textContent.includes('Import as a new project'),
    ),
  );
  await page.click('#fieldbook-import-apply');
  await settle();
  await page.click('#fieldbook-save');
  await settle();
  check(
    'restore creates a second project without overwriting the first',
    (await page.$$('.fieldbook-project-list button')).length === 2,
  );
  await page.setViewport({ width: 390, height: 844 });
  await settle();
  await page.click('[data-workspace="library"]');
  await settle();
  await page.click(
    '.workspace-sheet-controls button[aria-label="Full-height inspector"]',
  );
  await settle();
  check(
    'phone Library panel remains visible and scrollable',
    await page.$eval(
      '#fieldbook-panel',
      (el) =>
        getComputedStyle(el).display !== 'none' &&
        el.getBoundingClientRect().width <= innerWidth,
    ),
  );
  await page.screenshot({ path: path.join(output, 'fieldbook-mobile.png') });
  await page.setViewport({ width: 667, height: 375 });
  await settle();
  check(
    'short landscape has no horizontal document overflow',
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: path.join(output, 'fieldbook-landscape.png') });
  check('no browser runtime errors', errors.length === 0);
  check(
    'no billable provider host requested',
    ![...hosts].some((host) =>
      /googleapis|openai|cesium\.com|tomtom/i.test(host),
    ),
  );
  fs.writeFileSync(
    path.join(output, 'checks.json'),
    JSON.stringify(
      { checks, errors, blockedExternalHosts: [...hosts] },
      null,
      2,
    ),
  );
  assert.ok(
    checks.every((entry) => entry.pass),
    'Every acceptance check must pass',
  );
} finally {
  await browser.close();
}
