/**
 * Adaptive display quality (performance plan WP5.4, with WP4.8's adaptive
 * MSAA). In Auto it watches frame times while the scene renders continuously
 * and steps down one level after a sustained stretch of slow frames, and
 * back up after a longer stretch of fast ones:
 *
 *   level 0  full: 4x MSAA, full resolution, glass panes (the resting look)
 *   level 1  FXAA instead of MSAA
 *   level 2  and resolutionScale 0.85
 *   level 3  and solid panes (data-quality-panes='solid', spatial-budget.css)
 *
 * High, Balanced and Battery hold levels 0, 2 and 3. It never steps down
 * while a recording runs or a capture reads the canvas, so neither films a
 * cheaper frame than the person chose. A fast machine never leaves level 0:
 * stepping down needs frames over 20 ms for 3 s, measured only between
 * consecutive rendered frames after a warm-up.
 */

export const QUALITY_LEVELS = Object.freeze([
  Object.freeze({
    msaaSamples: 4,
    fxaa: false,
    resolutionScale: 1,
    solidPanes: false,
  }),
  Object.freeze({
    msaaSamples: 1,
    fxaa: true,
    resolutionScale: 1,
    solidPanes: false,
  }),
  Object.freeze({
    msaaSamples: 1,
    fxaa: true,
    resolutionScale: 0.85,
    solidPanes: false,
  }),
  Object.freeze({
    msaaSamples: 1,
    fxaa: true,
    resolutionScale: 0.85,
    solidPanes: true,
  }),
]);
export const TOP_LEVEL = QUALITY_LEVELS.length - 1;
export const MODE_LEVELS = Object.freeze({ high: 0, balanced: 2, battery: 3 });
export const QUALITY_PANES_ATTRIBUTE = 'data-quality-panes';

export const FRAME_BUDGET = Object.freeze({
  slowFrameMs: 20,
  fastWorkMs: 12,
  vsyncFrameMs: 18,
  stepDownAfterMs: 3000,
  stepUpAfterMs: 10000,
  // Gaps longer than this are idle time (request-render mode) or a hidden
  // tab, not frame cost.
  continuousGapMs: 250,
  warmUpMs: 15000,
});

/**
 * Pure frame-time judge with hysteresis. Feed one sample per rendered frame:
 * `intervalMs` since the previous frame and `workMs` the render took.
 * Returns 'down', 'up' or null; after a verdict both streaks start over.
 */
export function createFrameJudge(budget = FRAME_BUDGET) {
  let slowSince = null;
  let fastSince = null;
  const reset = () => {
    slowSince = null;
    fastSince = null;
  };
  return {
    reset,
    sample({ intervalMs, workMs, at }) {
      if (!(intervalMs > 0) || intervalMs > budget.continuousGapMs) {
        reset();
        return null;
      }
      const slow = intervalMs > budget.slowFrameMs;
      const fast =
        intervalMs <= budget.vsyncFrameMs && workMs < budget.fastWorkMs;
      slowSince = slow ? (slowSince ?? at) : null;
      fastSince = fast ? (fastSince ?? at) : null;
      if (slowSince !== null && at - slowSince >= budget.stepDownAfterMs) {
        reset();
        return 'down';
      }
      if (fastSince !== null && at - fastSince >= budget.stepUpAfterMs) {
        reset();
        return 'up';
      }
      return null;
    },
  };
}

/** The level a mode holds, or for Auto the adapted one clamped to range. */
export function levelForMode(mode, adapted) {
  if (Object.hasOwn(MODE_LEVELS, mode)) return MODE_LEVELS[mode];
  return Math.min(TOP_LEVEL, Math.max(0, adapted));
}

/** Write one level to the scene, viewer and page root. */
export function applyQualityLevel({ viewer, root }, level) {
  const settings = QUALITY_LEVELS[level];
  if (!settings) throw new RangeError(`Unknown quality level ${level}`);
  const scene = viewer.scene;
  if (scene.msaaSamples !== settings.msaaSamples)
    scene.msaaSamples = settings.msaaSamples;
  const fxaa = scene.postProcessStages?.fxaa;
  if (fxaa && fxaa.enabled !== settings.fxaa) fxaa.enabled = settings.fxaa;
  if (viewer.resolutionScale !== settings.resolutionScale)
    viewer.resolutionScale = settings.resolutionScale;
  root?.toggleAttribute?.(QUALITY_PANES_ATTRIBUTE, false);
  if (settings.solidPanes)
    root?.setAttribute?.(QUALITY_PANES_ATTRIBUTE, 'solid');
  scene.requestRender?.();
}

function nextAdapted(adapted, verdict, canStepDown) {
  if (verdict === 'down' && canStepDown)
    return Math.min(TOP_LEVEL, adapted + 1);
  if (verdict === 'up') return Math.max(0, adapted - 1);
  return adapted;
}

/**
 * @param {object} options
 * @param {object} options.viewer Cesium viewer.
 * @param {Element} options.root Page root for the solid-pane flag.
 * @param {() => string} options.readMode 'auto' | 'high' | 'balanced' | 'battery'.
 * @param {(level: number) => void} [options.publishLevel]
 * @param {() => boolean} [options.isRecording]
 * @param {() => boolean} [options.isCapturing]
 * @param {() => number} [options.now]
 * @returns {{sync: () => void, destroy: () => void, readLevel: () => number}}
 */
export function installQualityGovernor({
  viewer,
  root,
  readMode,
  publishLevel = () => {},
  isRecording = () => false,
  isCapturing = () => false,
  now = () => performance.now(),
}) {
  const scene = viewer?.scene;
  if (!scene?.preUpdate || !scene?.postRender || typeof readMode !== 'function')
    throw new TypeError(
      'installQualityGovernor needs a viewer and a mode reader',
    );
  const judge = createFrameJudge();
  const startedAt = now();
  let adapted = 0;
  let applied = null;
  let frameStart = null;
  let lastFrameEnd = null;
  let destroyed = false;

  const apply = () => {
    const level = levelForMode(readMode(), adapted);
    if (level === applied) return;
    try {
      applyQualityLevel({ viewer, root }, level);
      applied = level;
      publishLevel(level);
    } catch (error) {
      console.warn('[quality] could not apply level', level, error);
    }
  };
  const onPreUpdate = () => {
    frameStart = now();
  };
  const onPostRender = () => {
    const end = now();
    const intervalMs = lastFrameEnd === null ? 0 : end - lastFrameEnd;
    const workMs = frameStart === null ? 0 : end - frameStart;
    lastFrameEnd = end;
    if (readMode() !== 'auto' || end - startedAt < FRAME_BUDGET.warmUpMs)
      return;
    if (globalThis.document?.hidden) return judge.reset();
    const verdict = judge.sample({ intervalMs, workMs, at: end });
    if (!verdict) return;
    const holdLook = isRecording() || isCapturing();
    adapted = nextAdapted(adapted, verdict, !holdLook);
    apply();
  };
  const removePreUpdate = scene.preUpdate.addEventListener(onPreUpdate);
  const removePostRender = scene.postRender.addEventListener(onPostRender);
  apply();

  return {
    /** Re-apply after a mode change. */
    sync() {
      if (destroyed) return;
      if (readMode() !== 'auto') judge.reset();
      apply();
    },
    readLevel: () => applied,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      removePreUpdate?.();
      removePostRender?.();
      root?.removeAttribute?.(QUALITY_PANES_ATTRIBUTE);
    },
  };
}
