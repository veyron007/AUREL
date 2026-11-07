import {
  corroborateAircraft,
  corroborateFire,
  corroborateQuake,
} from '../corroboration/index.js';

const FIRE_LAYER_IDS = new Set(['local-firms', 'firms']);
const AIRCRAFT_LAYER_IDS = new Set(['flights', 'military', 'local-adsb']);
const FT_PER_M = 3.28084;
const KT_PER_MPS = 1.943844;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const num = (value) => (finite(value) ? value : null);

/** Which corroboration a selected subject supports, or null. */
export function corroborationKind(subject) {
  if (!subject?.layerId) return null;
  if (subject.layerId === 'earthquakes') return 'quake';
  if (FIRE_LAYER_IDS.has(subject.layerId)) return 'fire';
  if (AIRCRAFT_LAYER_IDS.has(subject.layerId)) return 'aircraft';
  return null;
}

/** The ICAO address of an aircraft subject, lower case, or null. */
export function subjectHex(subject) {
  const raw =
    subject?.layerId === 'local-adsb'
      ? subject.properties?.icao
      : (subject?.properties?.icao24 ?? subject?.id);
  const hex = String(raw ?? '')
    .trim()
    .toLowerCase();
  return /^~?[0-9a-f]{6}$/.test(hex) ? hex : null;
}

/** The map layer's own report of an aircraft, as a corroboration record. */
export function layerAircraftRecord(module, hex) {
  const rows = module?.getAnalystRecords?.(5000) ?? [];
  const row = rows.find((entry) => entry?.icao24 === hex);
  if (!row || !finite(row.lat) || !finite(row.lon)) return null;
  const source = String(module?.getStats?.()?.source ?? '');
  return {
    hex,
    lat: row.lat,
    lon: row.lon,
    positionTimeMs: num(row.lastContactAtMs),
    altBaroFt: finite(row.altitudeM)
      ? Math.round(row.altitudeM * FT_PER_M)
      : null,
    groundSpeedKt: finite(row.speedMps) ? row.speedMps * KT_PER_MPS : null,
    trackDeg: num(row.heading),
    sourceNode: /opensky/i.test(source) ? 'opensky' : 'adsb-lol',
  };
}

/**
 * Owns the Second Source card for the current selection. It reads layer
 * records already in memory and asks only this app's own `/api/second-source`
 * routes, which own every upstream request and its budget. No polling: one
 * check per selection, plus an explicit refresh.
 */
export class CorroborationController {
  constructor({
    store = null,
    client,
    subscribeSubjects,
    readLayer = () => null,
    now = Date.now,
  } = {}) {
    if (!client)
      throw new TypeError('Corroboration needs a Second Source client');
    Object.assign(this, { store, client, subscribeSubjects, readLayer, now });
    this.subject = null;
    this.kind = null;
    this.card = null;
    this.status = 'idle';
    this.revision = 0;
    this.request = null;
    this.unsubscribe = null;
    this.owner = null;
    this.destroyed = false;
  }

  init() {
    if (this.destroyed || this.owner) return;
    this.owner = this.store?.connect({ refresh: () => this.refresh() }) ?? {};
    this.unsubscribe =
      this.subscribeSubjects?.((subject) =>
        subject ? this.select(subject) : this.clear(),
      ) ?? null;
    this.present();
  }

  present() {
    if (this.destroyed) return;
    this.store?.publish(
      this.kind
        ? {
            kind: this.kind,
            status: this.status,
            card: this.card,
            subjectLabel: this.subject?.label ?? null,
          }
        : null,
    );
  }

  select(subject) {
    if (this.destroyed) return;
    // Tracking layers republish the same subject; one check per selection.
    if (
      this.subject &&
      subject?.layerId === this.subject.layerId &&
      subject?.id != null &&
      subject.id === this.subject.id
    )
      return;
    const kind = corroborationKind(subject);
    this.revision += 1;
    this.request?.abort();
    this.request = null;
    this.subject = kind ? subject : null;
    this.kind = kind;
    this.card = null;
    this.status = kind ? 'loading' : 'idle';
    this.present();
    if (kind) void this.refresh();
  }

  clear() {
    if (this.destroyed) return;
    this.revision += 1;
    this.request?.abort();
    this.request = null;
    this.subject = null;
    this.kind = null;
    this.card = null;
    this.status = 'idle';
    this.present();
  }

  async refresh() {
    if (this.destroyed || !this.subject || !this.kind) return;
    const revision = this.revision;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.status = 'loading';
    this.present();
    try {
      const card = await this.build(this.kind, this.subject, request.signal);
      if (this.destroyed || revision !== this.revision) return;
      this.card = card;
      this.status = card ? 'ready' : 'unsupported';
    } catch (error) {
      if (
        this.destroyed ||
        revision !== this.revision ||
        request.signal.aborted
      )
        return;
      console.warn('[Second Source]', error?.message || error);
      this.card = null;
      this.status = 'error';
    } finally {
      if (this.request === request) this.request = null;
    }
    this.present();
  }

  /** Ask the route; a failed request becomes a typed "unavailable" card. */
  async ask(method, query, signal) {
    try {
      return await this.client[method](query, { signal });
    } catch (error) {
      if (signal.aborted) throw error;
      console.warn('[Second Source]', error?.message || error);
      return null;
    }
  }

  async build(kind, subject, signal) {
    const checkedAt = this.now();
    if (kind === 'quake') {
      const p = subject.properties ?? {};
      const primary = {
        usgsId: p.usgsId ?? null,
        lat: num(subject.latitude),
        lon: num(subject.longitude),
        timeMs: num(p.timeMs),
        mag: num(p.mag),
        depthKm: num(p.depthKm),
      };
      if (![primary.lat, primary.lon, primary.timeMs].every(finite))
        return null;
      const answer = await this.ask('quake', primary, signal);
      return corroborateQuake(primary, answer, { checkedAt });
    }
    if (kind === 'fire') {
      const input = this.readLayer(subject.layerId)?.getCorroborationInput?.();
      if (!input || (subject.id && input.id !== subject.id)) return null;
      return corroborateFire(input, { checkedAt });
    }
    const hex = subjectHex(subject);
    if (!hex) return null;
    const layerRecord =
      subject.layerId === 'local-adsb'
        ? null
        : layerAircraftRecord(this.readLayer(subject.layerId), hex);
    const localRecord =
      this.readLayer('local-adsb')?.getCorroborationRecord?.(hex) ?? null;
    const answer = await this.ask('aircraft', { hex }, signal);
    return corroborateAircraft(
      { hex, layerRecord, localRecord, answer },
      { checkedAt },
    );
  }

  destroy() {
    if (this.destroyed) return;
    this.request?.abort();
    this.unsubscribe?.();
    this.store?.detach(this.owner);
    this.store?.publish(null);
    this.destroyed = true;
  }
}
