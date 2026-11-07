import { readResponseJsonCapped } from './httpBody.js';
import { requestWithDeadline } from './requestDeadline.js';
import {
  mountainQueryPoint,
  validateMountainWeatherPayload,
} from './mountainWeatherModel.js';

/** Same-origin, fixed-capability client. It never knows upstream hosts or models. */
export function createMountainWeatherSource({
  fetchImpl,
  timeoutMs = 45000,
} = {}) {
  const transport = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  return {
    async getSheet(point, { from = null, signal } = {}) {
      const queried = mountainQueryPoint(point);
      const params = new URLSearchParams({
        lat: String(point.lat),
        lon: String(point.lon),
      });
      if (Number.isFinite(point.elevationM))
        params.set('elev', String(Math.round(point.elevationM)));
      if (from) params.set('from', from);
      return requestWithDeadline(
        async (active) => {
          const response = await transport(`/api/mountain-weather?${params}`, {
            signal: active,
            credentials: 'same-origin',
            redirect: 'error',
            headers: { Accept: 'application/json' },
          });
          if (!response.ok)
            throw Object.assign(new Error('Mountain weather is unavailable'), {
              code: response.status === 429 ? 'RATE_LIMITED' : 'UNAVAILABLE',
            });
          const result = validateMountainWeatherPayload(
            await readResponseJsonCapped(response, 256 * 1024, active),
          );
          if (
            result.queried.lat !== queried.lat ||
            result.queried.lon !== queried.lon
          )
            throw new Error('Mountain weather location mismatch');
          return result;
        },
        { signal, timeoutMs },
      );
    },
  };
}
