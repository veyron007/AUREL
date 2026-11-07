import { readResponseJsonCapped } from './httpBody.js';
import { requestWithDeadline } from './requestDeadline.js';
import {
  fieldQueryPoint,
  validateFieldContextPayload,
} from './fieldContextModel.js';
/** Same-origin, fixed-capability client. It never knows keys or upstream URLs. */
export function createFieldContextSource({
  fetchImpl,
  fetch: fetchOverride,
  timeoutMs = 20000,
} = {}) {
  const transport =
    fetchImpl ?? fetchOverride ?? ((...args) => globalThis.fetch(...args));
  return {
    async getContext(point, { signal, airQuality = true } = {}) {
      fieldQueryPoint(point);
      const params = new URLSearchParams({
        lat: String(point.lat),
        lon: String(point.lon),
        aq: airQuality ? '1' : '0',
      });
      return requestWithDeadline(
        async (active) => {
          const response = await transport(`/api/field-context?${params}`, {
            signal: active,
            credentials: 'same-origin',
            redirect: 'error',
            headers: { Accept: 'application/json' },
          });
          if (!response.ok)
            throw Object.assign(new Error('Field context is unavailable'), {
              code: response.status === 429 ? 'RATE_LIMITED' : 'UNAVAILABLE',
            });
          const result = validateFieldContextPayload(
            await readResponseJsonCapped(response, 128 * 1024, active),
          );
          if (
            result.requested.lat !== point.lat ||
            result.requested.lon !== point.lon
          )
            throw new Error('Field context location mismatch');
          return result;
        },
        { signal, timeoutMs },
      );
    },
  };
}
