/**
 * Run a generator in time slices so no single task holds the main thread
 * past `budgetMs`. The generator yields at safe points; the runner keeps
 * stepping until the slice budget is spent, then continues in a later task.
 * A job that fits in one slice finishes synchronously inside `start`, so
 * small rebuilds behave exactly as a plain call would.
 *
 * Starting a new job cancels the one in flight: its generator is closed
 * (its `finally` blocks run) and never resumed.
 */

/** Main-thread time one slice may take; well under a 16 ms frame. */
export const SLICE_BUDGET_MS = 8;

/**
 * @param {{
 *   budgetMs?: number,
 *   now?: () => number,
 *   schedule?: (run: () => void) => unknown,
 *   cancel?: (handle: unknown) => void,
 *   onError?: (error: unknown) => void,
 * }} [options]
 */
export function createSlicedJobRunner({
  budgetMs = SLICE_BUDGET_MS,
  now = () => performance.now(),
  schedule = (run) => setTimeout(run, 0),
  cancel = (handle) => clearTimeout(handle),
  onError = (error) => console.error('[FIRMS] Marker rebuild failed.', error),
} = {}) {
  let current = null;
  let handle = null;

  function stop() {
    if (handle !== null) cancel(handle);
    handle = null;
    const job = current;
    current = null;
    job?.return?.();
  }

  function step(job) {
    handle = null;
    if (current !== job) return;
    const sliceStart = now();
    try {
      for (;;) {
        const { done } = job.next();
        if (done) {
          if (current === job) current = null;
          return;
        }
        if (current !== job) return;
        if (now() - sliceStart >= budgetMs) break;
      }
    } catch (error) {
      if (current === job) current = null;
      onError(error);
      return;
    }
    handle = schedule(() => step(job));
  }

  return {
    /** Start a job, cancelling any job still in flight. */
    start(job) {
      stop();
      current = job;
      step(job);
    },
    /** Cancel the job in flight, if any. */
    cancel: stop,
    /** Whether a job is still running. */
    get running() {
      return current !== null;
    },
  };
}
