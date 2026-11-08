import assert from 'node:assert/strict';
import test from 'node:test';
import { createViewCapture } from './agentDeskCapture.js';
import {
  createFakeCesiumScene,
  createFakeDocument,
} from '../testSupport/fakeCesiumCanvas.mjs';

async function withDocument(doc, run) {
  const originalDocument = globalThis.document;
  globalThis.document = doc;
  try {
    return await run();
  } finally {
    globalThis.document = originalDocument;
  }
}

test('render_view copies the globe inside postRender, then adds the legend', async () => {
  const doc = createFakeDocument();
  const scene = createFakeCesiumScene({ width: 2560, height: 1600 });
  const capture = createViewCapture({
    viewer: { scene },
    readLayers: () => [],
    now: () => Date.parse('2026-11-08T12:00:00Z'),
  });
  const result = await withDocument(doc, () => capture());
  assert.ok(result, 'a fresh frame produced an image');
  assert.equal(result.image, 'QUJD');
  assert.equal(result.width, 1280, 'scaled to the default max width');
  assert.equal(result.captured_at, '2026-11-08T12:00:00.000Z');
  const copies = doc.draws.filter((draw) => draw.source === scene.canvas);
  assert.equal(copies.length, 1);
  assert.equal(copies[0].lit, true, 'drawImage saw a valid buffer');
  assert.deepEqual(copies[0].args, [0, 0, 1280, 800]);
  assert.equal(scene.listenerCount, 0);
});

test('render_view returns null while hidden and never requests a frame', async () => {
  const scene = createFakeCesiumScene();
  const capture = createViewCapture({
    viewer: { scene },
    readLayers: () => [],
  });
  const result = await withDocument(createFakeDocument({ hidden: true }), () =>
    capture(),
  );
  assert.equal(result, null);
  assert.equal(scene.requests, 0);
});

test('render_view returns null when no frame arrives', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const scene = createFakeCesiumScene({ renders: false });
  const capture = createViewCapture({
    viewer: { scene },
    readLayers: () => [],
  });
  const pending = withDocument(createFakeDocument(), () => capture());
  await Promise.resolve();
  t.mock.timers.tick(400);
  assert.equal(await pending, null);
  assert.equal(scene.listenerCount, 0);
});
