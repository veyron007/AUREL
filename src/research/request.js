export const SCENE_ID = /^S2[ABC]_\d{2}[A-Z]{3}_\d{8}_\d+_L2A$/;
function point(input, keys) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !keys.includes(key)) ||
    !Number.isFinite(input.lat) ||
    !Number.isFinite(input.lon) ||
    input.lat < -80 ||
    input.lat > 84 ||
    input.lon < -180 ||
    input.lon > 180
  )
    throw new Error('invalid-request');
}
export function validateAnalysisInput(input) {
  point(input, ['sceneId', 'lat', 'lon', 'sizePixels']);
  if (
    typeof input.sceneId !== 'string' ||
    !SCENE_ID.test(input.sceneId) ||
    ![128, 256].includes(input.sizePixels)
  )
    throw new Error('invalid-request');
  return {
    sceneId: input.sceneId,
    lat: input.lat,
    lon: input.lon,
    sizePixels: input.sizePixels,
  };
}
function day(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\d$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new Error('invalid-request');
  return Date.parse(value);
}
export function validateSearchInput(input) {
  point(input, ['lat', 'lon', 'fromDay', 'toDay']);
  const from = day(input.fromDay),
    to = day(input.toDay);
  if (to < from || to - from > 30 * 86400000 || from < Date.parse('2015-06-23'))
    throw new Error('invalid-request');
  return {
    lat: input.lat,
    lon: input.lon,
    fromDay: input.fromDay,
    toDay: input.toDay,
  };
}
