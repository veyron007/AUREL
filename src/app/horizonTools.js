import { watch } from 'vue';
import {
  Cartesian3,
  Color,
  CustomDataSource,
  HeightReference,
  LabelStyle,
  VerticalOrigin,
  Cartesian2,
} from 'cesium';
import { t } from '../i18n/index.js';
import { HorizonController } from '../ui/horizonController.js';
import { useHorizonStore } from '../ui/stores/horizon.js';
import { useLensStore } from '../ui/stores/lens.js';
import { createHorizonService } from '../horizon/service.js';
import { createHorizonWorkerRunner } from '../horizon/workerRunner.js';
import { destination } from '../horizon/geodesy.js';
import { roundAzimuth, roundKm } from '../horizon/envelope.js';

/** Lamplight brass: the only interactive colour, used for the horizon ring. */
const RING_COLOUR = '#d6ab55';
const MAX_RING_LABELS = 6;

/** The skyline trace: one ground-clamped vertex per ray at its blocking terrain. */
export function horizonRingPositions(result) {
  const { lat, lon } = result.observer;
  const points = [];
  result.horizon.distanceM.forEach((distance, index) => {
    if (distance === null) return;
    const point = destination(
      lat,
      lon,
      result.horizon.azimuthsDeg[index],
      distance,
    );
    points.push([point.lon, point.lat]);
  });
  if (points.length > 2) points.push(points[0]);
  return points;
}

/** Explicit horizon adapters; construction never starts a provider request. */
export function createHorizonBindings({
  pinia,
  viewer,
  fieldbook,
  fetchImpl = (url, init) => fetch(url, init),
  run = createHorizonWorkerRunner(),
}) {
  const lens = useLensStore(pinia);
  const service = createHorizonService({ fetchImpl, run });
  let source = null;
  const clearHorizon = () => {
    if (source && viewer?.dataSources) viewer.dataSources.remove(source, true);
    source = null;
    viewer?.scene?.requestRender?.();
  };
  return {
    readSelection: () => lens.view?.selection || null,
    subscribeChanges(listener) {
      return watch(() => lens.view?.selection, listener, { flush: 'sync' });
    },
    horizonAt: (input, options) => service.horizonAt(input, options),
    drawHorizon(result) {
      clearHorizon();
      if (!viewer?.dataSources) return;
      source = new CustomDataSource('kshitij-horizon');
      const colour = Color.fromCssColorString(RING_COLOUR);
      const ring = horizonRingPositions(result);
      if (ring.length > 3)
        source.entities.add({
          id: 'kshitij-horizon-ring',
          polyline: {
            positions: Cartesian3.fromDegreesArray(ring.flat()),
            clampToGround: true,
            width: 3,
            material: colour,
          },
        });
      source.entities.add({
        id: 'kshitij-horizon-observer',
        position: Cartesian3.fromDegrees(
          result.observer.lon,
          result.observer.lat,
        ),
        point: {
          pixelSize: 10,
          color: colour,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      result.peaks.listed
        .filter((peak) => peak.state === 'skyline')
        .slice(0, MAX_RING_LABELS)
        .forEach((peak) => {
          source.entities.add({
            id: `kshitij-horizon-${peak.id}`,
            position: Cartesian3.fromDegrees(peak.lon, peak.lat),
            point: {
              pixelSize: 6,
              color: colour,
              heightReference: HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: {
              text: t('{name} · {distance} km · az {azimuth}° · terrain-only', {
                name: peak.name,
                distance: roundKm(peak.distanceM),
                azimuth: roundAzimuth(peak.azimuthDeg),
              }),
              font: '12px sans-serif',
              fillColor: Color.WHITE,
              outlineColor: Color.BLACK,
              outlineWidth: 3,
              style: LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: VerticalOrigin.BOTTOM,
              pixelOffset: new Cartesian2(0, -10),
              heightReference: HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
        });
      viewer.dataSources.add(source);
      viewer.scene?.requestRender?.();
    },
    clearHorizon,
    saveSnapshot: (subject, snapshot) =>
      fieldbook.saveAnalysis(subject, snapshot, 'horizon'),
  };
}

export function createHorizonTools(options) {
  const bindings = createHorizonBindings(options);
  const controller = new HorizonController({
    ...bindings,
    store: useHorizonStore(options.pinia),
  });
  controller.init();
  return {
    controller,
    destroy() {
      controller.destroy();
    },
  };
}
