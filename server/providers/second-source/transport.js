import { readResponseTextCapped } from '../common/http.js';
import { providerUserAgent } from '../common/userAgent.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_RETRIES = 1;
const BACKOFF_BASE_MS = 600;
const SPACING_WAIT_MAX_MS = 1_500;

const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener?.(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/** Retry-After as milliseconds, or null when absent or unusable. */
export function retryAfterMs(headers, now = Date.now()) {
  const raw = headers?.get?.('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(raw);
  return Number.isFinite(at) && at > now ? at - now : null;
}

const retryable = (status) => status === null || status >= 500;

/**
 * GET one bounded upstream URL through its ledger.
 *
 * Every attempt (including retries) is reserved before dispatch. Network
 * failures and 5xx are retried with exponential backoff; 4xx and 429 are not
 * (429 opens the ledger cooldown instead). The result is typed and never
 * throws for upstream conditions:
 *   {ok:true, status, text}
 *   {ok:false, kind:'denied', reason, retryAfterMs}
 *   {ok:false, kind:'http', status}
 *   {ok:false, kind:'network', message}
 *   {ok:false, kind:'too-large'}
 *
 * @param {object} options
 * @param {{reserve: Function, settle: Function}} options.ledger
 * @param {string} options.url
 * @param {string} options.agent Short provider name for the User-Agent.
 * @param {typeof fetch} [options.fetchImpl]
 * @param {AbortSignal} [options.signal]
 */
export async function fetchBounded({
  ledger,
  url,
  agent,
  fetchImpl = fetch,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
  retries = DEFAULT_RETRIES,
  sleep = wait,
  accept = 'application/json',
}) {
  let last = { ok: false, kind: 'network', message: 'not attempted' };
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) {
      try {
        await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1), signal);
      } catch {
        return { ok: false, kind: 'network', message: 'aborted' };
      }
    }
    let reservation = ledger.reserve();
    // Two selections a moment apart wait out the spacing instead of failing;
    // anything longer is refused rather than queued.
    if (
      !reservation.ok &&
      reservation.reason === 'min-interval' &&
      reservation.retryAfterMs <= SPACING_WAIT_MAX_MS
    ) {
      try {
        await sleep(reservation.retryAfterMs, signal);
      } catch {
        return { ok: false, kind: 'network', message: 'aborted' };
      }
      reservation = ledger.reserve();
    }
    if (!reservation.ok) {
      // A retry refused by the budget reports the real upstream failure.
      if (attempt > 0) return last;
      return {
        ok: false,
        kind: 'denied',
        reason: reservation.reason,
        retryAfterMs: reservation.retryAfterMs,
      };
    }
    const deadline = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let status = null;
    try {
      const response = await fetchImpl(url, {
        headers: {
          Accept: accept,
          'User-Agent': providerUserAgent(agent),
        },
        signal: combined,
      });
      status = response.status;
      if (status === 204) {
        ledger.settle({ ok: true, status });
        await response.body?.cancel?.().catch(() => {});
        return { ok: true, status, text: '' };
      }
      if (!response.ok) {
        await response.body?.cancel?.().catch(() => {});
        ledger.settle({
          ok: false,
          status,
          retryAfterMs: retryAfterMs(response.headers),
          final: attempt === retries || !retryable(status),
        });
        last = { ok: false, kind: 'http', status };
        if (!retryable(status)) return last;
        continue;
      }
      const text = await readResponseTextCapped(response, maxBytes, combined);
      ledger.settle({ ok: true, status });
      return { ok: true, status, text };
    } catch (error) {
      if (error?.code === 'RESPONSE_TOO_LARGE') {
        ledger.settle({ ok: false, status });
        return { ok: false, kind: 'too-large' };
      }
      ledger.settle({ ok: false, status: null });
      last = {
        ok: false,
        kind: 'network',
        message: signal?.aborted ? 'aborted' : error?.name || 'fetch failed',
      };
      if (signal?.aborted) return last;
    }
  }
  return last;
}
