import { MAP_STACKS } from './catalog.js';
import { photorealUnavailableReason } from './availability.js';
import { keySetupRequirementEnvVars } from '../keySetupCore.mjs';
import { t } from '../i18n/index.js';
import {
  createOsmImagery,
  createEsriImagery,
  createIonImagery,
  ESRI_ATTRIBUTION_HTML,
  OVERVIEW_ATTRIBUTION_HTML,
  createOfflineOverviewImagery,
  createOfflineOverviewTerrain,
} from './imagery.js';
import { createWorldTerrain, createKeylessTerrain } from './terrain.js';

/**
 * Select sources and setup guidance without putting provider branches in the
 * controller. `cameraPoint` returns where the camera is ({lat, lon} or null),
 * read when a reason is shown so Google 3D advice can follow coverage.
 */
export function createDefaultMapSources({
  googleTileset = null,
  cesiumToken = '',
  googleApiKey = '',
  freeOnly = false,
  cameraPoint = () => null,
} = {}) {
  const ionToken = freeOnly ? '' : String(cesiumToken || '').trim();
  const hasIon = Boolean(ionToken);
  const hasGoogle = Boolean(String(googleApiKey || '').trim());
  const allowedTileset = freeOnly ? null : googleTileset;
  const policyReason = () => t('Paused by Free-only; saved keys are preserved');
  const terrain = {
    id: hasIon ? 'world' : 'keyless',
    create: hasIon
      ? (request) => createWorldTerrain(ionToken, request)
      : createKeylessTerrain,
  };
  return {
    defaultId: allowedTileset ? 'photoreal' : 'esri-imagery',
    unknownId: 'photoreal',
    recoveryId: allowedTileset ? 'photoreal' : null,
    state: { hasCesiumIonToken: hasIon, freeOnly },
    sources: MAP_STACKS.map((descriptor) => {
      const common = {
        descriptor,
        available: !descriptor.requiresIon || hasIon,
        // Read when shown, so it follows the locale.
        unavailableReason:
          descriptor.requiresIon && freeOnly
            ? policyReason
            : descriptor.requiresIon
              ? () =>
                  t('Needs {envVars} — add it in Provider Settings', {
                    envVars: keySetupRequirementEnvVars('cesium-ion'),
                  })
              : null,
      };
      if (descriptor.kind === 'photoreal')
        return {
          ...common,
          available: Boolean(allowedTileset),
          unavailableReason: freeOnly
            ? policyReason
            : () =>
                photorealUnavailableReason(hasIon || hasGoogle, {
                  at: cameraPoint(),
                }),
          tileset: allowedTileset,
        };
      if (descriptor.kind === 'offline-overview')
        return {
          ...common,
          imagery: createOfflineOverviewImagery,
          terrain: {
            id: 'offline-ellipsoid',
            create: createOfflineOverviewTerrain,
          },
          credit: OVERVIEW_ATTRIBUTION_HTML,
        };
      const imagery =
        descriptor.kind === 'ion'
          ? () => createIonImagery(descriptor.style, ionToken)
          : descriptor.id === 'osm'
            ? createOsmImagery
            : createEsriImagery;
      return {
        ...common,
        imagery,
        terrain,
        ...(descriptor.id === 'osm'
          ? {
              constructionFallback: {
                id: 'offline-overview',
                message:
                  'Online maps unavailable; using the offline Natural Earth overview',
              },
              tileFailureFallback: {
                id: 'offline-overview',
                threshold: 2,
                message:
                  'Online map tiles unavailable; using the offline Natural Earth overview',
              },
            }
          : {}),
        ...(descriptor.id === 'esri-imagery'
          ? {
              credit: ESRI_ATTRIBUTION_HTML,
              constructionFallback: {
                id: 'osm',
                message: 'Esri Satellite is unavailable; using OSM',
              },
              tileFailureFallback: {
                id: 'osm',
                threshold: 2,
                message: 'Esri Satellite tile requests failed; using OSM',
              },
            }
          : {}),
      };
    }),
  };
}
