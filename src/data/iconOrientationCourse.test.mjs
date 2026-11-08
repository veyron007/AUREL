import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  cameraPoseDiffers,
  cameraPoseSignature,
  courseWorldVector,
  rotationFromWorldCourse,
  screenProjectedRotation,
  updateCameraPose,
} from './iconOrientation.js';
import { seededRandom } from '../testSupport/perfBench.mjs';

/** A camera at `position` looking along heading/pitch/roll, as Cesium builds it. */
function cameraAt(lon, lat, height, heading, pitch, roll = 0) {
  const position = Cesium.Cartesian3.fromDegrees(lon, lat, height);
  const hpr = new Cesium.HeadingPitchRoll(heading, pitch, roll);
  const rotation = Cesium.Matrix3.fromQuaternion(
    Cesium.Transforms.headingPitchRollQuaternion(position, hpr),
  );
  // Columns: x = direction, y = left, z = up in the local frame.
  const direction = Cesium.Matrix3.getColumn(
    rotation,
    0,
    new Cesium.Cartesian3(),
  );
  const left = Cesium.Matrix3.getColumn(rotation, 1, new Cesium.Cartesian3());
  const up = Cesium.Matrix3.getColumn(rotation, 2, new Cesium.Cartesian3());
  return {
    positionWC: position,
    directionWC: direction,
    rightWC: Cesium.Cartesian3.negate(left, new Cesium.Cartesian3()),
    upWC: up,
    heading,
    pitch,
    roll,
  };
}

test('vessel rotation from a cached course vector equals the per-pass projection', () => {
  const random = seededRandom(0x5e55e1);
  let compared = 0;
  for (const lat of [-60, -12, 0, 35, 71]) {
    for (const course of [0, 37, 90, 145, 180, 233, 270, 318]) {
      const lon = -170 + random() * 340;
      const position = Cesium.Cartesian3.fromDegrees(lon, lat, 12);
      const worldCourse = courseWorldVector(
        position,
        course,
        new Cesium.Cartesian3(),
      );
      for (const pitch of [-90, -60, -35, -10]) {
        for (const heading of [0, 75, 180, 290]) {
          const camera = cameraAt(
            lon + (random() - 0.5) * 2,
            lat + (random() - 0.5) * 2,
            50_000 + random() * 2_000_000,
            Cesium.Math.toRadians(heading),
            Cesium.Math.toRadians(pitch),
          );
          const expected = screenProjectedRotation(
            { camera },
            position,
            course,
            null,
          );
          const actual = rotationFromWorldCourse(camera, worldCourse, null);
          assert.equal(
            actual,
            expected,
            JSON.stringify({ lat, course, pitch, heading }),
          );
          compared += 1;
        }
      }
    }
  }
  assert.equal(compared, 5 * 8 * 4 * 4);
});

/**
 * Cesium 1.138's billboard vertex shader (BillboardCollectionVS.glsl,
 * addScreenSpaceOffset) turns an alignedAxis into a screen angle with
 * sign(-x) * acos(sign(y) * y^2 / (x^2 + y^2)): the acos of cos^2, not of cos.
 * This is why vessels keep a CPU-computed rotation instead of a GPU axis.
 */
function cesiumAlignedAxisAngle(x, y) {
  return Math.sign(-x) * Math.acos((Math.sign(y) * (y * y)) / (x * x + y * y));
}

test('a GPU alignedAxis would misdraw diagonal courses by up to ~15 degrees', () => {
  const toDeg = (r) => (r * 180) / Math.PI;
  // A course projected 45 degrees left of screen-up: (x, y) = (-1, 1).
  assert.equal(Math.round(toDeg(cesiumAlignedAxisAngle(-1, 1))), 60);
  let worst = 0;
  for (let deg = 0; deg <= 90; deg += 1) {
    const r = (deg * Math.PI) / 180;
    const drawn = toDeg(cesiumAlignedAxisAngle(-Math.sin(r), Math.cos(r)));
    worst = Math.max(worst, Math.abs(drawn - deg));
  }
  assert.ok(worst > 14 && worst < 17, `worst ${worst}`);
});

test('the numeric pose check agrees with the string signature', () => {
  const pose = new Float64Array(6).fill(Number.NaN);
  const camera = cameraAt(10, 50, 400_000, 0.3, -0.7);
  assert.equal(updateCameraPose(camera, pose), true);
  assert.equal(cameraPoseDiffers(camera, pose), false);
  assert.equal(updateCameraPose(camera, pose), false);
  const before = cameraPoseSignature(camera);
  const moved = cameraAt(10.01, 50, 400_000, 0.3, -0.7);
  assert.notEqual(cameraPoseSignature(moved), before);
  assert.equal(cameraPoseDiffers(moved, pose), true);
  const turned = cameraAt(10, 50, 400_000, 0.31, -0.7);
  assert.equal(cameraPoseDiffers(turned, pose), true);
});
