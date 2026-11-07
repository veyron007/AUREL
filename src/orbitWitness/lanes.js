/**
 * The four Orbit Witness lanes. A lane is never merged with another: a pass
 * is a model, a plan is the operator's intent, a product is a catalogue
 * record, and a ride is a dramatisation.
 */
import { msg } from '../i18n/marker.js';

export const LANES = Object.freeze({
  predicted: Object.freeze({
    id: 'predicted',
    label: msg('Predicted pass'),
    class: 'modelled',
  }),
  planned: Object.freeze({
    id: 'planned',
    label: msg('Planned acquisition'),
    class: 'derived',
  }),
  product: Object.freeze({
    id: 'product',
    label: msg('Available product'),
    class: 'observed',
  }),
  ride: Object.freeze({
    id: 'ride',
    label: msg('Dramatised ride'),
    class: 'simulated',
  }),
});

export const LANE_SOURCES = Object.freeze({
  predicted: Object.freeze({
    id: 'celestrak-gp',
    // i18n-ignore: source credit, a proper name
    label: 'CelesTrak GP elements, SGP4 (satellite.js)',
    url: 'https://celestrak.org/NORAD/elements/',
  }),
  planned: Object.freeze({
    id: 'esa-s2-acquisition-plan',
    // i18n-ignore: credit wording required by ESA's terms
    label: 'European Space Agency - ESA, Sentinel-2 acquisition plan',
    url: 'https://sentinels.copernicus.eu/copernicus/sentinel-2/acquisition-plans',
  }),
  earthSearch: Object.freeze({
    id: 'earth-search',
    // i18n-ignore: source credit, a proper name
    label: 'Element 84 Earth Search STAC v1',
    url: 'https://earth-search.aws.element84.com/v1',
  }),
  cmrStac: Object.freeze({
    id: 'cmr-stac-lpcloud',
    // i18n-ignore: source credit, a proper name
    label: 'NASA CMR-STAC LPCLOUD (HLS)',
    url: 'https://cmr.earthdata.nasa.gov/stac/LPCLOUD',
  }),
  cloud: Object.freeze({
    id: 'open-meteo-cloud',
    // i18n-ignore: source credit, a proper name
    label: 'Open-Meteo forecast, total cloud cover (CC BY 4.0)',
    url: 'https://open-meteo.com/en/docs',
  }),
});

/**
 * Words that would turn a modelled pass into a claim about a photograph.
 * Tests reject them in every Orbit Witness string.
 */
export const FORBIDDEN_CLAIMS = Object.freeze([
  'photographed',
  'was imaged',
  'captured your',
  'saw your',
  'guaranteed',
  'tasking',
]);
