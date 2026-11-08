import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WILDLIFE_BADGE_GLYPHS } from './layers/wildlifeSightings/sprites.js';

const SRC_ROOT = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = path.resolve(SRC_ROOT, '..');
const INDEX_HTML = path.join(REPO_ROOT, 'index.html');

/** The glyph written as element text: `<span class="material-symbols-outlined">radar</span>`. */
const SPAN_TEXT =
  /class="[^"]*material-symbols-outlined[^"]*"[^>]*>\s*([a-z0-9_]+)\s*</g;
/** A glyph chosen in a Vue template: `<span class="material-symbols-outlined">{{ a ? 'x' : 'y' }}</span>`. */
const SPAN_MUSTACHE =
  /class="[^"]*material-symbols-outlined[^"]*"[^>]*>\s*\{\{([^}]{0,400})\}\}\s*</g;
/** A whole `textContent =` statement, across lines, so a multi-line ternary is read once. */
const TEXT_ASSIGNMENT = /(?:textContent|innerText)\s*=\s*([^;]{0,400})/gs;
const STRING_LITERAL = /['"`]([a-z0-9_]{2,})['"`]/g;
/** A rail or menu item's glyph: `{ icon: 'layers' }`, rendered by `UiIcon`. */
const ICON_PROPERTY = /\bicon:\s*['"]([a-z0-9_]+)['"]/g;

/**
 * Files that SHIP markup. Tests assert on markup, they do not render it.
 *
 * The panel markup lives in Vue views under `src`, so markup there is read as
 * well: a glyph named only in a view is still a glyph the font has to carry.
 */
function sourceFiles(directory = SRC_ROOT) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(absolute));
    else if (
      entry.isFile() &&
      /\.(js|mjs|html|vue)$/.test(entry.name) &&
      !entry.name.endsWith('.test.mjs')
    ) {
      files.push(absolute);
    }
  }
  return [...files.sort(), INDEX_HTML];
}

/**
 * Glyph names the sources ask the icon font for.
 *
 * Errs WIDE on purpose. A name the font does not carry costs nothing — Google
 * ignores an unknown `icon_names` entry and still returns 200 — while a glyph
 * the subset is missing breaks the interface SILENTLY: the ligature never
 * forms, so the element renders the literal word `right_panel_open` instead of
 * falling back to a visible box.
 *
 * A literal to the LEFT of a `?` is the condition being tested, not the text
 * being shown, so it is dropped: `status === 'loading' ? …` must not enrol
 * `loading`. Optional chaining is neutralised first — `payload?.newsStatus`
 * is not a ternary, and splitting on its `?` would keep the condition.
 * @returns {Map<string, string>} glyph -> the first file that names it.
 */
function referencedGlyphs() {
  const found = new Map();
  for (const glyph of Object.values(WILDLIFE_BADGE_GLYPHS))
    found.set(glyph, 'src/layers/wildlifeSightings/sprites.js');
  for (const file of sourceFiles()) {
    const source = readFileSync(file, 'utf8');
    const relative = path.relative(REPO_ROOT, file).split(path.sep).join('/');
    const add = (glyph) => {
      if (!found.has(glyph)) found.set(glyph, relative);
    };
    for (const match of source.matchAll(SPAN_TEXT)) add(match[1]);
    for (const match of source.matchAll(ICON_PROPERTY)) add(match[1]);
    // A template glyph bound to a computed (`{{ entryIcon }}`) is whatever
    // that computed returns.
    for (const [, expression] of source.matchAll(SPAN_MUSTACHE)) {
      const name = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(expression)?.[1];
      if (!name) continue;
      const body = new RegExp(
        `\\b${name}\\s*=\\s*computed\\(\\(\\)\\s*=>\\s*\\{([\\s\\S]{0,600}?)\\n\\}\\);`,
      ).exec(source)?.[1];
      for (const literal of body?.matchAll(
        /\breturn\s+['"`]([a-z0-9_]{2,})['"`]/g,
      ) ?? [])
        add(literal[1]);
    }
    const expressions = [
      ...source.matchAll(TEXT_ASSIGNMENT),
      ...source.matchAll(SPAN_MUSTACHE),
    ];
    for (const match of expressions) {
      const statement = match[1].replaceAll('?.', '.');
      const assigned = statement.includes('?')
        ? statement.slice(statement.indexOf('?') + 1)
        : statement;
      for (const literal of assigned.matchAll(STRING_LITERAL)) add(literal[1]);
    }
  }
  return found;
}

/** The glyph inventory and digest of the locally bundled font. */
function subsettedGlyphs() {
  const manifest = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'public/fonts/manifest.json'), 'utf8'),
  );
  const font = readFileSync(
    path.join(REPO_ROOT, 'public/fonts', manifest.icons.file),
  );
  assert.equal(
    createHash('sha256').update(font).digest('hex'),
    manifest.icons.sha256,
  );
  assert.equal(font.subarray(0, 4).toString(), 'wOF2');
  return new Set(manifest.icons.glyphs);
}

