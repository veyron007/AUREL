import { readResponseJsonCapped } from './httpBody.js';
import { requestWithDeadline } from './requestDeadline.js';
import {
  validateBreathPayload,
  validateSensorPayload,
} from '../airQuality/stations.js';
import { fieldQueryPoint } from './fieldContextModel.js';

const MAX_BYTES = 256 * 1024;

/**
 * Same-origin client for the air-quality routes. It never knows keys or
 * upstream URLs; every response is validated before anyone renders it.
 */
export function createAirQualityStationsSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  timeoutMs = 30_000,
} = {}) {
  async function getJson(path, signal) {
    return requestWithDeadline(
      async (active) => {
        const response = await fetchImpl(path, {
          signal: active,
          credentials: 'same-origin',
          redirect: 'error',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok)
          throw Object.assign(new Error('Air quality is unavailable'), {
            code: response.status === 429 ? 'rate-limited' : 'unavailable',
          });
        return readResponseJsonCapped(response, MAX_BYTES, active);
      },
      { signal, timeoutMs },
    );
  }
  return {
    /** Stations and citizen sensors near a point; `detail` adds station hours. */
    async near(
      point,
      { signal, detail = false, citizen = true, station } = {},
    ) {
      const q = fieldQueryPoint(point);
      const params = new URLSearchParams({
        lat: String(q.lat),
        lon: String(q.lon),
        detail: detail ? '1' : '0',
        citizen: citizen ? '1' : '0',
      });
      if (station) params.set('station', station);
      const payload = validateBreathPayload(
        await getJson(`/api/air-quality/near?${params}`, signal),
      );
      if (payload.requested.lat !== q.lat || payload.requested.lon !== q.lon)
        throw new Error('Air quality location mismatch');
      return payload;
    },
    /** Hourly series of one OpenAQ sensor. */
    async sensor(sensorId, { signal } = {}) {
      if (!Number.isSafeInteger(sensorId) || sensorId <= 0)
        throw new TypeError('Invalid sensor id');
      const payload = validateSensorPayload(
        await getJson(`/api/air-quality/sensor?id=${sensorId}`, signal),
      );
      if (payload.sensorId !== sensorId)
        throw new Error('Air quality sensor mismatch');
      return payload;
    },
  };
}
