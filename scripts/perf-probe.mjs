// Startup and steady-state probe: cold load, transfer, long tasks, heap, frame
// rate and startup mark gaps, per scene in scripts/perf-scenes.json.
//
// Controls follow docs/PERFORMANCE.md: hardware GPU only (rejects software
// renderers unless --allow-software), 1440 x 900 at DPR 1, cache disabled, a
// fresh browser context per run, and the median of --runs runs per scene.
// Prints one JSON line per scene, then Markdown tables. Progress goes to stderr.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';
import { STARTUP_MARK_ORDER } from '../src/app/startupMarks.js';
import {
  formatMarkdown,
  isSoftwareRenderer,
  parseProbeArgs,
  parseScenes,
  probeUsage,
  sceneUrl,
  selectScenes,
  summarizeRuns,
} from './perf-probe-core.mjs';

const SCENES_FILE = fileURLToPath(
  new URL('./perf-scenes.json', import.meta.url),
);
const VIEWPORT = Object.freeze({
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
});
const READY_TIMEOUT_MS = 120_000;
const READY_POLL_MS = 50;
const SETTLE_MS = 15_000;
const FPS_SAMPLE_MS = 4_000;
const ROTATE_STEP_RADIANS = 0.004;
const BYTES_PER_MB = 1_048_576;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function browserArgs() {
  const angle = process.platform === 'darwin' ? ['--use-angle=metal'] : [];
  return [
    ...angle,
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--enable-precise-memory-info',
  ];
}

async function readRenderer(page) {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '?';
  });
}

async function assertHardwareGpu(browser, allowSoftware) {
  const page = await browser.newPage();
  try {
    const renderer = await readRenderer(page);
    if (isSoftwareRenderer(renderer) && !allowSoftware)
      throw new Error(
        `Software or missing GPU renderer "${renderer}"; numbers would not be comparable. Pass --allow-software to probe anyway.`,
      );
    return renderer;
  } finally {
    await page.close();
  }
}

function trackNetwork(cdp) {
  const totals = { requests: 0, bytes: 0 };
  cdp.on('Network.requestWillBeSent', () => {
    totals.requests++;
  });
  cdp.on('Network.loadingFinished', (event) => {
    totals.bytes += event.encodedDataLength;
  });
  return () => ({ ...totals });
}

async function preparePage(context, throttle) {
  const page = await context.newPage();
  await page.setViewport(VIEWPORT);
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (throttle) {
    const { label: _label, ...conditions } = throttle;
    await cdp.send('Network.emulateNetworkConditions', conditions);
  }
  await page.evaluateOnNewDocument(() => {
    window.__perfLongTasks = [];
    new PerformanceObserver((list) =>
      list
        .getEntries()
        .forEach((entry) => window.__perfLongTasks.push(entry.duration)),
    ).observe({ type: 'longtask', buffered: true });
  });
  return { page, network: trackNetwork(cdp) };
}

async function waitForReady(page) {
  const handle = await page.waitForFunction(
    () =>
      window.__godsEyeView &&
      document.querySelector('#loading-screen')?.classList.contains('hidden') &&
      performance.now(),
    { timeout: READY_TIMEOUT_MS, polling: READY_POLL_MS },
  );
  return handle.jsonValue();
}

async function sampleFps(page, motion) {
  return page.evaluate(
    async (sampleMs, step, rotate) => {
      const view = window.__godsEyeView;
      let frames = 0;
      const stop = view.viewer.scene.postRender.addEventListener(
        () => frames++,
      );
      const start = performance.now();
      let raf = 0;
      const spin = () => {
        view.viewer.camera.rotateRight(step);
        view.requestRender?.('perf-probe');
        raf = requestAnimationFrame(spin);
      };
      if (rotate) spin();
      await new Promise((resolve) => setTimeout(resolve, sampleMs));
      cancelAnimationFrame(raf);
      stop();
      return frames / ((performance.now() - start) / 1000);
    },
    FPS_SAMPLE_MS,
    ROTATE_STEP_RADIANS,
    motion,
  );
}

async function readPageMetrics(page, markNames) {
  return page.evaluate((names) => {
    const tasks = window.__perfLongTasks;
    const marks = Object.fromEntries(
      names.map((name) => [
        name,
        performance.getEntriesByName(name, 'mark')[0]?.startTime ?? null,
      ]),
    );
    return {
      domReadyMs:
        performance.getEntriesByType('navigation')[0]
          ?.domContentLoadedEventEnd ?? null,
      heapBytes: performance.memory?.usedJSHeapSize ?? null,
      longTaskMs: tasks.reduce((sum, value) => sum + value, 0),
      worstTaskMs: Math.max(0, ...tasks),
      longTasks: tasks.length,
      marks,
    };
  }, markNames);
}

async function probeOnce(browser, url, options) {
  const context = await browser.createBrowserContext();
  try {
    const { page, network } = await preparePage(context, options.throttle);
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: READY_TIMEOUT_MS,
    });
    const readyMs = await waitForReady(page);
    await wait(SETTLE_MS);
    const settled = network();
    const restFps = await sampleFps(page, false);
    const motionFps = await sampleFps(page, true);
    const { heapBytes, ...metrics } = await readPageMetrics(
      page,
      STARTUP_MARK_ORDER,
    );
    return {
      gpu: await readRenderer(page),
      readyMs,
      requests: settled.requests,
      transferMB: settled.bytes / BYTES_PER_MB,
      heapMB: heapBytes === null ? null : heapBytes / BYTES_PER_MB,
      restFps,
      motionFps,
      ...metrics,
    };
  } finally {
    await context.close();
  }
}

async function probeScene(browser, scene, options) {
  const url = sceneUrl(options.base, scene);
  const runs = [];
  for (let run = 1; run <= options.runs; run++) {
    process.stderr.write(
      `[perf-probe] ${scene.id} run ${run}/${options.runs}\n`,
    );
    runs.push(await probeOnce(browser, url, options));
  }
  return {
    ...summarizeRuns(scene, runs),
    throttle: options.throttle?.label ?? null,
    samples: runs,
  };
}

async function loadScenes() {
  const text = await readFile(SCENES_FILE, 'utf8');
  try {
    return parseScenes(JSON.parse(text));
  } catch (error) {
    throw new Error(
      `${path.relative(process.cwd(), SCENES_FILE)}: ${error.message}`,
    );
  }
}

export async function runProbe(argv) {
  const options = parseProbeArgs(argv);
  if (options.help) {
    console.log(probeUsage());
    return 0;
  }
  const scenes = selectScenes(await loadScenes(), options.sceneIds);
  const browser = await puppeteer.launch({
    headless: true,
    args: browserArgs(),
  });
  try {
    const renderer = await assertHardwareGpu(browser, options.allowSoftware);
    process.stderr.write(`[perf-probe] GPU: ${renderer}\n`);
    const summaries = [];
    for (const scene of scenes) {
      const summary = await probeScene(browser, scene, options);
      console.log(JSON.stringify(summary));
      summaries.push(summary);
    }
    console.log(`\n${formatMarkdown(summaries)}`);
    return 0;
  } finally {
    await browser.close();
  }
}

const invoked = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (import.meta.url === invoked) {
  runProbe(process.argv.slice(2)).then(
    (status) => {
      process.exitCode = status;
    },
    (error) => {
      console.error(`[perf-probe] ${error.message}`);
      process.exitCode = 1;
    },
  );
}
