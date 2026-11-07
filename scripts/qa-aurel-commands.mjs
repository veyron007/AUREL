/** Local command browser acceptance. No provider/model traffic is allowed to leave this browser. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
const output = path.resolve('docs/design/aurel/phase-5/evidence');
fs.mkdirSync(output, { recursive: true });
const browser = await puppeteer.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--no-sandbox'],
});
const checks = [],
  errors = [],
  searches = [],
  modelRequests = [];
const check = (name, pass) => {
  checks.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
};
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (/geocod|nominatim|photon|\/api\/places|\/api\/search/.test(url.href))
      searches.push(url.pathname);
    if (
      /openai|anthropic|ollama|\/chat\/completions|\/api\/voice/.test(
        url.href,
      ) &&
      !url.pathname.endsWith('/status')
    ) {
      modelRequests.push(url.pathname);
      return request.abort();
    }
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !['127.0.0.1', 'localhost'].includes(url.hostname)
    )
      return request.abort();
    return request.continue();
  });
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(
    'http://127.0.0.1:4173/?welcome=0#v=2&lat=30.32&lon=78.04&alt=1800000&map=offline-overview&l=',
    { waitUntil: 'domcontentloaded', timeout: 90000 },
  );
  await page.waitForFunction(
    () =>
      window.__godsEyeView &&
      document.querySelector('#loading-screen')?.classList.contains('hidden'),
    { timeout: 90000 },
  );
  async function openCommands() {
    await page.click('[data-workspace="library"]');
    await page.evaluate(() => {
      const button = [
        ...document.querySelectorAll('.workspace-tools button'),
      ].find((el) => el.textContent.trim().endsWith('Local commands'));
      if (!button) throw Error('Missing Local commands workspace tool');
      button.click();
    });
    await page.waitForFunction(
      () =>
        document.querySelector('#local-command-input')?.getBoundingClientRect()
          .width > 0,
    );
  }
  async function input(value) {
    await page.$eval(
      '#local-command-input',
      (el, value) => {
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      },
      value,
    );
  }
  async function click(label) {
    await page.evaluate((label) => {
      const button = [
        ...document.querySelectorAll('#local-commands-panel button'),
      ].find((el) => el.textContent.trim() === label);
      if (!button || button.disabled)
        throw Error(`Unavailable command button ${label}`);
      button.click();
    }, label);
  }
  await openCommands();
  await input('find Springfield');
  await click('Preview command');
  await page.waitForSelector('.local-command-preview');
  check('preview does not geocode or navigate', searches.length === 0);
  check(
    'ambiguous search explicitly waits for user choice',
    await page.$eval('.local-command-preview', (el) =>
      el.textContent.includes('No place is selected automatically'),
    ),
  );
  await click('Run this action');
  await page.waitForFunction(
    () => document.querySelector('#location-search')?.value === 'Springfield',
  );
  check('Run stages query without submitting search', searches.length === 0);
  check(
    'search completion does not claim a selected result',
    await page.$eval('.local-command-status', (el) =>
      el.textContent.includes('Review the query and submit it'),
    ),
  );
  await openCommands();
  await input('show google maps');
  await click('Preview command');
  check(
    'prohibited provider produces no runnable preview',
    await page.$eval(
      '#local-commands-panel',
      (el) =>
        !el.querySelector('.local-command-run') ||
        el.querySelector('.local-command-run').disabled,
    ),
  );
  await input('open planner');
  await click('Preview command');
  await click('Run this action');
  await page.waitForFunction(
    () =>
      !document
        .querySelector('#planner-panel')
        ?.classList.contains('collapsed'),
  );
  check(
    'workspace command opens the existing Planner',
    await page.$eval(
      '#planner-panel',
      (el) => !el.classList.contains('collapsed'),
    ),
  );
  await openCommands();
  await click('Prepare workspace command');
  check(
    'workflow card only stages a command',
    await page.$eval('#local-command-input', (el) => el.value === 'open lens'),
  );
  await input('go to 30.3258, 78.0438');
  await click('Preview command');
  await page.screenshot({
    path: path.join(output, 'commands-desktop.png'),
    fullPage: false,
  });
  await page.setViewport({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(output, 'commands-mobile.png'),
    fullPage: false,
  });
  check(
    'mobile document has no horizontal overflow',
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  check('no language model endpoint requested', modelRequests.length === 0);
  check('no unhandled browser errors', errors.length === 0);
  fs.writeFileSync(
    path.join(output, 'commands-browser-checks.json'),
    JSON.stringify({ checks, errors, searches, modelRequests }, null, 2),
  );
  assert.ok(
    checks.every((check) => check.pass),
    'Command acceptance failure',
  );
} finally {
  await browser.close();
}
