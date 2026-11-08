/**
 * Page reload after a Provider Settings save on the served build.
 *
 * Under `npm run dev`, Vite's client reloads the page when the server
 * restarts. The served build (scripts/serve-built.mjs) has no such client, so
 * the save response asks for `reload: 'poll'`: the page polls the status route
 * until a new server configuration (a different boot id) answers, then
 * reloads. A rebuild can take tens of seconds, hence the long deadline.
 */

export const RELOAD_POLL_MS = 1000;
export const RELOAD_DEADLINE_MS = 180_000;

const wait = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

async function currentBootId(doFetch, signal) {
  try {
    const response = await doFetch('/api/setup/status', {
      cache: 'no-store',
      signal,
    });
    if (!response.ok) return null;
    return (await response.json())?.bootId ?? null;
  } catch {
    // The server is down while it restarts or rebuilds.
    return null;
  }
}

/**
 * Wait for a restarted server, then reload. Resolves true when it reloaded,
 * false when aborted or when the deadline passed (the page then stays as it
 * is, with the saved status already shown).
 * @param {{doFetch: typeof fetch, bootId: string|null|undefined, signal?: AbortSignal, reload?: () => void, now?: () => number, pollMs?: number, deadlineMs?: number}} options
 * @returns {Promise<boolean>}
 */
export async function reloadWhenRestarted({
  doFetch,
  bootId,
  signal,
  reload = () => globalThis.location?.reload(),
  now = () => Date.now(),
  pollMs = RELOAD_POLL_MS,
  deadlineMs = RELOAD_DEADLINE_MS,
}) {
  const deadline = now() + deadlineMs;
  while (!signal?.aborted && now() < deadline) {
    await wait(pollMs, signal);
    if (signal?.aborted) return false;
    const next = await currentBootId(doFetch, signal);
    if (next && next !== bootId) {
      reload();
      return true;
    }
  }
  return false;
}
