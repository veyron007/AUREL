/**
 * A one-tile Cesium imagery provider over an image already in memory (an
 * ImageBitmap or a canvas). It implements the same interface as Cesium
 * 1.138's SingleTileImageryProvider, whose constructor only takes a URL:
 * one level-zero tile over `rectangle` in a geographic tiling scheme, and
 * `requestImage` resolving to the image itself. The image must be prepared
 * as Cesium's own tiles are: ImageryProvider.loadImage decodes tiles into
 * ImageBitmaps with imageOrientation 'flipY', because UNPACK_FLIP_Y does not
 * apply to an ImageBitmap upload, while a canvas is flipped on upload. See
 * heatRasterImage in src/data/firmsHeatRaster.js.
 */

/**
 * @param {{cesium: object, image: ImageBitmap|HTMLCanvasElement,
 *   rectangle?: object}} options `cesium` supplies GeographicTilingScheme,
 *   Rectangle and Event.
 * @returns {object} ImageryProvider.
 */
export function createBitmapImageryProvider({ cesium, image, rectangle }) {
  if (!image || !(image.width > 0) || !(image.height > 0))
    throw new Error('Heat imagery needs an image with a size');
  const tilingScheme = new cesium.GeographicTilingScheme({
    rectangle: rectangle ?? cesium.Rectangle.MAX_VALUE,
    numberOfLevelZeroTilesX: 1,
    numberOfLevelZeroTilesY: 1,
  });
  const errorEvent = new cesium.Event();
  return {
    tilingScheme,
    rectangle: tilingScheme.rectangle,
    tileWidth: image.width,
    tileHeight: image.height,
    minimumLevel: 0,
    maximumLevel: 0,
    tileDiscardPolicy: undefined,
    errorEvent,
    credit: undefined,
    proxy: undefined,
    hasAlphaChannel: true,
    /** The image this provider drapes (also for tests and diagnostics). */
    image,
    getTileCredits() {
      return undefined;
    },
    requestImage() {
      return Promise.resolve(image);
    },
    pickFeatures() {
      return undefined;
    },
  };
}
