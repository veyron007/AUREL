/** Saved checkpoint sheets: the admitted payload only, never hidden fields. */
import { validateMountainWeatherPayload } from '../sources/mountainWeatherModel.js';
import { ELEVATION_SOURCES } from '../planner/checkpointSheetLoader.js';
import { fields, fail, oneOf } from './fields.js';
import { sameProjection } from './analysisSources.js';

export function validateSavedMountainWeather(value, path, checkpoint) {
  fields(value, path, ['elevationSource', 'sheet']);
  oneOf(value.elevationSource, `${path}.elevationSource`, ELEVATION_SOURCES);
  let admitted;
  try {
    admitted = validateMountainWeatherPayload(value.sheet);
  } catch {
    fail(`${path}.sheet`, 'invalid mountain weather sheet');
  }
  if (!sameProjection(value.sheet, admitted))
    fail(`${path}.sheet`, 'unsupported mountain weather fields');
  if (
    admitted.requested.lat !== checkpoint.lat ||
    admitted.requested.lon !== checkpoint.lon
  )
    fail(path, 'sheet belongs to another checkpoint');
  if (
    (value.elevationSource === 'provider-dem') !==
    (admitted.requested.elevationM === null)
  )
    fail(path, 'elevation source does not match the sheet request');
}
