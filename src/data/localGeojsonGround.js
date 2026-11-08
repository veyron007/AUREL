import * as Cesium from 'cesium';

/**
 * Ground grounding and stem sizing for local infrastructure records: the
 * bounded scene-height sample, the loaded-terrain floor and the stem tip that
 * keeps a constant screen height.
 */

// Stems are anchored at ellipsoid height 0, but high-elevation features
// (e.g. dams in river canyons) sit hundreds of meters above the ellipsoid,
// burying the short close-in stem inside the photoreal mesh. Once the
// camera is near enough for tiles to be loaded, sample the real surface
// height once per feature and lift the stem onto it.
export const GROUND_SAMPLE_MAX_DISTANCE_M = 75000;
export const GROUND_SAMPLE_RETRY_MS = 2000;
const GROUND_SAMPLE_MAX_ABS_HEIGHT_M = 9000;
/**
 * Bounded give-up for the self-armed retry. Sampling can be SUPPORTED and still
 * never succeed (no sampleable surface under the feature), in which case each
 * requested frame would arm the next 2 s timer forever — an idle-governor leak
 * dressed up as a retry. After this many consecutive armed retries with no
 * record newly grounded, stop arming; camera motion (a frame we get for free)
 * still retries through the normal preRender walk and re-opens the budget.
 * 30 × 2 s ≈ 60 s, far longer than a tile stream-in.
 */
export const GROUND_SAMPLE_MAX_ARMED_RETRIES = 30;
/** Ignore sub-metre camera-derived stem-tip noise at camera settle. */
export const LOCAL_STEM_TIP_EPSILON_M = 0.5;
const LOCAL_STEM_TIP_EPSILON_SQ = LOCAL_STEM_TIP_EPSILON_M ** 2;

export function refreshLocalTerrainFloor(viewer, record) {
  const globe = viewer.scene.globe;
  if (!record.groundSampled || !globe?.show || globe.tilesLoaded === false)
    return false;
  if (
    Cesium.Cartesian3.distance(viewer.camera.positionWC, record.base) >=
    GROUND_SAMPLE_MAX_DISTANCE_M
  )
    return false;
  // Camera motion can refine terrain after the first successful depth sample.
  // Reuse the loaded mesh on existing bounded walks; never arm a timer or do
  // another GPU readback just to maintain this floor. Keep roof elevations.
  const height = globe.getHeight?.(record.carto);
  if (
    !Number.isFinite(height) ||
    Math.abs(height) > GROUND_SAMPLE_MAX_ABS_HEIGHT_M ||
    height <= record.groundHeight
  )
    return false;
  setLocalGroundHeight(record, height);
  return true;
}

const groundSampleOccluder = new Cesium.EllipsoidalOccluder(
  Cesium.Ellipsoid.WGS84,
);

const groundSampleCarto = new Cesium.Cartographic();
const groundSampleLow = new Cesium.Cartesian3();
const groundSampleHigh = new Cesium.Cartesian3();

/** The record's vertical at `height` metres above the ellipsoid. */
function groundSamplePoint(record, height, result) {
  groundSampleCarto.longitude = record.carto.longitude;
  groundSampleCarto.latitude = record.carto.latitude;
  groundSampleCarto.height = height;
  return Cesium.Cartographic.toCartesian(
    groundSampleCarto,
    Cesium.Ellipsoid.WGS84,
    result,
  );
}

/**
 * Whether the camera can see the ground under the record: inside the view
 * frustum and above the horizon. scene.sampleHeight reads only surface
 * rendered for the current view, so a sample of unseen ground passes through
 * the Earth (about -6,344 km near Ashburn on Esri) and fails on every 2 s
 * retry, each one a full offscreen render; 110 unseen data centres there held
 * rest frames at 58-589 ms. Unsampled bases sit on the ellipsoid, so the test
 * uses loaded globe terrain when there is some. Otherwise (a hidden globe) it
 * tests the vertical across +/-GROUND_SAMPLE_MAX_ABS_HEIGHT_M, every height a
 * sample can accept, so high or below-ellipsoid ground in view is never
 * mistaken for an unseen base. Unseen ground is sampled on the first walk that
 * sees it.
 */
