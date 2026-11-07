import { admittedCogUrl } from './rangeSource.js';
export const EARTH_SEARCH = 'https://earth-search.aws.element84.com/v1';
export const SENTINEL_COLLECTION = 'sentinel-2-l2a';
import { SCENE_ID } from '../../../src/research/request.js';
export {
  SCENE_ID,
  validateAnalysisInput,
  validateSearchInput,
} from '../../../src/research/request.js';
const fail = () => {
  throw new Error('unsupported-science-metadata');
};
function asset(value, band, resolution, id, epsg) {
  const raster = value?.['raster:bands']?.[0];
  const transform = value?.['proj:transform'],
    shape = value?.['proj:shape'];
  if (
    !value ||
    !value.type?.includes('image/tiff') ||
    value.gsd !== resolution ||
    !Array.isArray(shape) ||
    shape.length !== 2 ||
    !shape.every((n) => n === 109800 / resolution) ||
    !Array.isArray(transform) ||
    transform.length !== 6 ||
    !transform.every(Number.isFinite) ||
    transform[0] !== resolution ||
    transform[1] !== 0 ||
    transform[3] !== 0 ||
    transform[4] !== -resolution ||
    !raster ||
    value['raster:bands'].length !== 1 ||
    raster.nodata !== 0 ||
    raster.spatial_resolution !== resolution ||
    raster.data_type !== (resolution === 10 ? 'uint16' : 'uint8')
  )
    fail();
  const url = admittedCogUrl(value.href);
  if (!url.endsWith(`/${id}/${band}.tif`)) fail();
  if (
    resolution === 10 &&
    (value['eo:bands']?.[0]?.name !== band ||
      raster.scale !== 0.0001 ||
      ![0, -0.1].includes(raster.offset))
  )
    fail();
  return {
    url,
    band,
    epsg,
    width: shape[1],
    height: shape[0],
    transform: [...transform],
    noData: 0,
    ...(resolution === 10
      ? { scale: raster.scale, offset: raster.offset }
      : {}),
  };
}
export function admitSentinelItem(item, expectedId) {
  const p = item?.properties;
  const epsg = p?.['proj:epsg'];
  if (
    !item ||
    item.id !== expectedId ||
    !SCENE_ID.test(expectedId) ||
    item.collection !== SENTINEL_COLLECTION ||
    !Number.isInteger(epsg) ||
    !((epsg >= 32601 && epsg <= 32660) || (epsg >= 32701 && epsg <= 32760)) ||
    typeof p.datetime !== 'string' ||
    !p.datetime.endsWith('Z') ||
    !Number.isFinite(Date.parse(p.datetime)) ||
    typeof p['s2:processing_baseline'] !== 'string' ||
    !/^\d{2}\.\d{2}$/.test(p['s2:processing_baseline'])
  )
    fail();
  const red = asset(item.assets?.red, 'B04', 10, expectedId, epsg);
  const nir = asset(item.assets?.nir, 'B08', 10, expectedId, epsg);
  const scl = asset(item.assets?.scl, 'SCL', 20, expectedId, epsg);
  if (
    red.transform.some((n, i) => n !== nir.transform[i]) ||
    red.transform[2] !== scl.transform[2] ||
    red.transform[5] !== scl.transform[5] ||
    red.offset !== nir.offset
  )
    fail();
  return {
    id: expectedId,
    epsg,
    acquiredAt: new Date(p.datetime).toISOString(),
    processingBaseline: p['s2:processing_baseline'],
    cloudCoverPct:
      Number.isFinite(p['eo:cloud_cover']) &&
      p['eo:cloud_cover'] >= 0 &&
      p['eo:cloud_cover'] <= 100
        ? p['eo:cloud_cover']
        : null,
    red,
    nir,
    scl,
  };
}
