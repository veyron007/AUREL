#!/usr/bin/env node
/**
 * Computed-style fingerprint of the main surfaces, for CSS changes that must
 * not change what renders (PERFORMANCE-PLAN.md WP2.6).
 *
 *   QA_BASE_URL=http://localhost:4221 node scripts/qa-computed-styles.mjs out.json
 *   node scripts/qa-computed-styles.mjs --compare before.json after.json
 *
 * For each look (Observatory, Field, Instrument, Cyber) with the data and
 * utilities panels open, it records a hash of every element's computed style
 * and of its ::before and ::after, keyed by the element's path. Compare two
 * runs to list the elements whose styles differ; run the same build twice to
 * see the live-data noise (rows and timestamps that come and go).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';

const LOOKS = Object.freeze(['observatory', 'field', 'instrument', 'cyber']);
const PANELS = Object.freeze(['data-panel', 'utilities-panel']);

function compare(beforeFile, afterFile) {
  const before = JSON.parse(readFileSync(beforeFile, 'utf8'));
  const after = JSON.parse(readFileSync(afterFile, 'utf8'));
  let differences = 0;
  for (const look of Object.keys(before)) {
    const a = before[look];
    const b = after[look] ?? {};
    const changed = Object.keys(a).filter(
      (key) => key in b && a[key] !== b[key],
    );
    const shared = Object.keys(a).filter((key) => key in b).length;
    differences += changed.length;
    console.log(`${look}: ${shared} shared elements, ${changed.length} differ`);
    for (const key of changed.slice(0, 25)) console.log(`  ${key}`);
  }
  return differences;
}

async function fingerprint(base) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--no-sandbox'],
  });
  const result = {};
  try {
    for (const look of LOOKS) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(
        `${base}/?welcome=0#v=2&lat=30.3258&lon=78.0438&alt=1800000&map=offline-overview&l=`,
        { waitUntil: 'domcontentloaded', timeout: 90_000 },
      );
      await page.waitForFunction(
        () =>
          window.__godsEyeView?.styleManager &&
          document
            .querySelector('#loading-screen')
            ?.classList.contains('hidden'),
        { timeout: 90_000 },
      );
      await page.evaluate(
        async (id, panels) => {
          const shell = window.__godsEyeView.styleManager;
          if (id === 'cyber') shell.setHudLayout('cyber');
          else {
            const select = document.querySelector(
              '.workspace-appearance select',
            );
            select.value = id;
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }
          for (const panel of panels) shell._panelNavigation.openPanel(panel);
          await new Promise((resolve) => setTimeout(resolve, 2500));
        },
        look,
        PANELS,
      );
      result[look] = await page.evaluate(() => {
        const hash = (text) => {
          let value = 2166136261;
          for (let index = 0; index < text.length; index += 1)
            value = Math.imul(value ^ text.charCodeAt(index), 16777619);
          return (value >>> 0).toString(36);
        };
        const styleText = (style) => {
          let text = '';
          for (let index = 0; index < style.length; index += 1) {
            const name = style[index];
            // Live values (animation progress, caret) and custom properties, which JS
            // also sets and which show up in the properties that read them.
            if (
              name.startsWith('--') ||
              name.startsWith('animation') ||
              name === 'caret-color'
            )
              continue;
            text += `${name}:${style.getPropertyValue(name)};`;
          }
          return text;
        };
        const path = (element) => {
          const parts = [];
          for (
            let node = element;
            node && node.nodeType === 1;
            node = node.parentElement
          ) {
            if (node.id) {
              parts.unshift(`#${node.id}`);
              break;
            }
            const index = [...(node.parentElement?.children ?? [])]
              .filter((sibling) => sibling.tagName === node.tagName)
              .indexOf(node);
            parts.unshift(`${node.tagName.toLowerCase()}:${index}`);
          }
          return parts.join('>');
        };
        const out = {};
        for (const element of document.querySelectorAll('body *')) {
          if (element.closest('.cesium-viewer canvas, svg')) continue;
          out[path(element)] = hash(
            styleText(getComputedStyle(element)) +
              styleText(getComputedStyle(element, '::before')) +
              styleText(getComputedStyle(element, '::after')),
          );
        }
        return out;
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return result;
}

if (process.argv[2] === '--compare') {
  process.exitCode = compare(process.argv[3], process.argv[4]) ? 1 : 0;
} else {
  const out = process.argv[2];
  if (!out) throw new Error('Usage: qa-computed-styles.mjs <out.json>');
  const base = process.env.QA_BASE_URL || 'http://localhost:4173';
  writeFileSync(out, JSON.stringify(await fingerprint(base)));
  console.log(`Wrote ${out}`);
}
