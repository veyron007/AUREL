/** `horizon_at`: the Kshitij terrain horizon as a provenance envelope. */
import { defineTool, ToolError } from '../catalog.js';
import { toProvenanceEnvelope } from '../../horizon/envelope.js';
import { normalizeHorizonRequest } from '../../horizon/service.js';
import { localDateAt, resolveLocalDateTime } from '../../planner/daylight.js';

const clock = (iso, timeZone) =>
  iso
    ? new Date(iso).toLocaleTimeString('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'none';

export const horizonAt = defineTool({
  name: 'horizon_at',
  title: 'Terrain horizon at a point',
  description:
    'The 360° terrain horizon at a point from the Copernicus GLO-30 DEM ' +
    '(refraction k = 0.13), the named OSM peaks that break the skyline with ' +
    'azimuth, distance and elevation, astronomical against terrain-clipped ' +
    'sunrise, sunset and moonrise for a local date, and a gnomon shadow at ' +
    'an optional local time. Geometric visibility, terrain-only: trees, ' +
    'buildings, haze and cloud are not modelled. Every number carries unit, ' +
    'class, source and applicable time.',
  inputSchema: {
    type: 'object',
    properties: {
      lat: { type: 'number', minimum: -85, maximum: 85 },
      lon: { type: 'number', minimum: -180, maximum: 180 },
      observerHeightM: {
        type: 'number',
        minimum: 0,
        maximum: 500,
        description:
          'Eye height above the DEM surface in metres (default 1.7).',
      },
      date: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Local calendar date YYYY-MM-DD (default today).',
      },
      time: {
        type: 'string',
        pattern: '^\\d{2}:\\d{2}$',
        description: 'Local time HH:MM for the shadow prediction (optional).',
      },
      timeZone: {
        type: 'string',
        maxLength: 64,
        description: 'IANA time zone (default Asia/Kolkata).',
      },
      gnomonM: { type: 'number', minimum: 0.1, maximum: 100 },
      radiusKm: { type: 'integer', minimum: 10, maximum: 200 },
    },
    required: ['lat', 'lon'],
    additionalProperties: false,
  },
  requires: ['horizon'],
  async run(args, { services, signal }) {
    const timeZone = args.timeZone ?? 'Asia/Kolkata';
    let request;
    try {
      const localDate = args.date ?? localDateAt(Date.now(), timeZone);
      request = normalizeHorizonRequest({
        lat: args.lat,
        lon: args.lon,
        observerHeightM: args.observerHeightM,
        localDate,
        timeZone,
        shadowAt: args.time
          ? resolveLocalDateTime(`${localDate}T${args.time}`, timeZone)
          : null,
        gnomonM: args.gnomonM,
        radiusKm: args.radiusKm,
      });
    } catch (error) {
      throw new ToolError('invalid_arguments', error.message);
    }
    let result;
    try {
      result = await services.horizon.horizonAt(request, { signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      const message = error?.message || 'The horizon could not be computed.';
      throw new ToolError(
        /limit/i.test(message) ? 'retry_later' : 'unavailable',
        message,
      );
    }
    const envelope = toProvenanceEnvelope(result);
    const skyline = envelope.peaks.listed.filter((p) => p.state === 'skyline');
    const named = skyline
      .slice(0, 3)
      .map(
        (p) => `${p.name} az ${p.azimuthDeg.value}° ${p.distanceKm.value} km`,
      )
      .join('; ');
    return {
      summary:
        `Terrain-only horizon at ${request.lat}, ${request.lon} on ${request.localDate}: ` +
        `sunrise ${clock(envelope.sun.astronomicalRise.value, timeZone)} astronomical, ` +
        `${clock(envelope.sun.terrainRise.value, timeZone)} over the terrain; ` +
        `${skyline.length} named peak(s) on the skyline${named ? ` (${named})` : ''}. ` +
        'Geometric visibility, terrain-only.',
      data: envelope,
    };
  },
});
