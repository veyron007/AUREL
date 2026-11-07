/**
 * Location suggestions while the user types.
 *
 * Local matches (typed coordinates, bundled cities and landmarks, recent
 * choices) answer on every keystroke without a request. A remote suggester
 * (keyless Photon, which is built for search-as-you-type) is asked only after
 * the typing pauses, never for fewer than `minRemoteChars` characters, at most
 * one request at a time and no more often than `minIntervalMs`. Each answer is
 * cached by query and coarse viewport cell, so retyping or backspacing reuses
 * it. An answer that arrives after a newer keystroke is dropped.
 *
 * Nominatim and Google autocomplete are deliberately not used here: the public
 * Nominatim policy forbids autocomplete and Google's is billable.
 */
import { parseCoordinateQuery } from './coordinateParser.js';

export const SUGGEST_DEFAULTS = Object.freeze({
  debounceMs: 250,
  minRemoteChars: 3,
  minIntervalMs: 350,
  limit: 8,
  localLimit: 4,
  cacheSize: 120,
  cacheTtlMs: 10 * 60_000,
  emptyTtlMs: 60_000,
  maxQueryLength: 120,
});

/** Fold a name for comparison: case, accents, punctuation and spacing. */
export function foldName(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 0 exact, 1 prefix, 2 word prefix, 3 contains; null when it does not match. */
export function matchRank(name, query) {
  const folded = foldName(name);
  if (!folded || !query) return null;
  if (folded === query) return 0;
  if (folded.startsWith(query)) return 1;
  if (folded.split(' ').some((word) => word.startsWith(query))) return 2;
  if (query.length >= 3 && folded.includes(query)) return 3;
  return null;
}

/** Round the viewport-bias centre to a 1° cell so nearby views share answers. */
export function biasCell(bias) {
  const tokens = String(bias ?? '')
    .split(/[|,]/)
    .map(Number);
  if (tokens.length !== 4 || !tokens.every(Number.isFinite)) return 'world';
  const lat = Math.round((tokens[0] + tokens[2]) / 2);
  const lng = Math.round((tokens[1] + tokens[3]) / 2);
  return `${lat},${lng}`;
}

function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True when two places are the same name within two kilometres. */
export function samePlace(a, b) {
  return (
    foldName(a.name || a.label) === foldName(b.name || b.label) &&
    distanceKm(a, b) < 2
  );
}

/** One suggestion row: the place, where it came from, and a stable key. */
function item(place, source) {
  return {
    key: `${source}:${place.lat.toFixed(5)},${place.lng.toFixed(5)}:${foldName(place.label || place.name)}`,
    source,
    place,
  };
}

/**
 * Local matches for one query. `places` are bundled places, `recent` the
 * user's recent choices; both are `{lat, lng, name, label, ...}`.
 */
export function localSuggestions(
  text,
  { places = [], recent = [], limit = SUGGEST_DEFAULTS.localLimit } = {},
) {
  const coordinate = parseCoordinateQuery(text);
  if (coordinate)
    return [
      item(
        {
          lat: coordinate.lat,
          lng: coordinate.lon,
          name: coordinate.label,
          label: coordinate.label,
          types: ['coordinate'],
          exact: true,
          viewport: null,
        },
        'coordinate',
      ),
    ];
  const query = foldName(text);
  if (query.length < 1) return [];
  const ranked = [];
  for (const [source, list, bonus] of [
    ['recent', recent, -0.5],
    ['preset', places, 0],
  ])
    for (const place of list) {
      const rank = Math.min(
        matchRank(place.name, query) ?? Infinity,
        matchRank(place.label, query) ?? Infinity,
      );
      if (rank !== Infinity) ranked.push({ rank: rank + bonus, source, place });
    }
  ranked.sort((a, b) => a.rank - b.rank);
  const out = [];
  for (const entry of ranked) {
    if (out.some((existing) => samePlace(existing.place, entry.place)))
      continue;
    out.push(item(entry.place, entry.source));
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Build the engine. `remote(text, {bias, signal})` resolves to an array of
 * places or rejects; it may be null when no remote suggester is configured.
 * `onUpdate(state)` receives `{query, items, loading, remote}` where `remote`
 * is 'idle' | 'pending' | 'loading' | 'done' | 'cached' | 'unavailable' | 'skipped'.
 */
export function createSuggestionEngine({
  remote = null,
  places = [],
  readRecent = () => [],
  onUpdate = () => {},
  now = Date.now,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  options = {},
} = {}) {
  const config = { ...SUGGEST_DEFAULTS, ...options };
  const cache = new Map();
  let generation = 0;
  let timer = null;
  let controller = null;
  let lastDispatchAt = -Infinity;
  let destroyed = false;
  let current = { query: '', items: [], loading: false, remote: 'idle' };

  const publish = (state) => {
    current = state;
    if (!destroyed) onUpdate(state);
  };

  const cacheKey = (query, bias) => `${biasCell(bias)}\n${query}`;
  const readCache = (key) => {
    const hit = cache.get(key);
    if (!hit) return null;
    if (hit.expires <= now()) {
      cache.delete(key);
      return null;
    }
    // Refresh recency: Map iteration order is the eviction order.
    cache.delete(key);
    cache.set(key, hit);
    return hit.places;
  };
  const writeCache = (key, list) => {
    cache.set(key, {
      places: list,
      expires: now() + (list.length ? config.cacheTtlMs : config.emptyTtlMs),
    });
    while (cache.size > config.cacheSize)
      cache.delete(cache.keys().next().value);
  };

  const merge = (local, remotePlaces) => {
    const out = [...local];
    for (const place of remotePlaces) {
      if (out.some((existing) => samePlace(existing.place, place))) continue;
      out.push(item(place, 'remote'));
      if (out.length >= config.limit) break;
    }
    return out.slice(0, config.limit);
  };

  const cancelPending = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    controller?.abort();
    controller = null;
  };

  async function dispatch(text, query, bias, local, mine) {
    timer = null;
    const wait = lastDispatchAt + config.minIntervalMs - now();
    if (wait > 0) {
      timer = setTimer(() => dispatch(text, query, bias, local, mine), wait);
      return;
    }
    lastDispatchAt = now();
    controller = new AbortController();
    const { signal } = controller;
    publish({ query: text, items: local, loading: true, remote: 'loading' });
    try {
      const answer = await remote(text, { bias, signal });
      if (mine !== generation || signal.aborted) return;
      const list = Array.isArray(answer) ? answer.filter(validPlace) : [];
      writeCache(cacheKey(query, bias), list);
      publish({
        query: text,
        items: merge(local, list),
        loading: false,
        remote: 'done',
      });
    } catch {
      if (mine !== generation || signal.aborted) return;
      publish({
        query: text,
        items: local,
        loading: false,
        remote: 'unavailable',
      });
    } finally {
      if (mine === generation) controller = null;
    }
  }

  return {
    /** Ask for suggestions for the field's current text. */
    update(rawText, { bias = null } = {}) {
      if (destroyed) return;
      const text = String(rawText ?? '').slice(0, config.maxQueryLength);
      const mine = ++generation;
      cancelPending();
      const query = foldName(text);
      const local = localSuggestions(text, {
        places,
        limit: config.localLimit,
      });
      const recentMatches = query
        ? localSuggestions(text, {
            recent: safeRecent(readRecent),
            limit: config.localLimit,
          }).filter((entry) => entry.source === 'recent')
        : safeRecent(readRecent)
            .slice(0, config.localLimit)
            .map((place) => item(place, 'recent'));
      const firstLocal = [...recentMatches];
      for (const entry of local)
        if (
          !firstLocal.some((existing) => samePlace(existing.place, entry.place))
        )
          firstLocal.push(entry);
      const localItems = firstLocal.slice(0, config.limit);
      const coordinate = localItems[0]?.source === 'coordinate';
      if (!remote || coordinate || query.length < config.minRemoteChars) {
        publish({
          query: text,
          items: localItems,
          loading: false,
          remote: remote ? 'skipped' : 'idle',
        });
        return;
      }
      const cached = readCache(cacheKey(query, bias));
      if (cached) {
        publish({
          query: text,
          items: merge(localItems, cached),
          loading: false,
          remote: 'cached',
        });
        return;
      }
      publish({
        query: text,
        items: localItems,
        loading: true,
        remote: 'pending',
      });
      timer = setTimer(
        () => dispatch(text, query, bias, localItems, mine),
        config.debounceMs,
      );
    },
    /** Drop pending and in-flight work, e.g. when the field closes. */
    cancel() {
      generation++;
      cancelPending();
      if (current.loading)
        publish({ ...current, loading: false, remote: 'idle' });
    },
    get state() {
      return current;
    },
    get cacheSize() {
      return cache.size;
    },
    destroy() {
      destroyed = true;
      generation++;
      cancelPending();
      cache.clear();
    },
  };
}

function validPlace(place) {
  return (
    place &&
    Number.isFinite(place.lat) &&
    Number.isFinite(place.lng) &&
    Math.abs(place.lat) <= 90 &&
    Math.abs(place.lng) <= 180 &&
    String(place.label || place.name || '').trim() !== ''
  );
}

function safeRecent(readRecent) {
  try {
    const list = readRecent();
    return Array.isArray(list) ? list.filter(validPlace) : [];
  } catch {
    return [];
  }
}
