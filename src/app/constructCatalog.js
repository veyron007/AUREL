import { resolveCatalogSources } from './sourceComposition.js';
import { createWeatherClock } from '../layers/weather/clock.js';
import { createWeatherLayer } from '../layers/weather/index.js';
import { createCyclonesLayer } from '../layers/cyclones/index.js';
import { createWindLayer } from '../layers/wind/index.js';
import { createLayerCatalog } from './catalog.js';
import { createDeferredLayer } from './deferredLayer.js';
import { DEFERRED_LAYER_DESCRIPTORS } from './layers/deferredDescriptors.js';
import { LAYER_STATE_REGISTRY } from '../data/layerState.js';
import { createMilitaryRegistry } from '../layers/aircraft/classification.js';
import { createApplicationFlights } from './layers/flights.js';
import { createApplicationMilitary } from './layers/militaryFlights.js';
import { createApplicationVessels } from './layers/aisLiveVessels.js';
import { createApplicationDirections } from './layers/directions.js';
import { createApplicationRecentImagery } from './layers/recentImagery.js';
import { createApplicationOsmPlaces } from './layers/osmPlaces.js';
import { createApplicationInstallations } from './layers/militaryInstallations.js';
import { createApplicationSatellites } from './layers/satellites.js';
import { createApplicationLocalAdsb } from './layers/localAdsb.js';
import { createApplicationAwareness } from './layers/militaryAwareness.js';
import { createApplicationAirQuality } from './layers/airQuality.js';
import { createApplicationGnssIntegrity } from './layers/gnss.js';
import { createOsmOverlayLayers } from '../data/osmOverlays.js';
import { createApplicationStreetLevel } from './layers/streetLevel.js';
import { createInfrastructureLayers } from '../data/infrastructure.js';
import { localGeoJsonServices } from './localGeojsonServices.js';
import { createBhoteKoshiLocatorLayer } from '../data/bhoteKoshiLocator.js';

/**
 * Hardware-local layers are registered like any other but never enter share
 * links or stored layer state: another browser cannot have this receiver.
 */
export const LOCAL_ONLY_LAYER_METADATA = Object.freeze([
  Object.freeze({ id: 'local-adsb', disposition: 'local-only' }),
  // Voice search results belong to this session, like a receiver to this machine.
  Object.freeze({ id: 'osm-places', disposition: 'local-only' }),
]);

/** Serialization metadata for every layer the application catalog constructs. */
export const APPLICATION_LAYER_METADATA = Object.freeze([
  ...LAYER_STATE_REGISTRY,
  ...LOCAL_ONLY_LAYER_METADATA,
]);

/**
 * A layer built on first use: its code is a separate chunk, imported when
 * the layer is first enabled (src/app/deferredLayer.js).
 * @param {string} id
 * @param {() => Promise<object>} load Imports and constructs the layer.
 */
const deferred = (id, load) =>
  createDeferredLayer(DEFERRED_LAYER_DESCRIPTORS[id], load);

/** Construct the current catalog without choosing any source provider.
 * Scene engines remain page-owned; layers and classification have this app's lifetime.
 * The manager owns layer destruction, while abort releases classification even if startup fails.
 */
