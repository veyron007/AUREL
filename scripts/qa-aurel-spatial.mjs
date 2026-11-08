/** AUREL Spatial acceptance screenshots: ornament, entity card, palette, chrome rest, Cyber, phone. */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const output = path.resolve(
  process.env.QA_OUTPUT || 'docs/design/aurel/spatial',
);
fs.mkdirSync(output, { recursive: true });
const base = process.env.QA_BASE_URL || 'http://localhost:4173';
const only = process.argv.slice(2);
const results = [];
const check = (name, value, detail) => {
  results.push({ name, pass: Boolean(value), ...(detail && { detail }) });
  console.log(
    `${value ? 'PASS' : 'FAIL'} ${name}${detail ? ` ${JSON.stringify(detail)}` : ''}`,
  );
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const browser = await puppeteer.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--no-sandbox'],
});

async function open(
  width,
  height,
  hash = 'lat=30.3258&lon=78.0438&alt=1800000',
) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewport({ width, height });
  await page.goto(`${base}/?welcome=0#v=2&${hash}&map=offline-overview&l=`, {
    waitUntil: 'networkidle2',
    timeout: 90000,
  });
  await page.waitForFunction(
    () =>
      window.__godsEyeView &&
      document.body.dataset.workspaceAppearance &&
      document.querySelector('#loading-screen')?.classList.contains('hidden'),
    { timeout: 90000 },
  );
  await wait(2500);
  return { page, errors };
}
const shot = (page, name) =>
  page.screenshot({ path: path.join(output, `${name}.png`) });
const want = (name) => !only.length || only.includes(name);

