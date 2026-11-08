import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEFT_PANEL_OPEN_FLAG,
  hudIsMinimal,
  setBodyFlag,
  watchLeftPanels,
} from './bodyFlags.js';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('the minimal HUD flag needs an active minimal layout', () => {
  assert.equal(hudIsMinimal({ active: true, variant: 'minimal' }), true);
  assert.equal(hudIsMinimal({ active: false, variant: 'minimal' }), false);
  assert.equal(hudIsMinimal({ active: true, variant: 'tactical' }), false);
  assert.equal(hudIsMinimal(null), false);
  const body = document.createElement('div');
  setBodyFlag(body, 'data-x', true);
  assert.equal(body.hasAttribute('data-x'), true);
  setBodyFlag(body, 'data-x', false);
  assert.equal(body.hasAttribute('data-x'), false);
});

test('the left panel flag follows the stack panels open and closed', async () => {
  const body = document.createElement('div');
  const stack = document.createElement('div');
  const panel = document.createElement('div');
  panel.className = 'panel-collapsible collapsed';
  stack.append(panel);
  const stop = watchLeftPanels(stack, body);
  assert.equal(body.hasAttribute(LEFT_PANEL_OPEN_FLAG), false);
  panel.classList.remove('collapsed');
  await flush();
  assert.equal(body.hasAttribute(LEFT_PANEL_OPEN_FLAG), true);
  panel.classList.add('collapsed');
  await flush();
  assert.equal(body.hasAttribute(LEFT_PANEL_OPEN_FLAG), false);
  const late = document.createElement('div');
  late.className = 'panel-collapsible';
  stack.append(late);
  await flush();
  assert.equal(body.hasAttribute(LEFT_PANEL_OPEN_FLAG), true);
  stop();
  assert.equal(body.hasAttribute(LEFT_PANEL_OPEN_FLAG), false);
});

test('watching needs both elements', () => {
  assert.throws(() => watchLeftPanels(null, {}), /needs elements/);
});
