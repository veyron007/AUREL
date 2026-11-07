import { createSourceAdapter } from './adapter.js';

export const ADSB_FI_HEX_URL = 'https://opendata.adsb.fi/api/v2/hex/';
export const ADSB_LOL_HEX_URL = 'https://api.adsb.lol/v2/hex/';

const HEX = /^~?[0-9a-f]{6}$/;

/** A 24-bit ICAO address (TIS-B "~" prefix allowed), lower case, or null. */
export function validHex(value) {
  const hex = String(value ?? '')
    .trim()
    .toLowerCase();
  return HEX.test(hex) ? hex : null;
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Parse one readsb-style v2 answer ({ac, now}) shared by adsb.fi and
 * adsb.lol. `now` is epoch milliseconds on the hex route and epoch seconds on
 * some point routes, so both are accepted. Position time is the answer time
 * minus `seen_pos`, the age of the last position message.
 */
export function parseAircraftV2(text, query = {}) {
  const payload = JSON.parse(text);
  const rows = payload?.ac ?? payload?.aircraft;
  if (!Array.isArray(rows) || !finite(payload?.now)) return null;
  const nowMs = payload.now < 1e11 ? payload.now * 1000 : payload.now;
  const records = [];
  let dropped = 0;
  for (const row of rows) {
    const hex = validHex(row?.hex);
    if (
      !hex ||
      (query.hex && hex !== query.hex) ||
      !finite(row.lat) ||
      !finite(row.lon) ||
      Math.abs(row.lat) > 90 ||
      Math.abs(row.lon) > 180 ||
      !finite(row.seen_pos) ||
      row.seen_pos < 0
    ) {
      dropped += 1;
      continue;
    }
    records.push({
      hex,
      flight: typeof row.flight === 'string' ? row.flight.trim() || null : null,
      lat: row.lat,
      lon: row.lon,
      positionTimeMs: Math.round(nowMs - row.seen_pos * 1000),
      altBaroFt: finite(row.alt_baro) ? row.alt_baro : null,
      onGround: row.alt_baro === 'ground',
      groundSpeedKt: finite(row.gs) ? row.gs : null,
      trackDeg: finite(row.track) ? row.track : null,
      // Positions from multilateration or TIS-B are not the aircraft's own
      // broadcast; the card names the position type.
      positionType:
        Array.isArray(row.mlat) && row.mlat.includes('lat')
          ? 'mlat'
          : Array.isArray(row.tisb) && row.tisb.includes('lat')
            ? 'tisb'
            : 'adsb',
    });
  }
  return { records, dropped };
}

function hexAdapter({ sourceId, baseUrl, ledger, ...options }) {
  return createSourceAdapter({
    sourceId,
    ledger,
    ttlMs: 8_000,
    staleMaxMs: 60_000,
    request: ({ hex }) => {
      const valid = validHex(hex);
      if (!valid) throw new TypeError('invalid hex');
      const url = `${baseUrl}${encodeURIComponent(valid)}`;
      return { url, key: url, limit: Infinity };
    },
    parse: parseAircraftV2,
    ...options,
  });
}

/** adsb.fi open data, personal non-commercial use, 1 request/second. */
export function createAdsbFiAdapter(options) {
  return hexAdapter({
    sourceId: 'adsb-fi',
    baseUrl: ADSB_FI_HEX_URL,
    ...options,
  });
}

/** adsb.lol single-aircraft lookup, the same aggregator the flights layer uses. */
export function createAdsbLolHexAdapter(options) {
  return hexAdapter({
    sourceId: 'adsb-lol',
    baseUrl: ADSB_LOL_HEX_URL,
    ...options,
  });
}
