/**
 * Builds a visual style as a PostProcessStageComposite: half-resolution
 * blur passes followed by the style's own full-resolution pass.
 *
 * FLIR and night vision each blurred inside their main shader with an
 * N x N loop, 81 to 121 texture reads per screen pixel every frame. A
 * Gaussian with weight w(x) * w(y) is separable, so the same sum is a
 * horizontal pass then a vertical pass of N reads each, and at half
 * resolution those passes cover a quarter of the pixels. The main pass then
 * reads the blurred result once at the point it used to centre its loop.
 *
 * Every stage takes the scene as `colorTexture`
 * (`inputPreviousStageTexture: false`); a pass reads an earlier pass through
 * a sampler uniform whose value is that stage's name, which Cesium resolves
 * to the stage's output texture. The composite's `uniforms` forward each
 * style uniform to every stage that declares it, so callers keep setting
 * `stage.uniforms.intensity` and friends as on a single stage.
 */

/** Blur passes render at this fraction of the viewport. */
export const BLUR_TEXTURE_SCALE = 0.5;

const pick = (source, keys) =>
  Object.fromEntries(
    keys.filter((key) => key in source).map((key) => [key, source[key]]),
  );

/**
 * @param {object} options
 * @param {string} options.name Composite name; stages are `${name}_${id}`.
 * @param {Array<{id:string, fragmentShader:string, uniformNames?:string[],
 *   samplers?:Object<string,string>}>} options.passes Blur passes in order;
 *   `samplers` maps a sampler uniform to an earlier pass id.
 * @param {{fragmentShader:string, samplers:Object<string,string>}} options.main
 *   The style's own pass.
 * @param {Object<string, number>} options.uniforms Style uniform values.
 * @param {function(object): object} options.createStage PostProcessStage factory.
 * @param {function(object): object} options.createComposite
 *   PostProcessStageComposite factory.
 * @returns {object} The composite.
 */
export function createSeparableStyleStage({
  name,
  passes,
  main,
  uniforms,
  createStage,
  createComposite,
}) {
  if (typeof createComposite !== 'function')
    throw new TypeError(`Style ${name} needs a composite stage factory`);
  const stageName = (id) => `${name}_${id}`;
  const samplerUniforms = (samplers = {}) =>
    Object.fromEntries(
      Object.entries(samplers).map(([uniform, id]) => [uniform, stageName(id)]),
    );
  const blurStages = passes.map((pass) =>
    createStage({
      name: stageName(pass.id),
      fragmentShader: pass.fragmentShader,
      textureScale: BLUR_TEXTURE_SCALE,
      uniforms: {
        ...pick(uniforms, pass.uniformNames || []),
        ...samplerUniforms(pass.samplers),
      },
    }),
  );
  const mainStage = createStage({
    name: stageName('main'),
    fragmentShader: main.fragmentShader,
    uniforms: { ...uniforms, ...samplerUniforms(main.samplers) },
  });
  const stages = [...blurStages, mainStage];
  return createComposite({
    name,
    stages,
    inputPreviousStageTexture: false,
    uniforms: forwardingUniforms(Object.keys(uniforms), stages, mainStage),
  });
}

/** One object whose properties read the main stage and write every stage. */
function forwardingUniforms(keys, stages, mainStage) {
  const alias = {};
  for (const key of keys) {
    Object.defineProperty(alias, key, {
      enumerable: true,
      get: () => mainStage.uniforms[key],
      set: (value) => {
        for (const stage of stages)
          if (key in stage.uniforms) stage.uniforms[key] = value;
      },
    });
  }
  return alias;
}
