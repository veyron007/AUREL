/**
 * Builds the Active Fires heat raster image in a worker
 * (src/data/firmsHeatRaster.worker.js) and falls back to the main thread when
 * a worker cannot be made or fails (node tests, a CSP that refuses it, an old
 * browser). Either way the result is an image Cesium drapes directly; no PNG
 * is encoded. Only the newest request resolves: a build superseded by a later
 * one (a slider drag, a refresh) resolves `null` so its caller drops it.
 */
import {
  buildHeatRaster,
  heatRasterImage,
  packHeatFires,
} from '../../data/firmsHeatRaster.js';

const defaultCanvas = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

function defaultWorker() {
  if (typeof Worker !== 'function') return null;
  return new Worker(
    new URL('../../data/firmsHeatRaster.worker.js', import.meta.url),
    { type: 'module' },
  );
}

/**
 * @param {{createWorker?: function(): ?Worker,
 *   createCanvas?: function(number, number): HTMLCanvasElement,
 *   onFallback?: function(Error): void}} [options]
 */
export function createHeatRasterClient({
  createWorker = defaultWorker,
  createCanvas = defaultCanvas,
  onFallback = () => {},
} = {}) {
  let worker = null;
  let workerFailed = false;
  let latest = 0;
  const pending = new Map();

  function failWorker(error) {
    workerFailed = true;
    worker?.terminate?.();
    worker = null;
    onFallback(error);
    for (const entry of pending.values()) entry.retry();
    pending.clear();
  }

  function ensureWorker() {
    if (worker || workerFailed) return worker;
    try {
      worker = createWorker();
    } catch (error) {
      worker = null;
      failWorker(error);
      return null;
    }
    if (!worker) {
      workerFailed = true;
      return null;
    }
    worker.onmessage = (event) => {
      const { id, ok, error, ...result } = event.data || {};
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (ok) entry.resolve(result);
      else entry.reject(new Error(error || 'Heat raster worker failed'));
    };
    worker.onerror = (event) => {
      event?.preventDefault?.();
      failWorker(new Error(event?.message || 'Heat raster worker failed'));
    };
    return worker;
  }

  async function buildOnMainThread(fires, options) {
    const raster = buildHeatRaster(fires, options);
    const image = await heatRasterImage(raster, { createCanvas });
    return {
      width: raster.width,
      height: raster.height,
      reference: raster.reference,
      image,
    };
  }

  function buildInWorker(fires, options, id) {
    const packed = packHeatFires(fires);
    return new Promise((resolve, reject) => {
      pending.set(id, {
        resolve,
        reject,
        retry: () => buildOnMainThread(fires, options).then(resolve, reject),
      });
      worker.postMessage({ id, ...packed, options: { ...options } }, [
        packed.lat.buffer,
        packed.lon.buffer,
        packed.weight.buffer,
      ]);
    });
  }

  return {
    /** 'worker' or 'main-thread': where the next build runs. */
    get mode() {
      return ensureWorker() ? 'worker' : 'main-thread';
    },

    /**
     * @param {Array<Object>} fires Shown detections.
     * @param {{width:number, height:number, sigmaPx:number}} options
     * @returns {Promise<?{width:number, height:number, reference:number,
     *   image: ImageBitmap|HTMLCanvasElement}>} null when superseded.
     */
    async build(fires, options) {
      const id = ++latest;
      const result = ensureWorker()
        ? await buildInWorker(fires, options, id)
        : await buildOnMainThread(fires, options);
      if (id === latest) return result;
      result?.image?.close?.();
      return null;
    },

    destroy() {
      latest++;
      worker?.terminate?.();
      worker = null;
      for (const entry of pending.values()) entry.resolve(null);
      pending.clear();
    },
  };
}
