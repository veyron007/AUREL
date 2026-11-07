// The CCTV summary line names the CAL badge, the source kind and the view
// band in the page language; unknown codes stay as uppercase codes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { setLocale } from '../../i18n/index.js';
import {
  summaryCalLabel,
  summarySourceLabel,
  summaryViewBandLabel,
} from './presentation.js';

function inLocale(locale, run) {
  setLocale(locale);
  try {
    return run();
  } finally {
    setLocale('en');
  }
}

test('English keeps the summary codes', () => {
  assert.equal(summaryCalLabel('raw-prior'), 'RAW PRIOR');
  assert.equal(summarySourceLabel('image'), 'IMAGE');
  assert.equal(summarySourceLabel('hls'), 'HLS');
  assert.equal(summaryViewBandLabel('street'), 'STREET');
  assert.equal(summaryViewBandLabel('none'), 'NONE');
});

test('Portuguese summary values are translated', () => {
  inLocale('pt', () => {
    assert.equal(summaryCalLabel('raw-prior'), 'ESTIMATIVA BRUTA');
    assert.equal(summaryCalLabel('calibrated'), 'CALIBRADA');
    assert.equal(summarySourceLabel('IMAGE'), 'IMAGEM');
    assert.equal(summarySourceLabel('mjpeg'), 'MJPEG');
    assert.equal(summaryViewBandLabel('street'), 'RUA');
    assert.equal(summaryViewBandLabel('city'), 'CIDADE');
  });
});

test('selected-camera distance follows viewer position without changing the camera', async () => {
  const { cameraDistanceFromViewerKm } = await import('./presentation.js');
  const camera = { lat: 30.2672, lon: -97.7431 };
  const position = (lat, lon) => ({
    latitude: (lat * Math.PI) / 180,
    longitude: (lon * Math.PI) / 180,
  });
  assert.ok(
    cameraDistanceFromViewerKm(camera, position(30.2672, -97.7431)) < 0.001,
  );
  assert.ok(
    cameraDistanceFromViewerKm(camera, position(30.3258, 78.0438)) > 12000,
  );
  assert.equal(cameraDistanceFromViewerKm(camera, null), null);
  assert.equal(
    cameraDistanceFromViewerKm({ lat: null, lon: null }, position(0, 0)),
    null,
  );
  assert.deepEqual(camera, { lat: 30.2672, lon: -97.7431 });
});
