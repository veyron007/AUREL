import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalCommandController } from './localCommandController.js';
import { createOwners } from './stores/owners.js';
function setup(options = {}) {
  const owners = createOwners(),
    views = [],
    calls = [];
  const controller = new LocalCommandController({
    store: { ...owners, publish: (view) => views.push(view) },
    readContext: () => ({ origin: 'user' }),
    execute: async (command) => {
      calls.push(command);
      return true;
    },
    ...options,
  });
  controller.init();
  return { controller, calls, views, owners, view: () => views.at(-1) };
}
test('typing, preview and mission templates never execute; Run needs explicit preview', async () => {
  const x = setup();
  x.controller.setInput('open planner');
  assert.equal(await x.controller.run(), false);
  x.controller.preview();
  assert.equal(x.view().proposal.command.args.panelId, 'planner-panel');
  assert.equal(x.calls.length, 0);
  assert.equal(await x.controller.run(), true);
  assert.equal(x.calls.length, 1);
  assert.equal(x.view().status, 'completed');
  assert.equal(await x.controller.run(), false);
  x.controller.setInput('openai billing');
  x.controller.preview();
  assert.equal(x.view().canRun, false);
  x.controller.clear();
  assert.equal(x.view().input, '');
  x.controller.destroy();
});
test('Run freshly validates prerequisites and selection identity', async () => {
  let context = { hasSelection: true, selectionKey: 'dehradun' };
  const x = setup({ readContext: () => context });
  x.controller.setInput('save place');
  x.controller.preview();
  context = { hasSelection: false };
  assert.equal(await x.controller.run(), false);
  assert.equal(x.view().error, 'no-selected-place');
  context = { hasSelection: true, selectionKey: 'dehradun' };
  x.controller.preview();
  context = { hasSelection: true, selectionKey: 'austin' };
  assert.equal(await x.controller.run(), false);
  assert.equal(x.view().error, 'context-changed');
  assert.equal(x.calls.length, 0);
});
test('pending completion is awaited; cancel suppresses late success and overlap', async () => {
  let resolve, signal;
  const x = setup({
    execute: (_command, options) => {
      signal = options.signal;
      return new Promise((done) => {
        resolve = done;
      });
    },
  });
  x.controller.setInput('open research');
  x.controller.preview();
  const pending = x.controller.run();
  assert.equal(x.view().status, 'running');
  assert.equal(x.view().busy, true);
  x.controller.cancel();
  assert.equal(signal.aborted, true);
  assert.equal(x.view().status, 'cancelled');
  assert.equal(await x.controller.run(), false);
  resolve(true);
  assert.equal(await pending, false);
  assert.equal(x.view().status, 'cancelled');
  assert.equal(x.view().busy, false);
});
test('undefined/false/throwing owner outcomes never report completion and destroy detaches', async () => {
  for (const execute of [
    async () => undefined,
    async () => false,
    async () => {
      throw Error('private-key');
    },
  ]) {
    const x = setup({ execute });
    x.controller.setInput('open planner');
    x.controller.preview();
    assert.equal(await x.controller.run(), false);
    assert.equal(x.view().error, 'action-unavailable');
    assert.ok(!JSON.stringify(x.views).includes('private-key'));
    x.controller.destroy();
    assert.equal(x.owners.act('preview'), undefined);
  }
  let done;
  const x = setup({
    execute: () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  });
  x.controller.setInput('open planner');
  x.controller.preview();
  const pending = x.controller.run();
  x.controller.destroy();
  const count = x.views.length;
  done(true);
  assert.equal(await pending, false);
  assert.equal(x.views.length, count);
});
test('store actions retain owner isolation and clear invalid input without execution', async () => {
  const x = setup();
  x.controller.init();
  x.owners.act('setInput', 'open research');
  assert.equal(x.owners.act('preview'), true);
  assert.equal(await x.owners.act('run'), true);
  assert.equal(x.owners.act('cancel'), false);
  assert.equal(x.owners.act('clear'), true);
  x.controller.setInput(null);
  x.controller.preview();
  assert.equal(x.view().error, 'empty-command');
  x.owners.connect({ run: () => true });
  assert.equal(x.controller.setInput('save route'), false);
  assert.equal(x.controller.preview(), false);
  x.controller.destroy();
  x.controller.destroy();
});
