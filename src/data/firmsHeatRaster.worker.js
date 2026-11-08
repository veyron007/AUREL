/**
 * Active Fires heat raster off the main thread: bins, blurs and colours the
 * packed detections (firmsHeatRaster.js) and hands back an ImageBitmap, so
 * the raster is never encoded to PNG and decoded again. The bitmap keeps
 * straight (not premultiplied) alpha, as Cesium's own imagery decode does.
 */
import {
  buildHeatRasterFromPacked,
  heatRasterImage,
} from './firmsHeatRaster.js';

self.onmessage = async (event) => {
  const { id, lat, lon, weight, options } = event.data || {};
  try {
    const raster = buildHeatRasterFromPacked({ lat, lon, weight }, options);
    const image = await heatRasterImage(raster);
    self.postMessage(
      {
        id,
        ok: true,
        width: raster.width,
        height: raster.height,
        reference: raster.reference,
        image,
      },
      [image],
    );
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error?.message || error) });
  }
};
