/**
 * Module worker: parse a bundled `.geojsonl` dataset off the main thread and
 * return compact records with their coordinate buffers transferred.
 * Message in: { text }. Message out: { ok: true, records } or
 * { ok: false, name, message }.
 */
import {
  localGeojsonTransferables,
  parseLocalGeojsonDataset,
} from './localGeojsonParse.js';

self.onmessage = (event) => {
  try {
    const records = parseLocalGeojsonDataset(event.data?.text ?? '');
    self.postMessage({ ok: true, records }, localGeojsonTransferables(records));
  } catch (error) {
    self.postMessage({
      ok: false,
      name: error?.name || 'Error',
      message: String(error?.message || error),
    });
  }
};