export function groundSampleInView(viewer, record) {
  const camera = viewer.camera;
  const globe = viewer.scene.globe;
  const terrain = globe?.show ? globe.getHeight?.(record.carto) : undefined;
  const known =
    Number.isFinite(terrain) &&
    Math.abs(terrain) <= GROUND_SAMPLE_MAX_ABS_HEIGHT_M;
  const low = groundSamplePoint(
    record,
    known ? terrain : -GROUND_SAMPLE_MAX_ABS_HEIGHT_M,
    groundSampleLow,
  );
  const high = known
    ? low
    : groundSamplePoint(
        record,
        GROUND_SAMPLE_MAX_ABS_HEIGHT_M,
        groundSampleHigh,
      );
  // The vertical is unseen only when both ends are outside the same plane.
  const { planes } = camera.frustum.computeCullingVolume(
    camera.positionWC,
    camera.directionWC,
    camera.upWC,
  );
  for (const plane of planes) {
    if (
      Cesium.Cartesian3.dot(plane, low) + plane.w < 0 &&
      Cesium.Cartesian3.dot(plane, high) + plane.w < 0
    )
      return false;
  }
  // The ellipsoidal occluder hides every point below the ellipsoid from a
  // camera near it, so ground below 0 m (low-geoid coasts, the Dead Sea) is
  // tested at 0 m; unknown ground at the top of the vertical.
  const horizonHeight = known
    ? Math.max(terrain, 0)
    : GROUND_SAMPLE_MAX_ABS_HEIGHT_M;
  groundSampleOccluder.cameraPosition = camera.positionWC;
  return groundSampleOccluder.isPointVisible(
    groundSamplePoint(record, horizonHeight, groundSampleHigh),
  );
}

export function sampleLocalGroundHeight(viewer, record, now) {
  if (record.groundSampled || !viewer.scene.sampleHeightSupported) return false;
  if (now - record.lastGroundSampleMs < GROUND_SAMPLE_RETRY_MS) return false;
  if (!groundSampleInView(viewer, record)) return false;
  record.lastGroundSampleMs = now;
  const globe = viewer.scene.globe;
  if (globe?.show && globe.tilesLoaded === false) return false;
  let sampled;
  try {
    sampled = viewer.scene.sampleHeight(record.carto, [record.carrier]);
  } catch {
    return false; // tiles not ready; retry on a later bounded update
  }
  if (
    !Number.isFinite(sampled) ||
    Math.abs(sampled) > GROUND_SAMPLE_MAX_ABS_HEIGHT_M
  )
    return false;
  // A coarse scene-depth sample can lie below the terrain already loaded by
  // the visible globe. Keep that terrain as a floor while allowing roofs and
  // valid below-sea-level elevations. Photoreal scenes hide the globe, so its
  // inactive terrain must not constrain their geometry.
  const terrainHeight = globe?.show
    ? globe.getHeight?.(record.carto)
    : undefined;
  if (
    Number.isFinite(terrainHeight) &&
    Math.abs(terrainHeight) <= GROUND_SAMPLE_MAX_ABS_HEIGHT_M
  ) {
    sampled = Math.max(sampled, terrainHeight);
  }
  record.groundSampled = true;
  setLocalGroundHeight(record, sampled);
  return true;
}

function setLocalGroundHeight(record, height) {
  record.groundHeight = height;
  Cesium.Cartesian3.fromRadians(
    record.carto.longitude,
    record.carto.latitude,
    record.groundHeight,
    Cesium.Ellipsoid.WGS84,
    record.base,
  );
  record.carrier.__localBaseCartesian = record.base;
}

/**
 * Size a record's stem for the current camera and write it through
 * `writeStem` when the tip moved by more than LOCAL_STEM_TIP_EPSILON_M.
 * @param {Cesium.Viewer} viewer
 * @param {object} record Stem record (base/tip/nextTip are updated in place).
 * @param {number} now performance.now() of the walk.
 * @param {number|null} knownDistance Camera distance when already measured.
 * @param {function(object):void} writeStem Pushes base/tip to the primitives.
 * @returns {boolean} Whether the stem moved.
 */
export function updateLocalStemGeometry(
  viewer,
  record,
  now,
  knownDistance,
  writeStem,
) {
  const distance = Number.isFinite(knownDistance)
    ? knownDistance
    : Cesium.Cartesian3.distance(viewer.camera.positionWC, record.base);
  if (distance < GROUND_SAMPLE_MAX_DISTANCE_M)
    sampleLocalGroundHeight(viewer, record, now);
  // Keep the intended screen-size scaling in close-up views too. A 5 km
  // minimum made a marker hundreds of metres tall beside a nearby building.
  const effectiveDistance = Math.max(distance, 1);
  const canvasHeight = viewer.scene.canvas.clientHeight || 1080;
  const fov = viewer.camera.frustum.fov || Math.PI / 3;
  const targetPx = 65;
  const fovFactor = 2 * Math.tan(fov / 2) * (targetPx / canvasHeight);
  const tipHeight = record.groundHeight + effectiveDistance * fovFactor;
  Cesium.Cartesian3.fromRadians(
    record.carto.longitude,
    record.carto.latitude,
    tipHeight,
    Cesium.Ellipsoid.WGS84,
    record.nextTip,
  );
  if (
    Cesium.Cartesian3.distanceSquared(record.tip, record.nextTip) <=
    LOCAL_STEM_TIP_EPSILON_SQ
  ) {
    return false;
  }
  Cesium.Cartesian3.clone(record.nextTip, record.tip);
  writeStem(record);
  return true;
}
