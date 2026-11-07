import { readResponseJsonCapped } from './httpBody.js';
import { requestWithDeadline } from './requestDeadline.js';
import {
  validateAnalysisInput,
  validateSearchInput,
} from '../research/request.js';
/** Same-origin research only; geospatial validation is loaded on explicit use. */
export function createSentinelResearchSource({
  fetchImpl,
  timeoutMs = 60000,
} = {}) {
  const transport = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  const timeout =
    Number.isFinite(timeoutMs) && timeoutMs > 0
      ? Math.min(timeoutMs, 60000)
      : 60000;
  async function request(kind, query, { signal } = {}) {
    const input =
      kind === 'search'
        ? validateSearchInput(query)
        : validateAnalysisInput(query);
    return requestWithDeadline(
      async (active) => {
        const validators = await import('../research/result.js');
        active.throwIfAborted();
        const url =
          kind === 'search'
            ? `/api/research/sentinel-scenes?${new URLSearchParams(Object.entries(input).map(([key, value]) => [key, String(value)]))}`
            : '/api/research/sentinel-ndvi';
        const response = await transport(url, {
          signal: active,
          credentials: 'same-origin',
          redirect: 'error',
          method: kind === 'search' ? 'GET' : 'POST',
          headers: {
            Accept: 'application/json',
            ...(kind === 'analyze'
              ? { 'Content-Type': 'application/json' }
              : {}),
          },
          ...(kind === 'analyze' ? { body: JSON.stringify(input) } : {}),
        });
        if (!response.ok)
          throw Object.assign(new Error('Sentinel research is unavailable'), {
            code: response.status === 429 ? 'RATE_LIMITED' : 'UNAVAILABLE',
          });
        const raw = await readResponseJsonCapped(
          response,
          2 * 1024 * 1024,
          active,
        );
        active.throwIfAborted();
        return kind === 'search'
          ? validators.validateSearchResult(raw, input)
          : validators.validateAnalysisResult(raw, input);
      },
      { signal, timeoutMs: timeout },
    );
  }
  return {
    search: (query, options) => request('search', query, options),
    analyze: (query, options) => request('analyze', query, options),
  };
}
