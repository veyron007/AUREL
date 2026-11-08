import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLUR_TEXTURE_SCALE,
  createSeparableStyleStage,
} from './separableStages.js';
import { thermalShader } from './thermal.js';
import { nightVisionShader } from './surveillance.js';

const createStage = (options) => ({ ...options, uniforms: options.uniforms });
const createComposite = (options) => ({ ...options, enabled: true });

function defaults(shader) {
  const uniforms = { intensity: 0, time: 0 };
  for (const [name, meta] of Object.entries(shader.uniforms))
    uniforms[name] = meta.default;
  return uniforms;
}

test('a style composite runs its blur passes at half resolution, then the main pass', () => {
  const stage = thermalShader.buildStage({
    name: 'godsEyeView_thermal',
    uniforms: defaults(thermalShader),
    createStage,
    createComposite,
  });
  assert.equal(stage.inputPreviousStageTexture, false);
  assert.deepEqual(
    stage.stages.map((s) => [s.name, s.textureScale]),
    [
      ['godsEyeView_thermal_blurH', BLUR_TEXTURE_SCALE],
      ['godsEyeView_thermal_blurV', BLUR_TEXTURE_SCALE],
      ['godsEyeView_thermal_main', undefined],
    ],
  );
  const [h, v, main] = stage.stages;
  assert.deepEqual(Object.keys(h.uniforms).sort(), ['mode', 'sensitivity']);
  assert.equal(v.uniforms.thermalBlurH, 'godsEyeView_thermal_blurH');
  assert.equal(main.uniforms.thermalBlur, 'godsEyeView_thermal_blurV');
  assert.match(main.fragmentShader, /uniform sampler2D thermalBlur;/);
  assert.doesNotMatch(
    main.fragmentShader,
    /for \(int y = -4/,
    'no 9 x 9 loop left',
  );
});

test('composite uniforms forward to every stage that declares them', () => {
  const stage = thermalShader.buildStage({
    name: 't',
    uniforms: defaults(thermalShader),
    createStage,
    createComposite,
  });
  const [h, v, main] = stage.stages;
  stage.uniforms.sensitivity = 0.2;
  stage.uniforms.intensity = 1;
  assert.equal(h.uniforms.sensitivity, 0.2);
  assert.equal(main.uniforms.sensitivity, 0.2);
  assert.equal(main.uniforms.intensity, 1);
  assert.equal('intensity' in h.uniforms, false);
  assert.equal('sensitivity' in v.uniforms, false);
  assert.equal(stage.uniforms.intensity, 1);
  assert.notEqual(stage.uniforms.time, undefined, 'animation loop sees time');
});

test('night vision splits its 11 x 11 bloom into two passes', () => {
  const stage = nightVisionShader.buildStage({
    name: 'n',
    uniforms: defaults(nightVisionShader),
    createStage,
    createComposite,
  });
  const [h, v, main] = stage.stages;
  assert.deepEqual(Object.keys(h.uniforms), ['gain']);
  assert.equal(v.uniforms.nvgBloomH, 'n_bloomH');
  assert.equal(main.uniforms.nvgBloom, 'n_bloomV');
  assert.doesNotMatch(main.fragmentShader, /for \(int y = -5/);
  for (const pass of nightVisionShader.blurPasses())
    assert.equal((pass.fragmentShader.match(/texture\(/g) || []).length, 1);
});

test('the pass weights are the former 2D Gaussian factors', () => {
  // Thermal IR exp(-x^2/4), bloom exp(-x^2/16); NVG exp(-x^2/18).
  const check = (source, name, divisor, count) => {
    const list = source.match(
      new RegExp(`${name}\\[${count}\\] = float\\[${count}\\]\\(([^)]*)\\)`),
    );
    assert.ok(list, name);
    const values = list[1].split(',').map(Number);
    values.forEach((value, x) =>
      assert.ok(Math.abs(value - Math.exp((-x * x) / divisor)) < 1e-6),
    );
  };
  const [thermalH] = thermalShader.blurPasses();
  check(thermalH.fragmentShader, 'IR_W', 4, 3);
  check(thermalH.fragmentShader, 'BLOOM_W', 16, 5);
  const [nvgH] = nightVisionShader.blurPasses();
  check(nvgH.fragmentShader, 'BLOOM_W', 18, 6);
});

test('a missing composite factory is an explicit error', () => {
  assert.throws(
    () =>
      createSeparableStyleStage({
        name: 'x',
        passes: [],
        main: { fragmentShader: '', samplers: {} },
        uniforms: {},
        createStage,
      }),
    /composite stage factory/,
  );
});
