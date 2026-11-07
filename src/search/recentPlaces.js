/**
 * The last few places the user chose from location search, kept in this
 * browser only. Storage can be missing or throw (private windows, blocked
 * site data); every read and write tolerates that and simply remembers less.
 */
export const RECENT_PLACES_KEY = 'aurel:recent-places:v1';
export const RECENT_PLACES_MAX = 6;

function storageOf(storage) {
  try {
    return storage === undefined ? globalThis.localStorage : storage;
  } catch {
    return null;
  }
}

function clean(place) {
  if (
    !place ||
    !Number.isFinite(place.lat) ||
    !Number.isFinite(place.lng) ||
    Math.abs(place.lat) > 90 ||
    Math.abs(place.lng) > 180
  )
    return null;
  const label = String(place.label || place.name || '').slice(0, 200);
  if (!label.trim()) return null;
  return {
    lat: place.lat,
    lng: place.lng,
    name: String(place.name || label).slice(0, 200),
    label,
    types: Array.isArray(place.types)
      ? place.types.filter((type) => typeof type === 'string').slice(0, 6)
      : [],
    exact: true,
    viewport: place.viewport ?? null,
  };
}

export function createRecentPlaces({ storage } = {}) {
  const store = storageOf(storage);
  const read = () => {
    try {
      const parsed = JSON.parse(store?.getItem(RECENT_PLACES_KEY) || '[]');
      return Array.isArray(parsed)
        ? parsed.map(clean).filter(Boolean).slice(0, RECENT_PLACES_MAX)
        : [];
    } catch {
      return [];
    }
  };
  return {
    read,
    remember(place) {
      const entry = clean(place);
      if (!entry) return;
      const key = `${entry.label}|${entry.lat.toFixed(4)},${entry.lng.toFixed(4)}`;
      const next = [
        entry,
        ...read().filter(
          (old) =>
            `${old.label}|${old.lat.toFixed(4)},${old.lng.toFixed(4)}` !== key,
        ),
      ].slice(0, RECENT_PLACES_MAX);
      try {
        store?.setItem(RECENT_PLACES_KEY, JSON.stringify(next));
      } catch {
        // Storage full or blocked: the list stays as it was.
      }
    },
    clear() {
      try {
        store?.removeItem(RECENT_PLACES_KEY);
      } catch {
        // Nothing to clear.
      }
    },
  };
}
