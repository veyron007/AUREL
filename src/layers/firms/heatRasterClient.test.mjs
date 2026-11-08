import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeatRasterClient } from './heatRasterClient.js';
import {
  buildHeatRaster,
  buildHeatRasterFromPacked,
  packHeatFires,
} from '../../data/firmsHeatRaster.js';

const OPTIONS = Object.freeze({ width: 64, height: 32, sigmaPx: 1 });

const fires = [
  { lat: 10, lon: 20, frp: 40 },
  { lat: -5.5, lon: -170.2, frp: 0 },
  { lat: 60.1, lon: 179.9, frp: null },
  { lat: Number.NaN, lon: 3, frp: 9 },
];

/** A worker stand-in that runs the real build on its next turn. */
function fakeWorker({ fail = false } = {}) {
  const worker = {
    posted: [],
    transfers: [],
    terminated: false,
    postMessage(message, transfer) {
      this.posted.push(message);
      this.transfers.push(transfer);
      queueMicrotask(() => {
        if (fail) {
          this.onerror?.({ message: 'boom', preventDefault() {} });
          return;
        }
        const raster = buildHeatRasterFromPacked(message, message.options);
        this.onmessage?.({
          data: {
            id: message.id,
            ok: true,
            width: raster.width,
            height: raster.height,
            reference: raster.reference,
            image: { width: raster.width, height: raster.height, raster },
          },
        });
      });
    },
    terminate() {
      this.terminated = true;
    },
  };
  return worker;
}

const canvasStub = (width, height) => ({
  width,
  height,
  getContext: () => ({
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {},
  }),
});

test('packed columns bin to the same raster as the records', () => {
  const direct = buildHeatRaster(fires, OPTIONS);
  const packed = buildHeatRasterFromPacked(packHeatFires(fires), OPTIONS);
  assert.deepEqual(packed.rgba, direct.rgba);
  assert.equal(packed.reference, direct.reference);
  assert.equal(packHeatFires(fires).lat.length, 3, 'no position, no column');
});

test('a worker build transfers the columns and resolves the image', async () => {
  const worker = fakeWorker();
  const client = createHeatRasterClient({ createWorker: () => worker });
  assert.equal(client.mode, 'worker');
  const result = await client.build(fires, OPTIONS);
  assert.equal(result.width, 64);
  assert.deepEqual(
    result.image.raster.rgba,
    buildHeatRaster(fires, OPTIONS).rgba,
  );
  assert.equal(worker.transfers[0].length, 3);
  client.destroy();
  assert.equal(worker.terminated, true);
});

test('only the newest build resolves; superseded ones resolve null', async () => {
  const worker = fakeWorker();
  const client = createHeatRasterClient({ createWorker: () => worker });
  const first = client.build(fires, OPTIONS);
  const second = client.build(fires.slice(0, 1), OPTIONS);
  assert.equal(await first, null);
  assert.ok(await second);
});

test('no worker builds on the main thread, without a PNG', async () => {
  const client = createHeatRasterClient({
    createWorker: () => null,
    createCanvas: canvasStub,
  });
  assert.equal(client.mode, 'main-thread');
  const result = await client.build(fires, OPTIONS);
  assert.equal(result.width, 64);
  assert.ok(result.image, 'an image (bitmap or canvas) is returned');
  assert.equal(typeof result.image.toDataURL, 'undefined');
});

test('a worker that throws on creation or fails falls back and reports it', async () => {
  const reported = [];
  const throwing = createHeatRasterClient({
    createWorker: () => {
      throw new Error('CSP refused');
    },
    createCanvas: canvasStub,
    onFallback: (error) => reported.push(error.message),
  });
  assert.ok(await throwing.build(fires, OPTIONS));
  const failing = createHeatRasterClient({
    createWorker: () => fakeWorker({ fail: true }),
    createCanvas: canvasStub,
    onFallback: (error) => reported.push(error.message),
  });
  const result = await failing.build(fires, OPTIONS);
  assert.equal(result.width, 64, 'the pending build is retried in-thread');
  assert.equal(failing.mode, 'main-thread');
  assert.deepEqual(reported, ['CSP refused', 'boom']);
});