export function createApplicationCatalog({
  surface,
  sources,
  signal,
  metadata = APPLICATION_LAYER_METADATA,
  vesselOptions,
  resolveAsset,
  nepalBoundaryResolver,
  streetLevelProviders,
}) {
  if (!signal?.addEventListener)
    throw new TypeError('An application lifetime signal is required');
  signal.throwIfAborted();
  if (!surface?.groundFloor || !surface?.terrain)
    throw new TypeError('Application surface services are required');

  const sourceComposition = resolveCatalogSources(sources);
  sources = sourceComposition.sources;
  const militaryRegistry = createMilitaryRegistry();
  const weatherClock = createWeatherClock();
  const dispose = () => {
    signal.removeEventListener('abort', dispose);
    militaryRegistry.dispose();
    weatherClock.destroy();
  };
  signal.addEventListener('abort', dispose, { once: true });
  try {
    if (sourceComposition.isConfigured('military'))
      militaryRegistry.configureSource(sources.military, { signal });
    const flights = createApplicationFlights({
      surface,
      source: sources.flights,
      militaryRegistry,
      resolveAsset,
    });
    const military = createApplicationMilitary({
      surface,
      source: sources.military,
      militaryRegistry,
      resolveAsset,
    });
    const vessels = createApplicationVessels({
      source: sources.vessels,
      options: vesselOptions,
    });
    const installations = createApplicationInstallations({
      surface,
      source: sources.installations,
    });
    const satellites = createApplicationSatellites({
      source: sources.satellites,
    });
    const catalog = createLayerCatalog(
      [
        // Scenes grant it media before enabling it; the stand-in keeps that.
        deferred('bhote-koshi-2026', () =>
          import('../data/bhoteKoshiEvent.js').then((module) =>
            module.createBhoteKoshiEventLayer(),
          ),
        ),
        createBhoteKoshiLocatorLayer({
          boundaryResolver: nepalBoundaryResolver,
        }),
        flights,
        military,
        createApplicationLocalAdsb({
          surface,
          enrichment: sources.flights,
          displayParams: () => flights.getParams(),
          ...(resolveAsset ? { resolveAsset } : {}),
        }),
        deferred('earthquakes', () =>
          import('./layers/earthquakes.js').then((module) =>
            module.createApplicationEarthquakes({
              source: sources.earthquakes,
            }),
          ),
        ),
        createApplicationAirQuality({ source: sources['air-quality'] }),
        deferred('fire-perimeters', () =>
          import('./layers/perimeters.js').then((module) =>
            module.createApplicationFirePerimeters({
              source: sources['fire-perimeters'],
            }),
          ),
        ),
        // Eager: its provenance and row text follow the source's window.
        createApplicationGnssIntegrity({
          source: sources['gnss-integrity'],
          windowMs: sources['gnss-integrity'].windowMs,
        }),
        deferred('s2-ghostmaps', () =>
          import('./layers/ghostMaps.js').then((module) =>
            module.createApplicationGhostMaps({
              source: sources['s2-ghostmaps'],
            }),
          ),
        ),
        deferred('drone-airspace', () =>
          import('./layers/droneAirspace.js').then((module) =>
            module.createApplicationDroneAirspace({
              source: sources['drone-airspace'],
            }),
          ),
        ),
        deferred('wildlife-sightings', () =>
          import('./layers/wildlifeSightings.js').then((module) =>
            module.createApplicationWildlifeSightings({
              source: sources['wildlife-sightings'],
              groundFloor: surface.groundFloor,
            }),
          ),
        ),
        deferred('alpr-cameras', () =>
          import('./layers/alprCameras.js').then((module) =>
            module.createApplicationAlpr({ surface, source: sources.alpr }),
          ),
        ),
        createApplicationStreetLevel({
          surface,
          sources: { mapillary: sources.mapillary },
          providers: streetLevelProviders,
        }),
        satellites,
        deferred('rocket-launches', () =>
          import('./layers/rocketLaunches.js').then((module) =>
            module.createApplicationLaunches({
              source: sources.launches,
              satellites,
            }),
          ),
        ),
        deferred('traffic', () =>
          import('./layers/traffic.js').then((module) =>
            module.createApplicationTraffic({
              source: sources.traffic,
              surface,
            }),
          ),
        ),
        deferred('cctv', () =>
          import('./layers/cctv.js').then((module) =>
            module.createApplicationCctv({ surface, source: sources.cctv }),
          ),
        ),
        deferred('radio', () =>
          import('./layers/radio.js').then((module) =>
            module.createApplicationRadio({ surface, source: sources.radio }),
          ),
        ),
        deferred('transit', () =>
          import('./layers/transit.js').then((module) =>
            module.createApplicationTransit({
              surface,
              source: sources.transit,
            }),
          ),
        ),
        deferred('bikeshare', () =>
          import('./layers/bikeshare.js').then((module) =>
            module.createApplicationBikeshare({ source: sources.bikeshare }),
          ),
        ),
        createApplicationDirections({ source: sources.directions }),
        createApplicationRecentImagery({ source: sources['recent-imagery'] }),
        createApplicationOsmPlaces(),
        vessels,
        installations,
        createApplicationAwareness({
          flights,
          military,
          vessels,
          installations,
        }),
        createWindLayer({ feed: sources.wind, clock: weatherClock }),
        createWeatherLayer({
          feed: sources.weather,
          id: 'weather-radar',
          clock: weatherClock,
        }),
        createWeatherLayer({
          feed: sources.weather,
          id: 'weather-satellite',
          clock: weatherClock,
        }),
        createWeatherLayer({
          feed: sources.weather,
          id: 'weather-lightning',
          clock: weatherClock,
        }),
        createCyclonesLayer({ feed: sources.cyclones }),
        ...createOsmOverlayLayers(),
        ...createInfrastructureLayers(localGeoJsonServices),
        deferred('telegeography-submarine-cables', () =>
          import('./layers/submarineCables.js').then((module) =>
            module.createApplicationCables({ source: sources.cables }),
          ),
        ),
        deferred('local-firms', () =>
          import('./layers/firms.js').then((module) =>
            module.createApplicationFirms({
              surface,
              id: 'local-firms',
              name: 'FIRMS Active Fires',
              icon: '▲',
              source: 'NASA FIRMS · LIVE',
              feed: sources.firms,
            }),
          ),
        ),
      ],
      metadata,
    );
    return Object.freeze({
      ...catalog,
      getSourceAvailability: sourceComposition.createAvailabilityLookup(
        catalog.layers,
      ),
      militaryRegistry,
      surface,
      weatherClock,
    });
  } catch (error) {
    dispose();
    throw error;
  }
}
