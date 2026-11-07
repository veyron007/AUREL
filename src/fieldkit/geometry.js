/**
 * Bounded area checks for agent-drawn areas. A drawn area must be a simple
 * polygon (no self-crossing), have real area, stay within the latitude and
 * longitude ranges, and fit inside a 2° × 2° box, the same bound watches
 * use, so an agent cannot draw a continent-sized "viewpoint".
 */

import { FieldKitRefusalError } from './refusals.js';

export const MAX_AREA_SPAN_DEG = 2;
const EPSILON = 1e-12;

const refuse = (reason) => {
  throw new FieldKitRefusalError(
    'invalid_geometry',
    `The area is not a valid bounded polygon: ${reason}.`,
    { reason },
  );
};

function cross(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function segmentsCross(a, b, c, d) {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 < -EPSILON && d3 * d4 < -EPSILON;
}

function ringArea(ring) {
  let sum = 0;
  for (let index = 0; index < ring.length - 1; index += 1)
    sum += cross([0, 0], ring[index], ring[index + 1]);
  return Math.abs(sum) / 2;
}

function checkPosition([lon, lat]) {
  if (!Number.isFinite(lon) || lon < -180 || lon > 180)
    refuse('longitude outside −180..180');
  if (!Number.isFinite(lat) || lat < -90 || lat > 90)
    refuse('latitude outside −90..90');
}

function checkSimple(ring) {
  const edges = ring.length - 1;
  for (let i = 0; i < edges; i += 1)
    for (let j = i + 2; j < edges; j += 1) {
      if (i === 0 && j === edges - 1) continue;
      if (segmentsCross(ring[i], ring[i + 1], ring[j], ring[j + 1]))
        refuse('its edges cross each other');
    }
}

/**
 * A closed, validated GeoJSON Polygon from `{ polygon }` or `{ bbox }`.
 * @param {{ polygon?: number[][], bbox?: { west: number, south: number, east: number, north: number } }} args
 * @returns {{ type: 'Polygon', coordinates: number[][][] }}
 */
export function areaPolygon({ polygon, bbox }) {
  if (Boolean(polygon) === Boolean(bbox)) refuse('give polygon or bbox');
  let points;
  if (bbox) {
    const { west, south, east, north } = bbox;
    if (!(west < east) || !(south < north))
      refuse('bbox must have west < east and south < north');
    points = [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
    ];
  } else {
    points = polygon.map((position) => [position[0], position[1]]);
  }
  points.forEach(checkPosition);
  const first = points[0];
  const last = points.at(-1);
  const open =
    first[0] === last[0] && first[1] === last[1] ? points.slice(0, -1) : points;
  const distinct = new Set(open.map((p) => `${p[0]},${p[1]}`));
  if (distinct.size < 3 || distinct.size !== open.length)
    refuse('it needs at least three distinct, non-repeating vertices');
  const ring = [...open, [...open[0]]];
  const lons = open.map((p) => p[0]);
  const lats = open.map((p) => p[1]);
  if (
    Math.max(...lons) - Math.min(...lons) > MAX_AREA_SPAN_DEG ||
    Math.max(...lats) - Math.min(...lats) > MAX_AREA_SPAN_DEG
  )
    refuse(`it spans more than ${MAX_AREA_SPAN_DEG}° in latitude or longitude`);
  if (ringArea(ring) <= EPSILON) refuse('it has no area');
  checkSimple(ring);
  return { type: 'Polygon', coordinates: [ring] };
}
