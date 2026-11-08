import test from 'node:test';
import assert from 'node:assert/strict';
import { surfaceTilesLoaded, waitForViewTiles } from './startupView.js';

function fakeScene({
  globe = { show: true, tilesLoaded: false },
  primitives = [],
} = {}) {
  const listeners = new Set();
  return {
    globe,
    primitives: { length: primitives.length, get: (i) => primitives[i] },
    renders: 0,
    requestRender() {
      this.renders += 1;
    },
    postRender: {
      addEventListener(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    frame() {
      for (const listener of [...listeners]) listener();
    },
    listeners,
  };
}

test('the globe, or else the shown 3D tilesets, decide whether tiles are in', () => {
  assert.equal(surfaceTilesLoaded(fakeScene()), false);
  assert.equal(
    surfaceTilesLoaded(fakeScene({ globe: { show: true, tilesLoaded: true } })),
    true,
  );
  const tileset = { show: true, tilesLoaded: false };
  const scene = fakeScene({ globe: { show: false }, primitives: [tileset] });
  assert.equal(surfaceTilesLoaded(scene), false);
  tileset.tilesLoaded = true;
  assert.equal(surfaceTilesLoaded(scene), true);
  assert.equal(
    surfaceTilesLoaded(fakeScene({ globe: { show: false } })),
    false,
  );
});

test('resolves on the first frame with every tile, and lets go of the listener', async () => {
  const scene = fakeScene();
  const waiting = waitForViewTiles({ scene, capMs: 10_000 });
  assert.equal(scene.renders, 1, 'asks for a frame so loading proceeds');
  // Loaded on the first frame is the old view's flag: not trusted yet.
  scene.globe.tilesLoaded = true;
  scene.frame();
  scene.globe.tilesLoaded = false;
  scene.frame();
  scene.globe.tilesLoaded = true;
  scene.frame();
  assert.equal(await waiting, 'loaded');
  assert.equal(scene.listeners.size, 0);
});

test('never waits past the cap, and stops at once on abort', async () => {
  assert.equal(await waitForViewTiles({ scene: fakeScene(), capMs: 5 }), 'cap');
  const controller = new AbortController();
  const scene = fakeScene();
  const waiting = waitForViewTiles({
    scene,
    signal: controller.signal,
    capMs: 10_000,
  });
  controller.abort();
  assert.equal(await waiting, 'aborted');
  assert.equal(scene.listeners.size, 0);
});
