/**
 * The MCP server's side of the agent desk: submits Field Kit requests to the
 * relay on the running AUREL server and returns the tab's answer. When the
 * server is not running, or runs without the relay, the answer is a typed
 * `no_app_session` refusal, never a thrown internal error.
 */

import { sanitizeClientName } from '../../src/fieldkit/author.js';

const PATH = '/api/agent-desk/requests';
/** Longer than the relay's own render timeout, so its refusal arrives first. */
const CLIENT_TIMEOUT_MS = 40_000;

const noApp = (message) => ({
  ok: false,
  refusal: { code: 'no_app_session', message, details: null },
});

/**
 * @param {{ fetchImpl: Function, clientName: () => string, now?: () => number }} options
 * `fetchImpl` resolves relative paths against the AUREL server (createApiFetch).
 */
export function createAgentDeskClient({
  fetchImpl,
  clientName,
  now = Date.now,
}) {
  return Object.freeze({
    now,
    async request(op, args, { signal } = {}) {
      const timeout = AbortSignal.timeout(CLIENT_TIMEOUT_MS);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let response;
      try {
        response = await fetchImpl(PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            op,
            args,
            client: sanitizeClientName(clientName()),
          }),
          signal: combined,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        return noApp(
          'The AUREL server is not reachable. Start it with npm run dev and open AUREL, then retry.',
        );
      }
      if (!response?.ok)
        return noApp(
          `The AUREL server answered ${response?.status ?? 'nothing'} for agent requests; it may be an older build without the agent desk.`,
        );
      try {
        return await response.json();
      } catch {
        return noApp('The AUREL server returned an unreadable answer.');
      }
    },
  });
}
