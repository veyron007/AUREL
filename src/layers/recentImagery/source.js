import { searchHls } from './catalog.js';
import { gibsTemplate, wvsSnapshotUrl } from './model.js';
import { HISTORY_LIMITS, validateHistoryWindow } from './historical.js';
import {
  readResponseJsonCapped,
  readResponseBytesCapped,
} from '../../sources/httpBody.js';
import { requestWithDeadline } from '../../sources/requestDeadline.js';

/**
 * NASA-compatible imagery acquisition; transport and URL builders are replaceable.
 * Thumbnail responses must expose Data-Present: true for image admission, or
 * false for confirmed empty coverage, including injected getThumbnail sources.
 */
export function createRecentImagerySource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  search = searchHls,
  thumbnailUrl = wvsSnapshotUrl,
  tileTemplate = gibsTemplate,
  credit = 'NASA GIBS',
} = {}) {
  return {
    credit,
    searchHls: (query) => search({ ...query, fetchImpl }),
    searchWindow(query, { signal } = {}) {
      const checked = validateHistoryWindow(query);
      const params = new URLSearchParams({
        from: checked.fromDay,
        to: checked.toDay,
        products: checked.products.join(','),
      });
      params.set(
        'bbox',
        [
          checked.box.west,
          checked.box.south,
          checked.box.east,
          checked.box.north,
        ].join(','),
      );
      return requestWithDeadline(
        async (inner) => {
          const response = await fetchImpl(
            `/api/imagery-history/catalog?${params}`,
            { signal: inner, redirect: 'error' },
          );
          if (!response.ok)
            throw new Error('Historical imagery catalog unavailable');
          const result = await readResponseJsonCapped(
            response,
            HISTORY_LIMITS.catalogBytes,
            inner,
          );
          if (
            !Array.isArray(result?.candidates) ||
            result.candidates.length > 93 ||
            !Array.isArray(result.errors)
          )
            throw new TypeError('Invalid historical imagery catalog');
          return result;
        },
        { signal, timeoutMs: 20000 },
      );
    },
    async getThumbnail(candidate, box, { size = 256, signal } = {}) {
      signal?.throwIfAborted();
      if (candidate.historical) {
        validateHistoryWindow({
          box,
          fromDay: candidate.day,
          toDay: candidate.day,
          products: [candidate.product],
        });
        const params = new URLSearchParams({
          bbox: [box.west, box.south, box.east, box.north].join(','),
          product: candidate.product,
          day: candidate.day,
        });
        return requestWithDeadline(
          async (inner) => {
            const response = await fetchImpl(
              `/api/imagery-history/preview?${params}`,
              { signal: inner, redirect: 'error' },
            );
            if (!response.ok) return response;
            const bytes = await readResponseBytesCapped(
              response,
              HISTORY_LIMITS.previewBytes,
              inner,
            );
            return new Response(bytes, {
              status: response.status,
              headers: response.headers,
            });
          },
          { signal, timeoutMs: 15000 },
        );
      }
      const response = await fetchImpl(
        thumbnailUrl({
          product: candidate.product,
          day: candidate.day,
          box,
          width: size,
          height: size,
        }),
        { signal },
      );
      signal?.throwIfAborted();
      return response;
    },
    getTileTemplate: (product, day) => tileTemplate(product, day),
  };
}
