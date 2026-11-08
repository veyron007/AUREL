import test from 'node:test';
import assert from 'node:assert/strict';
import { trafficFixtureTile } from '../../../scripts/traffic-fixtures.mjs';
import { decodeFlowTile } from './flowDecode.js';
import { createFlowDecodeClient } from './flowDecodeClient.js';

const TILE = Object.freeze({ z: 12, x: 935, y: 1686 });

function flowBytes() {
  return trafficFixtureTile(TILE.z, true);
}

/**
 * A stand-in Worker that runs the worker's decode on a later task and
 * answers through a structured clone, exactly what crosses a real thread.
 */
function fakeWorkerFactory(log = { posts: 0, terminated: 0 }) {
  return () => {
    const worker = {
      onmessage: null,
      onerror: null,
      postMessage(data) {
        log.posts += 1;
        const message = structuredClone(data);
        setTimeout(() => {
          let reply;
          try {
            reply = {
              id: message.id,
              ok: true,
              segments: decodeFlowTile(
                message.bytes,
                message.z,
                message.x,
                message.y,
                { strict: true },
              ),
            };
          } catch (error) {
            reply = { id: message.id, ok: false, message: error.message };
          }
          worker.onmessage?.({ data: structuredClone(reply) });
        }, 0);
      },
      terminate() {
        log.terminated += 1;
      },
    };
    return worker;
  };
}

test('worker-decoded flow tiles equal the same-thread decode', async () => {
  const log = { posts: 0, terminated: 0 };
  const client = createFlowDecodeClient({
    workerFactory: fakeWorkerFactory(log),
  });
  const bytes = flowBytes();
  const expected = decodeFlowTile(bytes, TILE.z, TILE.x, TILE.y, {
    strict: true,
  });
  assert.ok(expected.length > 0);
  const decoded = await client.decode(bytes, TILE.z, TILE.x, TILE.y);
  assert.deepEqual(decoded, expected);
  assert.equal(log.posts, 1, 'the tile went to the worker');
  assert.ok(bytes.byteLength > 0, 'the caller keeps its bytes');
  client.close();
  assert.equal(log.terminated, 1);
});

test('a malformed tile still rejects through the worker', async () => {
  const client = createFlowDecodeClient({ workerFactory: fakeWorkerFactory() });
  await assert.rejects(
    client.decode(new Uint8Array([0xff, 0xff, 0xff]), 12, 1, 1),
    /Malformed TomTom flow tile/,
  );
  client.close();
});

test('without Worker the client decodes on the calling thread', async () => {
  const client = createFlowDecodeClient({ workerFactory: () => null });
  const bytes = flowBytes();
  assert.deepEqual(
    await client.decode(bytes, TILE.z, TILE.x, TILE.y),
    decodeFlowTile(bytes, TILE.z, TILE.x, TILE.y, { strict: true }),
  );
});

test('a worker that dies hands its pending tiles to the calling thread', async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    let worker;
    const client = createFlowDecodeClient({
      workerFactory: () => {
        worker = { postMessage() {}, terminate() {} };
        return worker;
      },
    });
    const bytes = flowBytes();
    const pending = client.decode(bytes, TILE.z, TILE.x, TILE.y);
    worker.onerror({ message: 'chunk failed to load', preventDefault() {} });
    const expected = decodeFlowTile(bytes, TILE.z, TILE.x, TILE.y, {
      strict: true,
    });
    assert.deepEqual(await pending, expected);
    assert.deepEqual(
      await client.decode(bytes, TILE.z, TILE.x, TILE.y),
      expected,
      'later tiles decode here',
    );
  } finally {
    console.warn = originalWarn;
  }
});

test('close finishes pending tiles on the calling thread', async () => {
  const client = createFlowDecodeClient({
    workerFactory: () => ({ postMessage() {}, terminate() {} }),
  });
  const bytes = flowBytes();
  const pending = client.decode(bytes, TILE.z, TILE.x, TILE.y);
  client.close();
  assert.deepEqual(
    await pending,
    decodeFlowTile(bytes, TILE.z, TILE.x, TILE.y, { strict: true }),
  );
});