try {
  if (want('desktop')) {
    const { page, errors } = await open(1440, 900);
    await shot(page, 'desktop-ornament');
    const layout = await page.evaluate(() => {
      const box = (selector) => {
        const r = document.querySelector(selector)?.getBoundingClientRect();
        return (
          r && {
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height),
          }
        );
      };
      return {
        search: box('#aurel-search'),
        nav: box('.workspace-nav'),
        stamp: box('.workspace-imagery-stamp'),
        stampText: document
          .querySelector('.workspace-imagery-stamp')
          ?.textContent.trim(),
        placeholder: document.body.textContent.includes('Explore the globe'),
        font: getComputedStyle(document.querySelector('.workspace-nav button'))
          .fontFamily,
      };
    });
    check(
      'ornament search and destinations share one row',
      layout.search &&
        layout.nav &&
        Math.abs(layout.search.y - layout.nav.y) < 4,
      layout,
    );
    check('no placeholder place label', !layout.placeholder);
    check(
      'imagery stamp names the source',
      /Natural Earth/.test(layout.stampText || ''),
      { text: layout.stampText },
    );
    check(
      'Plus Jakarta Sans is the interface face',
      /Plus Jakarta Sans/.test(layout.font),
    );

    // Command palette: ⌘K opens, typing lists a layer, Enter toggles it.
    await page.keyboard.down('Meta');
    await page.keyboard.press('KeyK');
    await page.keyboard.up('Meta');
    await wait(500);
    check('⌘K opens the palette', await page.$('.command-palette'));
    await shot(page, 'desktop-palette');
    await page.keyboard.type('earthq');
    await wait(400);
    const first = await page.$eval(
      '.command-palette-row.is-active .command-palette-title',
      (el) => el.textContent,
    );
    check(
      'typing ranks the Earthquakes layer first',
      /Earthquake/.test(first),
      { first },
    );
    await shot(page, 'desktop-palette-query');
    await page.keyboard.press('Enter');
    await wait(400);
    check('Enter closes the palette', !(await page.$('.command-palette')));
    await page
      .waitForFunction(
        () =>
          document.querySelector(
            '[data-layer-id="earthquakes"] .data-toggle-btn.active',
          ),
        { timeout: 20000 },
      )
      .catch(() => {});
    check(
      'the palette enabled the layer through its owner',
      await page.$('[data-layer-id="earthquakes"] .data-toggle-btn.active'),
    );

    await page.mouse.click(720, 300);
    await page.keyboard.press('/');
    await wait(400);
    check(
      '"/" opens the palette outside fields',
      await page.$('.command-palette'),
    );
    await page.keyboard.press('Escape');
    await wait(300);
    check('Escape closes the palette', !(await page.$('.command-palette')));

    // One focus at a time: opening a second tool replaces the first.
    for (const name of ['DATA LAYERS', 'CONTEXT']) {
      await page.evaluate(
        (label) =>
          [...document.querySelectorAll('.workspace-tools > button')]
            .find((button) => button.textContent.includes(label))
            ?.click(),
        name,
      );
      await wait(700);
    }
    const shown = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          '#left-panel-stack > [data-panel-id], #right-context-rail > [data-panel-id]',
        ),
      ]
        .filter(
          (panel) =>
            !panel.classList.contains('collapsed') &&
            !panel.hidden &&
            getComputedStyle(panel).display !== 'none',
        )
        .map((panel) => panel.id),
    );
    check('one side panel is shown at a time', shown.length === 1, { shown });
    await shot(page, 'desktop-context-card');

    // A place card: choose a bundled place from the field's suggestions.
    await page.click('#location-search');
    await page.keyboard.type('Dehradun');
    await wait(900);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page
      .waitForFunction(
        () =>
          document.querySelector(
            '#lens-panel:not(.collapsed) .lens-identity h2',
          ),
        { timeout: 30000 },
      )
      .catch(() => {});
    await wait(2500);
    const card = await page.evaluate(() => ({
      title: document.querySelector('#lens-panel .lens-identity h2')
        ?.textContent,
      eyebrow: document.querySelector('#lens-panel .lens-eyebrow')?.textContent,
      tiles: document.querySelectorAll('#lens-panel .lens-stats > div').length,
      place: document.querySelector('.workspace-context')?.textContent.trim(),
    }));
    check(
      'a chosen place opens the Lens entity card',
      card.title && card.tiles === 3,
      card,
    );
    await shot(page, 'desktop-place-card');

    // A map entity: click an earthquake the layer drew, as a person would.
    await page.click('#reset-globe-view');
    await wait(4000);
    const target = await page.evaluate(() => {
      const { viewer } = window.__godsEyeView;
      const now = viewer.clock.currentTime;
      for (let index = 0; index < viewer.dataSources.length; index += 1) {
        const source = viewer.dataSources.get(index);
        if (source.name !== 'earthquakes') continue;
        for (const entity of source.entities.values) {
          const point = viewer.scene.cartesianToCanvasCoordinates(
            entity.position?.getValue(now),
          );
          if (
            !point ||
            point.x < 320 ||
            point.x > 1000 ||
            point.y < 160 ||
            point.y > 700
          )
            continue;
          // Only a point the scene would pick there (not one behind the globe).
          const picked = viewer.scene.pick(point);
          if (picked?.id && source.entities.contains(picked.id))
            return { x: point.x, y: point.y };
        }
      }
      return null;
    });
    if (target) await page.mouse.click(target.x, target.y);
    await wait(3000);
    const entity = await page.evaluate(() => ({
      title: document.querySelector(
        '#lens-panel:not(.collapsed) .lens-identity h2',
      )?.textContent,
      eyebrow: document.querySelector('#lens-panel .lens-eyebrow')?.textContent,
    }));
    check(
      'a clicked earthquake uses the same entity card',
      target && entity.title && entity.title !== 'Dehradun',
      { target, ...entity },
    );
    await shot(page, 'desktop-entity-card');

    // Chrome rest: close the inspector, move once, then stay still.
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      for (const panel of document.querySelectorAll(
        '#left-panel-stack > [data-panel-id]:not(.collapsed), #right-context-rail > [data-panel-id]:not(.collapsed)',
      ))
        panel
          .querySelector(
            '[data-panel-toggle], .ui-panel-toggle, .panel-collapse-btn',
          )
          ?.click();
      document.activeElement?.blur?.();
    });
    await page.mouse.move(720, 450);
    await wait(7000);
    const resting = await page.evaluate(() =>
      document.body.classList.contains('chrome-resting'),
    );
    check('chrome rests after a quiet spell', resting);
    await shot(page, 'desktop-resting');
    await page.mouse.move(700, 420);
    await wait(800);
    check(
      'movement wakes the chrome',
      !(await page.evaluate(() =>
        document.body.classList.contains('chrome-resting'),
      )),
    );
    check('no page errors on desktop', errors.length === 0, errors.slice(0, 3));
    await page.close();
  }
  if (want('motion')) {
    const page = await browser.newPage();
    await page.emulateMediaFeatures([
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ]);
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(
      `${base}/?welcome=0#v=2&lat=30.3258&lon=78.0438&alt=1800000&map=offline-overview&l=`,
      { waitUntil: 'networkidle2', timeout: 90000 },
    );
    await page.waitForFunction(
      () =>
        window.__godsEyeView &&
        document.querySelector('#loading-screen')?.classList.contains('hidden'),
      { timeout: 90000 },
    );
    await wait(1500);
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyK');
    await page.keyboard.up('Control');
    await wait(300);
    const motion = await page.evaluate(() => ({
      palette: getComputedStyle(document.querySelector('.command-palette-box'))
        .animationName,
      nav: getComputedStyle(document.querySelector('.workspace-nav'))
        .transitionProperty,
    }));
    check(
      'reduced motion stops the palette animation',
      motion.palette === 'none',
      motion,
    );
    await page.close();
  }
  if (want('cyber')) {
    const { page } = await open(1440, 900);
    await page.evaluate(() => {
      const select = document.querySelector('#hud-layout-select');
      if (select) {
        select.value = 'cyber';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await wait(2000);
    const theme = await page.evaluate(() => ({
      theme: document.documentElement.dataset.uiTheme,
      font: getComputedStyle(document.body).fontFamily,
      dockRadius: getComputedStyle(document.querySelector('#command-dock'))
        .borderRadius,
    }));
    check(
      'Cyber keeps its own theme',
      theme.theme === 'cyber' && !/Plus Jakarta/.test(theme.font),
      theme,
    );
    await shot(page, 'desktop-cyber');
    await page.close();
  }
  if (want('field')) {
    const { page } = await open(1440, 900);
    await page.select('.workspace-appearance select', 'field');
    await wait(800);
    await shot(page, 'desktop-field');
    await page.select('.workspace-appearance select', 'observatory');
    await page.close();
  }
  if (want('phone')) {
    const { page, errors } = await open(390, 844);
    await shot(page, 'phone-explore');
    await page.click('#location-search');
    await page.keyboard.type('Dehradun');
    await wait(900);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await wait(5000);
    await shot(page, 'phone-place-card');
    check('no page errors on phone', errors.length === 0, errors.slice(0, 3));
    await page.close();
  }
} finally {
  await browser.close();
  fs.writeFileSync(
    path.join(output, 'qa-results.json'),
    `${JSON.stringify(results, null, 2)}\n`,
  );
}
const failed = results.filter((result) => !result.pass);
console.log(
  `${results.length - failed.length}/${results.length} checks passed`,
);
process.exitCode = failed.length ? 1 : 0;
