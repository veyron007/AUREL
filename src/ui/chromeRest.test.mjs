import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHROME_REST_CLASS,
  CHROME_WAKE_EVENTS,
  ChromeRest,
  chromeHeldAwake,
} from './chromeRest.js';

/** Manual timers: run() fires the pending callback. */
function clock() {
  let pending = null;
  let next = 1;
  let time = 0;
  return {
    now: () => time,
    advance(ms) {
      time += ms;
    },
    setTimer(callback, ms) {
      pending = { id: next++, callback, ms, due: time + ms };
      return pending.id;
    },
    clearTimer(id) {
      if (pending?.id === id) pending = null;
    },
    get pending() {
      return pending;
    },
    run() {
      const current = pending;
      pending = null;
      if (current) time = current.due;
      current?.callback();
      return current;
    },
  };
}

function fixture({ held = () => false } = {}) {
  const timers = clock();
  const target = document.createElement('div');
  const events = new EventTarget();
  const rest = new ChromeRest({
    target,
    events,
    isHeld: held,
    delayMs: 5000,
    checkMs: 1000,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    now: timers.now,
  });
  return { rest, target, events, timers };
}

test('chrome rests only after the first input and a quiet spell', () => {
  const { rest, target, events, timers } = fixture();
  rest.start();
  assert.equal(timers.pending, null, 'the opening view is never timed out');
  events.dispatchEvent(new Event('pointermove'));
  assert.equal(timers.pending.ms, 5000);
  timers.run();
  assert.ok(target.classList.contains(CHROME_REST_CLASS));
  assert.equal(timers.pending.ms, 1000, 'a resting chrome keeps checking');
  rest.destroy();
});

test('any input wakes resting chrome and restarts the quiet spell', () => {
  const { rest, target, events, timers } = fixture();
  rest.start();
  for (const name of CHROME_WAKE_EVENTS) {
    events.dispatchEvent(new Event('keydown'));
    timers.run();
    assert.ok(target.classList.contains(CHROME_REST_CLASS));
    events.dispatchEvent(new Event(name));
    assert.ok(!target.classList.contains(CHROME_REST_CLASS), name);
    assert.equal(timers.pending.ms, 5000, name);
  }
  rest.destroy();
});

test('an open surface holds the chrome awake and wakes it while resting', () => {
  let held = false;
  const { rest, target, events, timers } = fixture({ held: () => held });
  rest.start();
  events.dispatchEvent(new Event('pointerdown'));
  held = true;
  timers.run();
  assert.ok(!target.classList.contains(CHROME_REST_CLASS));
  assert.equal(timers.pending.ms, 5000);
  held = false;
  timers.run();
  assert.ok(target.classList.contains(CHROME_REST_CLASS));
  // A voice turn or panel opens without new input.
  held = true;
  timers.run();
  assert.ok(!target.classList.contains(CHROME_REST_CLASS));
  rest.destroy();
});

test('a failing hold check keeps controls visible', () => {
  const { rest, target, events, timers } = fixture({
    held: () => {
      throw new Error('boom');
    },
  });
  rest.start();
  events.dispatchEvent(new Event('wheel'));
  timers.run();
  assert.ok(!target.classList.contains(CHROME_REST_CLASS));
  rest.destroy();
});

test('destroy removes listeners, the timer and the class', () => {
  const { rest, target, events, timers } = fixture();
  rest.start();
  events.dispatchEvent(new Event('keydown'));
  timers.run();
  rest.destroy();
  assert.ok(!target.classList.contains(CHROME_REST_CLASS));
  assert.equal(timers.pending, null);
  events.dispatchEvent(new Event('keydown'));
  assert.equal(timers.pending, null);
  rest.destroy();
});

test('focused fields, open panels, dialogs and the palette hold chrome awake', (t) => {
  document.body.replaceChildren();
  t.after(() => document.body.replaceChildren());
  assert.equal(chromeHeldAwake(document), false);

  const input = document.body.appendChild(document.createElement('input'));
  input.focus();
  assert.equal(chromeHeldAwake(document), true);
  input.blur();
  input.remove();

  const stack = document.body.appendChild(document.createElement('div'));
  stack.id = 'right-context-rail';
  const panel = stack.appendChild(document.createElement('section'));
  panel.dataset.panelId = 'lens-panel';
  panel.className = 'collapsed';
  assert.equal(chromeHeldAwake(document), false);
  panel.className = '';
  assert.equal(chromeHeldAwake(document), true);
  panel.dataset.workspaceSuppressed = 'true';
  assert.equal(
    chromeHeldAwake(document),
    false,
    'a suppressed panel is not shown',
  );
  stack.remove();

  const dialog = document.body.appendChild(document.createElement('div'));
  dialog.setAttribute('role', 'dialog');
  assert.equal(chromeHeldAwake(document), true);
  dialog.hidden = true;
  assert.equal(chromeHeldAwake(document), false);
  dialog.remove();

  const palette = document.body.appendChild(document.createElement('div'));
  palette.className = 'command-palette';
  assert.equal(chromeHeldAwake(document), true);
  palette.remove();

  const voice = document.body.appendChild(document.createElement('div'));
  voice.id = 'gev-voice-control';
  voice.dataset.status = 'listening';
  assert.equal(chromeHeldAwake(document), true);
  voice.dataset.status = 'ready';
  assert.equal(chromeHeldAwake(document), false);
});

test('an expanded control holds the chrome only while it is rendered', (t) => {
  document.body.replaceChildren();
  t.after(() => document.body.replaceChildren());
  const toggle = document.body.appendChild(document.createElement('button'));
  toggle.setAttribute('aria-expanded', 'true');
  toggle.checkVisibility = () => false;
  assert.equal(chromeHeldAwake(document), false);
  toggle.checkVisibility = () => true;
  assert.equal(chromeHeldAwake(document), true);
});

test('pointer moves while awake store a time instead of re-arming the timer', () => {
  const { rest, target, events, timers } = fixture();
  rest.start();
  events.dispatchEvent(new Event('pointermove'));
  const first = timers.pending;
  timers.advance(3000);
  events.dispatchEvent(new Event('pointermove'));
  events.dispatchEvent(new Event('pointermove'));
  assert.equal(timers.pending, first, 'the same timer stays armed');
  timers.run();
  assert.ok(!target.classList.contains(CHROME_REST_CLASS), 'input was 2 s ago');
  assert.equal(timers.pending.ms, 3000, 'it waits out the rest of the spell');
  timers.run();
  assert.ok(target.classList.contains(CHROME_REST_CLASS));
  rest.destroy();
});
