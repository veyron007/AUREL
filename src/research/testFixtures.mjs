import proj4 from 'proj4';
import { calculateNdvi } from './ndvi.js';
export function resultFixture() {
  const width = 128,
    height = 128,
    transform = [10, 0, 700000, 0, -10, 3400000],
    epsg = 32643;
  const projection = '+proj=utm +zone=43 +datum=WGS84 +units=m +no_defs';
  const [lon, lat] = proj4(projection, 'EPSG:4326', [700640, 3399360]);
  const grid = {
    width,
    height,
    transform,
    epsg,
    scale: 0.0001,
    offset: -0.1,
    noData: 0,
  };
  const scene = {
    id: 'S2B_43RGP_20261025_0_L2A',
    acquiredAt: '2026-10-25T05:40:34.715Z',
    retrievedAt: '2026-11-07T12:00:00.000Z',
    processingBaseline: '05.13',
  };
  const result = calculateNdvi({
    red: { ...grid, band: 'B04', data: Array(16384).fill(2000) },
    nir: { ...grid, band: 'B08', data: Array(16384).fill(4000) },
    scl: {
      width: 64,
      height: 64,
      epsg,
      transform: [20, 0, 700000, 0, -20, 3400000],
      noData: 0,
      data: Array(4096).fill(4),
    },
    scene,
  });
  return {
    ...result,
    requested: { lat, lon, sizePixels: 128 },
    footprint: {
      type: 'Polygon',
      coordinates: [
        [
          [700000, 3400000],
          [701280, 3400000],
          [701280, 3398720],
          [700000, 3398720],
          [700000, 3400000],
        ].map((point) => proj4(projection, 'EPSG:4326', point)),
      ],
    },
    transfer: {
      bytes: 100000,
      requests: 3,
      maxBytes: 25165824,
      maxRequests: 64,
    },
  };
}
