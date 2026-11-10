import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FRAME_BUDGET,
  QUALITY_PANES_ATTRIBUTE,
  createFrameJudge,
  installQualityGovernor,
  labelDensityFor,
  levelForMode,
  REDUCED_LABEL_DENSITY,
} from './qualityGovernor.js';

function eventSource() {
  const listeners = new Set();
  return {
    addEventListener(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    raise() {
      for (const listener of [...listeners]) listener();
    },
    get size() {
      return listeners.size;
    },
  };
}

function fixture({ mode = 'auto', recording = false, capturing = false } = {}) {
  let time = 0;
  const attributes = new Map();
  const scene = {
    msaaSamples: 4,
    postProcessStages: { fxaa: { enabled: false } },
    preUpdate: eventSource(),
    postRender: eventSource(),
    renders: 0,
    requestRender() {
      this.renders++;
    },
  };
  const viewer = { scene, resolutionScale: 1 };
  const root = {
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    toggleAttribute: (name, on) =>
      on ? attributes.set(name, '') : attributes.delete(name),
  };
  const state = { mode, recording, capturing, published: [], densities: [] };
  const governor = installQualityGovernor({
    viewer,
    root,
    readMode: () => state.mode,
    publishLevel: (level) => state.published.push(level),
    setLabelDensity: (density) => state.densities.push(density),
    isRecording: () => state.recording,
    isCapturing: () => state.capturing,
    now: () => time,
  });
  /** Render frames of `workMs` every `intervalMs` for `forMs`. */
  const frames = (intervalMs, forMs, workMs = intervalMs * 0.5) => {
    for (let elapsed = 0; elapsed < forMs; elapsed += intervalMs) {
      time += intervalMs - workMs;
      scene.preUpdate.raise();
      time += workMs;
      scene.postRender.raise();
    }
  };
  const warmUp = () => frames(16.7, FRAME_BUDGET.warmUpMs + 100, 4);
  return { viewer, scene, attributes, state, governor, frames, warmUp };
}

test('the judge needs 3 s of slow frames to step down and 10 s of fast ones to step up', () => {
  const judge = createFrameJudge();
  let at = 0;
  const run = (intervalMs, workMs, forMs) => {
    let verdict = null;
    for (let elapsed = 0; elapsed < forMs && !verdict; elapsed += intervalMs) {
      at += intervalMs;
      verdict = judge.sample({ intervalMs, workMs, at });
    }
    return verdict;
  };
  assert.equal(run(25, 20, 2900), null);
  assert.equal(run(25, 20, 200), 'down');
  assert.equal(run(16.7, 6, 9900), null);
  assert.equal(run(16.7, 6, 200), 'up');
  // Between the thresholds nothing happens (hysteresis).
  assert.equal(run(19, 14, 20000), null);
  // An idle gap breaks a slow streak.
  assert.equal(run(25, 20, 2000), null);
  assert.equal(
    judge.sample({ intervalMs: 900, workMs: 5, at: (at += 900) }),
    null,
  );
  assert.equal(run(25, 20, 2000), null);
});

test('modes hold their levels and Auto stays within range', () => {
  assert.equal(levelForMode('high', 3), 0);
  assert.equal(levelForMode('balanced', 0), 2);
  assert.equal(levelForMode('battery', 0), 4);
  assert.equal(levelForMode('auto', 9), 4);
  assert.equal(levelForMode('auto', -1), 0);
});

test('a fast machine in Auto keeps the full-quality look', () => {
  const { scene, viewer, attributes, frames, warmUp, state } = fixture();
  warmUp();
  frames(16.7, 60000, 5);
  assert.equal(scene.msaaSamples, 4);
  assert.equal(scene.postProcessStages.fxaa.enabled, false);
  assert.equal(viewer.resolutionScale, 1);
  assert.equal(attributes.has(QUALITY_PANES_ATTRIBUTE), false);
  assert.deepEqual(state.published, [0]);
});

test('sustained slow frames step down in order, fast frames step back up', () => {
  const { scene, viewer, attributes, frames, warmUp, governor } = fixture();
  warmUp();
  frames(30, 3100, 25);
  assert.equal(governor.readLevel(), 1);
  assert.equal(scene.msaaSamples, 1);
  assert.equal(scene.postProcessStages.fxaa.enabled, true);
  frames(30, 3100, 25);
  assert.equal(viewer.resolutionScale, 0.85);
  frames(30, 3100, 25);
  assert.equal(attributes.get(QUALITY_PANES_ATTRIBUTE), 'solid');
  assert.equal(governor.readLabelDensity(), 1, 'labels go last');
  frames(30, 3100, 25);
  assert.equal(governor.readLevel(), 4);
  assert.equal(governor.readLabelDensity(), REDUCED_LABEL_DENSITY);
  frames(30, 3100, 25);
  assert.equal(governor.readLevel(), 4, 'never past the last level');
  frames(16.7, 10200, 5);
  assert.equal(governor.readLevel(), 3);
  assert.equal(governor.readLabelDensity(), 1, 'labels come back first');
  frames(16.7, 10200, 5);
  assert.equal(governor.readLevel(), 2);
  assert.equal(attributes.has(QUALITY_PANES_ATTRIBUTE), false);
});

test('startup frames are ignored during the warm-up', () => {
  const { governor, frames } = fixture();
  frames(40, FRAME_BUDGET.warmUpMs - 1000, 35);
  assert.equal(governor.readLevel(), 0);
});

test('no step down while recording or capturing', () => {
  for (const hold of [{ recording: true }, { capturing: true }]) {
    const { governor, frames, warmUp } = fixture(hold);
    warmUp();
    frames(30, 7000, 25);
    assert.equal(governor.readLevel(), 0, JSON.stringify(hold));
  }
});

test('a manual mode applies at once and Auto resumes adapting from it', () => {
  const { governor, state, scene, viewer, attributes } = fixture();
  state.mode = 'battery';
  governor.sync();
  assert.equal(scene.msaaSamples, 1);
  assert.equal(viewer.resolutionScale, 0.85);
  assert.equal(attributes.get(QUALITY_PANES_ATTRIBUTE), 'solid');
  state.mode = 'high';
  governor.sync();
  assert.equal(scene.msaaSamples, 4);
  assert.equal(attributes.has(QUALITY_PANES_ATTRIBUTE), false);
  assert.deepEqual(state.published, [0, 4, 0]);
  assert.deepEqual(state.densities, [1, REDUCED_LABEL_DENSITY, 1]);
});

test('High keeps full labels; Balanced and Battery show fewer, restored on High', () => {
  assert.equal(labelDensityFor('high', 0), 1);
  assert.equal(labelDensityFor('auto', 0), 1);
  assert.equal(labelDensityFor('auto', 3), 1);
  assert.equal(labelDensityFor('auto', 4), REDUCED_LABEL_DENSITY);
  assert.equal(labelDensityFor('balanced', 2), REDUCED_LABEL_DENSITY);
  assert.equal(labelDensityFor('battery', 4), REDUCED_LABEL_DENSITY);
  const { governor, state } = fixture({ mode: 'high' });
  assert.deepEqual(state.densities, [1]);
  state.mode = 'balanced';
  governor.sync();
  state.mode = 'high';
  governor.sync();
  assert.deepEqual(state.densities, [1, REDUCED_LABEL_DENSITY, 1]);
});

test('a fast machine in Auto never touches label density after the first apply', () => {
  const { frames, warmUp, state } = fixture();
  warmUp();
  frames(16.7, 60000, 5);
  assert.deepEqual(state.densities, [1]);
});

test('destroy restores full label density', () => {
  const { governor, state } = fixture({ mode: 'battery' });
  governor.destroy();
  assert.deepEqual(state.densities, [REDUCED_LABEL_DENSITY, 1]);
});

test('destroy removes listeners and the pane flag', () => {
  const { governor, scene, state, attributes } = fixture({ mode: 'battery' });
  assert.equal(attributes.get(QUALITY_PANES_ATTRIBUTE), 'solid');
  governor.destroy();
  governor.destroy();
  assert.equal(scene.preUpdate.size, 0);
  assert.equal(scene.postRender.size, 0);
  assert.equal(attributes.has(QUALITY_PANES_ATTRIBUTE), false);
  state.mode = 'high';
  governor.sync();
  assert.equal(scene.msaaSamples, 1, 'a destroyed governor changes nothing');
});

test('a viewer without render events is an explicit error', () => {
  assert.throws(
    () => installQualityGovernor({ viewer: {}, readMode: () => 'auto' }),
    /needs a viewer/,
  );
});
