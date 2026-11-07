import { calculateProfile } from './profile.js';
import { checkpointElevation } from './checkpointSheet.js';

const HOUR = 3600000;
const DAY = 24 * HOUR;
export const ELEVATION_SOURCES = Object.freeze([
  'route-profile',
  'terrain-lookup',
  'provider-dem',
]);

/** Checkpoint elevation: saved route profile, then one evidenced terrain lookup, else the provider's own DEM. */
export async function resolveCheckpointElevation(
  checkpoint,
  profile,
  { getTerrain, signal } = {},
) {
  const saved = checkpointElevation(checkpoint, profile);
  if (saved) return saved;
  if (getTerrain) {
    try {
      const point = { lat: checkpoint.lat, lon: checkpoint.lon, distanceM: 0 };
      const envelope = await getTerrain([point], { signal });
      const [sample] = calculateProfile(
        { samples: [point], sampleSpacingM: 0 },
        envelope || {},
      ).samples;
      if (Number.isFinite(sample?.elevationM))
        return { elevationM: sample.elevationM, source: 'terrain-lookup' };
    } catch {
      signal?.throwIfAborted();
    }
  }
  return { elevationM: null, source: 'provider-dem' };
}

/** The sheet's focus hour: the departure hour when it lies inside the provider window. */
export function sheetFocusHour(departureAt, now = Date.now()) {
  const at = Date.parse(departureAt);
  if (!Number.isFinite(at)) return null;
  const hour = Math.floor(at / HOUR) * HOUR;
  return hour >= now - 2 * DAY + HOUR && hour <= now + 15 * DAY
    ? new Date(hour).toISOString()
    : null;
}

/** Returns a new snapshot with the sheet attached to one checkpoint; the input is not changed. */
export async function loadCheckpointSheet({
  snapshot,
  index,
  getMountainWeather,
  getTerrain,
  signal,
  now = Date.now(),
}) {
  const checkpoint = snapshot?.checkpoints?.[index];
  if (!checkpoint || typeof getMountainWeather !== 'function')
    throw new Error('Checkpoint sheet is unavailable.');
  const elevation = await resolveCheckpointElevation(
    checkpoint,
    snapshot.profile,
    { getTerrain, signal },
  );
  signal?.throwIfAborted();
  const sheet = await getMountainWeather(
    {
      lat: checkpoint.lat,
      lon: checkpoint.lon,
      elevationM: Number.isFinite(elevation.elevationM)
        ? Math.round(elevation.elevationM)
        : null,
    },
    { from: sheetFocusHour(snapshot.departureAt, now), signal },
  );
  signal?.throwIfAborted();
  return {
    ...snapshot,
    checkpoints: snapshot.checkpoints.map((row, i) =>
      i === index
        ? {
            ...row,
            mountainWeather: { elevationSource: elevation.source, sheet },
          }
        : row,
    ),
  };
}
