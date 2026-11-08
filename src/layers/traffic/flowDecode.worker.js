/**
 * Decodes TomTom flow tiles off the main thread. One request per message;
 * the reply carries the request id and either the decoded segments or the
 * decode error's message (a malformed tile stays a rejected tile).
 */
import { decodeFlowTile } from './flowDecode.js';

self.onmessage = (event) => {
  const { id, bytes, z, x, y } = event.data || {};
  try {
    const segments = decodeFlowTile(bytes, z, x, y, { strict: true });
    self.postMessage({ id, ok: true, segments });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      message: error?.message || 'TomTom flow tile decode failed',
    });
  }
};
