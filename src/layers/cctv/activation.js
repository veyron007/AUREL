/**
 * The two slow requests behind CCTV activation, started together as soon as
 * the catalog is in hand so neither waits on the other: the ground-prior batch
 * (heights for every camera) and the health check (which ranks crowded cells).
 * Cameras are drawn after at most a brief wait for the priors; priors that
 * arrive later are applied by `applyLateGroundPriors`, and health is applied
 * when it lands.
 *
 * @param {{
 *   catalog: object[],
 *   resolveGroundPriors: (catalog: object[]) => Promise<?Array<object>>,
 *   syncHealth: () => Promise<void>,
 * }} options
 * @returns {{priors: Promise<?Array<object>>, health: Promise<void>}}
 */
export function startActivationRequests({
  catalog,
  resolveGroundPriors,
  syncHealth,
}) {
  const priors = resolveGroundPriors(catalog);
  // Health is advisory: a failure keeps the previous map (health.js) and must
  // never fail activation.
  let health;
  try {
    health = Promise.resolve(syncHealth()).catch(() => {});
  } catch {
    health = Promise.resolve();
  }
  return { priors, health };
}

/**
 * The priors if they arrive within `waitMs` (a warm proxy cache answers in
 * milliseconds), else null so the cameras are drawn without waiting.
 * @param {Promise<?Array<object>>} priors
 * @param {number} waitMs
 * @returns {Promise<?Array<object>>}
 */
export function awaitPriorsBriefly(priors, waitMs) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), waitMs);
  });
  return Promise.race([priors.catch(() => null), deadline]).finally(() =>
    clearTimeout(timer),
  );
}
