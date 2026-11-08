// Catalogs load on demand: a page downloads only the language it shows.
// Each test imports its own copy of the i18n module, so the catalogs the
// suite runner preloads (scripts/register-test-locales.mjs) are not loaded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let copies = 0;
const freshI18n = () => import(`./index.js?fresh=${(copies += 1)}`);

test('no catalog is loaded until its locale is asked for', async () => {
  const i18n = await freshI18n();
  assert.equal(i18n.getCatalog('ru'), null);
  assert.equal(i18n.isLocaleLoaded('ru'), false);
  assert.equal(i18n.isLocaleLoaded('en'), true, 'English needs no catalog');
  assert.equal(await i18n.loadLocale('ru'), 'ru');
  assert.equal(i18n.isLocaleLoaded('ru'), true);
  assert.equal(i18n.getCatalog('de'), null, 'only the asked-for catalog');
});

test('switching to an unloaded locale applies once its catalog is in', async () => {
  const i18n = await freshI18n();
  const heard = [];
  i18n.onLocaleChange(() => heard.push(i18n.getLocale()));
  assert.equal(i18n.setLocale('ru'), 'ru');
  assert.equal(i18n.getLocale(), 'en', 'no half-translated frame');
  await i18n.loadLocale('ru');
  await Promise.resolve();
  assert.equal(i18n.getLocale(), 'ru');
  assert.deepEqual(heard, ['ru']);
  assert.equal(i18n.t('Ready'), 'Готово');
});

test('a later choice wins over a catalog still loading', async () => {
  const i18n = await freshI18n();
  i18n.setLocale('de');
  i18n.setLocale('en');
  await i18n.loadLocale('de');
  await Promise.resolve();
  assert.equal(i18n.getLocale(), 'en');
});

test('unknown locales fall back to English without a fetch', async () => {
  const i18n = await freshI18n();
  assert.equal(await i18n.loadLocale('xx'), 'en');
  assert.equal(i18n.setLocale('xx'), 'en');
  assert.equal(i18n.getLocale(), 'en');
  assert.throws(() => i18n.registerCatalog('xx', {}), /No shipped catalog/);
  assert.throws(() => i18n.registerCatalog('ru', null), /not an object/);
});

test('the i18n module imports no catalog statically', () => {
  const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^import .*locales\/.*\.json/m);
  const loaders = readFileSync(
    new URL('./catalogLoaders.js', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(loaders, /^import /m);
});