test('every glyph the sources render is in the icon_names subset', () => {
  const subset = subsettedGlyphs();
  const missing = [...referencedGlyphs()]
    .filter(([glyph]) => !subset.has(glyph))
    .map(([glyph, file]) => `${glyph} (${file})`);

  assert.deepEqual(
    missing,
    [],
    'Glyphs named by sources but absent from the bundled font manifest. ' +
      'Regenerate the local subset — an unlisted glyph renders as text: ' +
      missing.join(', '),
  );
});

test('the unused Material Icons Round family is not loaded', () => {
  // A second icon font, 173 kB, for a family no source ever uses — and
  // src/cockpitMarkup.test.mjs already asserts the markup must not use it.
  const html = readFileSync(INDEX_HTML, 'utf8');
  assert.doesNotMatch(
    html,
    /Material\+Icons\+Round/,
    'index.html loads an icon font nothing renders',
  );
});

test('bundled text font files match the reviewed provenance manifest', () => {
  const manifest = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'public/fonts/manifest.json'), 'utf8'),
  );
  assert.ok(manifest.fonts.length >= 4);
  for (const entry of manifest.fonts) {
    assert.equal(path.basename(entry.file), entry.file);
    const bytes = readFileSync(
      path.join(REPO_ROOT, 'public/fonts', entry.file),
    );
    assert.equal(bytes.length, entry.bytes, entry.file);
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      entry.sha256,
      entry.file,
    );
  }
});

test('typography is available locally without Google Fonts requests', () => {
  const html = readFileSync(INDEX_HTML, 'utf8');
  assert.doesNotMatch(html, /https:\/\/fonts\.(?:googleapis|gstatic)\.com/);
  // The faces load with the main stylesheet, not as a second blocking one.
  assert.doesNotMatch(html, /href="\/fonts\/fonts.css"/);
  const entry = readFileSync(path.join(REPO_ROOT, 'style.css'), 'utf8');
  assert.match(
    entry,
    /^(?:\/\*[^]*?\*\/\s*)*@import '\.\/src\/ui\/styles\/fonts\.css';/,
    'style.css imports the font faces before any other rule',
  );
  const css = readFileSync(
    path.join(REPO_ROOT, 'src/ui/styles/fonts.css'),
    'utf8',
  );
  assert.doesNotMatch(css, /https?:\/\//);
  for (const family of [
    'Manrope',
    'Inter',
    'JetBrains Mono',
    'Noto Sans Arabic',
    'Material Symbols Outlined',
  ]) {
    assert.ok(css.includes(`font-family: '${family}'`), family);
  }
  const files = [...css.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g)];
  assert.ok(files.length >= 5);
  for (const [, url] of files) {
    assert.match(
      url,
      /^\/fonts\/[a-z0-9-]+\.woff2$/,
      'font URLs name the public font directory',
    );
    const file = path.basename(url);
    const bytes = readFileSync(path.join(REPO_ROOT, 'public/fonts', file));
    assert.equal(bytes.subarray(0, 4).toString(), 'wOF2', file);
  }
  for (const license of [
    'manrope-OFL.txt',
    'inter-OFL.txt',
    'jetbrainsmono-OFL.txt',
    'notosansarabic-OFL.txt',
    'material-symbols-LICENSE.txt',
  ]) {
    assert.ok(
      readFileSync(
        path.join(REPO_ROOT, 'public/fonts/licenses', license),
        'utf8',
      ).length > 1000,
    );
  }
});

test('the first-drawn Latin faces are preloaded with the URLs the stylesheet uses', () => {
  const html = readFileSync(INDEX_HTML, 'utf8');
  const css = readFileSync(
    path.join(REPO_ROOT, 'src/ui/styles/fonts.css'),
    'utf8',
  );
  const preloads = [
    ...html.matchAll(/<link rel="preload" href="([^"]+)"([^>]*)>/g),
  ];
  assert.deepEqual(
    preloads.map(([, href]) => href),
    ['/fonts/plus-jakarta-sans-4.woff2', '/fonts/jetbrains-mono-6.woff2'],
  );
  for (const [, href, attributes] of preloads) {
    // A font preload without crossorigin is fetched twice.
    assert.match(attributes, /as="font" type="font\/woff2" crossorigin/);
    const face = css.slice(css.indexOf(`src: url(${href})`));
    assert.ok(face.length < css.length, href);
    // Only the Latin subsets: other scripts load when their text appears.
    assert.match(face, /^[^}]*unicode-range:\s*U\+0000-00FF/);
  }
  assert.ok(
    html.indexOf('rel="preload"') < html.indexOf('href="/style.css"'),
    'preloads start before the stylesheet is parsed',
  );
});
