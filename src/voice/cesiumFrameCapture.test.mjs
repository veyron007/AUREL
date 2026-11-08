import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FRESH_FRAME_TIMEOUT_MS,
  captureCesiumFrame,
} from './cesiumFrameCapture.js';
import {
  RealtimeViewport,
  captureViewportImage,
  renderFreshCesiumFrame,
} from './realtimeViewport.js';
import {
  createFakeCesiumScene,
  createFakeDocument,
} from '../testSupport/fakeCesiumCanvas.mjs';

async function withDocument(doc, run) {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  globalThis.document = doc;
  globalThis.window = globalThis.window ?? {};
  try {
    return await run();
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
}

test('capture: read() runs inside postRender, while the buffer holds the frame', async () => {
  const scene = createFakeCesiumScene();
  const result = await withDocument(createFakeDocument(), () =>
    captureCesiumFrame({ scene }, (canvas) => ({
      lit: canvas.hasPixels,
      canvas,
    })),
  );
  assert.equal(result.lit, true);
  assert.equal(result.canvas, scene.canvas);
  assert.equal(scene.requests, 1);
  assert.equal(scene.listenerCount, 0, 'the listener is removed');
  assert.equal(scene.canvas.hasPixels, false, 'pixels are gone after');
});

test('capture: a hidden document never requests a render and returns null', async () => {
  const scene = createFakeCesiumScene();
  let reads = 0;
  const result = await withDocument(createFakeDocument({ hidden: true }), () =>
    captureCesiumFrame({ scene }, () => ++reads),
  );
  assert.equal(result, null);
  assert.equal(scene.requests, 0);
  assert.equal(reads, 0);
  assert.equal(scene.listenerCount, 0);
});

test('capture: a tab switch before the frame returns null without reading', async () => {
  const doc = createFakeDocument();
  const scene = createFakeCesiumScene();
  const request = scene.requestRender;
  scene.requestRender = () => {
    doc.hidden = true;
    request();
  };
  let reads = 0;
  const result = await withDocument(doc, () =>
    captureCesiumFrame({ scene }, () => ++reads),
  );
  assert.equal(result, null);
  assert.equal(reads, 0);
  assert.equal(scene.listenerCount, 0);
});

test('capture: no frame within the timeout returns null and removes the listener', async () => {
  const scene = createFakeCesiumScene({ renders: false });
  const started = Date.now();
  const result = await withDocument(createFakeDocument(), () =>
    captureCesiumFrame({ scene }, () => 'read', { timeoutMs: 20 }),
  );
  assert.equal(result, null);
  assert.ok(Date.now() - started >= 15);
  assert.equal(scene.listenerCount, 0);
  assert.equal(FRESH_FRAME_TIMEOUT_MS, 400, 'the default bound is unchanged');
});

test('capture: attempts retry only a missing frame', async () => {
  // The first request is dropped by a slow render loop; the second renders.
  const rendering = createFakeCesiumScene();
  let calls = 0;
  const flaky = {
    postRender: rendering.postRender,
    canvas: rendering.canvas,
    requestRender() {
      calls += 1;
      if (calls === 2) rendering.requestRender();
    },
  };
  const result = await withDocument(createFakeDocument(), () =>
    captureCesiumFrame({ scene: flaky }, (canvas) => canvas.hasPixels, {
      attempts: 2,
      timeoutMs: 20,
    }),
  );
  assert.equal(result, true);
  assert.equal(calls, 2);
  assert.equal(rendering.listenerCount, 0);
});

test('capture: a throwing read is logged and returns null', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const scene = createFakeCesiumScene();
  const result = await withDocument(createFakeDocument(), () =>
    captureCesiumFrame({ scene }, () => {
      throw new Error('tainted');
    }),
  );
  assert.equal(result, null);
  assert.equal(warn.mock.callCount(), 1);
  assert.equal(scene.listenerCount, 0);
});

test('renderFreshCesiumFrame keeps its boolean contract', async () => {
  const scene = createFakeCesiumScene();
  assert.equal(
    await withDocument(createFakeDocument(), () =>
      renderFreshCesiumFrame({ scene }),
    ),
    true,
  );
});

test('viewport capture draws the globe inside postRender', async () => {
  const doc = createFakeDocument();
  const scene = createFakeCesiumScene({ width: 1600, height: 1000 });
  const dataUrl = await withDocument(doc, () => {
    globalThis.window.__godsEyeView = { viewer: { scene } };
    return captureViewportImage();
  });
  assert.match(dataUrl, /^data:image\/jpeg;base64,/);
  const globeCopies = doc.draws.filter((draw) => draw.source === scene.canvas);
  assert.equal(globeCopies.length, 1);
  assert.equal(globeCopies[0].lit, true, 'drawImage saw a valid buffer');
  assert.equal(scene.listenerCount, 0);
});

test('viewport capture returns null when the buffer was read blank', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const doc = createFakeDocument();
  // postRender fires, but the buffer holds no pixels: the copy reads black.
  const canvas = { width: 800, height: 600, hasPixels: false };
  const scene = {
    canvas,
    postRender: {
      addEventListener(listener) {
        queueMicrotask(listener);
        return () => {};
      },
    },
    requestRender() {},
  };
  const result = await withDocument(doc, () => {
    globalThis.window.__godsEyeView = { viewer: { scene } };
    return captureViewportImage();
  });
  assert.equal(result, null, 'isNearlyBlackFrame still guards the image');
  assert.equal(doc.draws[0].lit, false);
});

test('pointer crop draws inside postRender and reports its rect', async () => {
  const doc = createFakeDocument();
  const scene = createFakeCesiumScene({ width: 1500, height: 950 });
  const crop = await withDocument(doc, () => {
    globalThis.window.__godsEyeView = { viewer: { scene } };
    const viewport = new RealtimeViewport({
      readChannel: () => null,
      operations: {},
    });
    return viewport.capturePointer({ x: 750, y: 475 });
  });
  assert.match(crop.dataUrl, /^data:image\/jpeg;base64,/);
  const copy = doc.draws.find((draw) => draw.source === scene.canvas);
  assert.equal(copy.lit, true);
  assert.deepEqual(copy.args.slice(0, 4), [494, 219, 512, 512]);
  assert.equal(crop.rect.w, 512 / 1500);
  assert.equal(scene.listenerCount, 0);
});
