import { t } from '../i18n/index.js';
import { stationIndices, stationReadings } from '../airQuality/stations.js';
import { STATION_WATCH_CATEGORIES } from '../airQuality/watch.js';
import { NAQI_BREAKPOINTS, NAQI_CATEGORIES } from '../airQuality/naqi.js';

const HOUR_MS = 3_600_000;
const km = (metres) =>
  Number.isFinite(metres) ? Math.round(metres / 100) / 10 : null;

/** The CAMS model hour containing `now`, as a separate modelled card. */
export function camsModelCard(provider, now = Date.now()) {
  if (!provider || !['ready', 'stale'].includes(provider.state))
    return {
      state: provider?.state ?? 'unavailable',
      reason: provider?.reason ?? null,
    };
  const hour =
    provider.hours.find((row) => {
      const start = Date.parse(row.time);
      return start <= now && now < start + HOUR_MS;
    }) ?? provider.hours[0];
  return {
    state: provider.state,
    reason: provider.reason,
    class: 'modelled',
    sourceLabel: provider.sourceLabel,
    attribution: provider.attribution,
    license: provider.license,
    resolutionKm: provider.resolutionM ? provider.resolutionM / 1000 : null,
    grid: provider.grid,
    validAt: hour.time,
    retrievedAt: provider.retrievedAt,
    rows: [
      // i18n-ignore: pollutant symbol
      { id: 'pm25', label: 'PM2.5', value: hour.pm25, unit: 'µg/m³' },
      // i18n-ignore: pollutant symbol
      { id: 'pm10', label: 'PM10', value: hour.pm10, unit: 'µg/m³' },
      // i18n-ignore: scale name
      { id: 'usAqi', label: 'US AQI', value: hour.usAqi, unit: 'US AQI' },
    ],
  };
}

function stationCards(tier) {
  return tier.stations.map((station) => ({
    id: station.id,
    name: station.name,
    locality: station.locality,
    network: [station.dataProvider, station.owner].filter(Boolean).join(' · '),
    licenses: station.licenses,
    distanceKm: km(station.distanceM),
    readings: stationReadings(station),
    pollutants: station.sensors
      .map((sensor) => sensor.pollutant)
      .filter((id) => Object.hasOwn(NAQI_BREAKPOINTS, id)),
  }));
}

function citizenCards(tier) {
  return tier.sensors.map((sensor) => ({
    id: sensor.id,
    sensorType: sensor.sensorType,
    distanceKm: km(sensor.distanceM),
    observedAt: sensor.observedAt,
    pm25: sensor.pm25,
    pm10: sensor.pm10,
  }));
}

/**
 * Owns the Lens Breath card: station, citizen and model air for the selected
 * place, each a separate card. Nothing is requested until the person asks.
 */
export class BreathController {
  constructor({
    stations,
    fieldContext,
    readSelection = () => null,
    subscribeSelection,
    createStationWatch = async () => false,
    store = null,
    now = Date.now,
  } = {}) {
    if (typeof stations?.near !== 'function')
      throw new TypeError('Breath requires a stations source');
    Object.assign(this, {
      stations,
      fieldContext,
      readSelection,
      subscribeSelection,
      createStationWatch,
      store,
      now,
    });
    this.request = null;
    this.destroyed = false;
    this.reset();
  }
  reset() {
    this.request?.abort();
    this.request = null;
    this.status = 'idle';
    this.payload = null;
    this.model = null;
    this.error = null;
    this.feedback = null;
  }
  init() {
    if (this.owner || this.destroyed) return;
    this.owner = this.store?.connect({
      check: () => this.check(),
      chooseStation: (id) => this.check({ station: id }),
      watch: (options) => this.watch(options),
    });
    this.unsubscribe = this.subscribeSelection?.(() => {
      this.reset();
      this.present();
    });
    this.present();
  }
  point() {
    const coordinates = this.readSelection()?.geometry?.coordinates;
    if (!Array.isArray(coordinates)) return null;
    const [lon, lat] = coordinates;
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  }
  async check({ station } = {}) {
    const point = this.point();
    if (!point || this.destroyed) return false;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.status = 'loading';
    this.error = null;
    this.feedback = null;
    this.present();
    // A station switch reuses the model card; it is the same place and hour.
    const askModel = !station && this.fieldContext;
    const [stations, model] = await Promise.allSettled([
      this.stations.near(point, {
        signal: request.signal,
        detail: true,
        station,
      }),
      askModel
        ? this.fieldContext.getContext(point, {
            signal: request.signal,
            airQuality: true,
          })
        : Promise.resolve(null),
    ]);
    if (this.request !== request || this.destroyed) return false;
    this.request = null;
    this.payload = stations.status === 'fulfilled' ? stations.value : null;
    this.error =
      stations.status === 'fulfilled'
        ? null
        : t('Station and citizen readings could not be loaded.');
    if (askModel)
      this.model =
        model.status === 'fulfilled' && model.value
          ? model.value.airQuality
          : { state: 'unavailable', reason: 'upstream-unavailable' };
    this.status = 'ready';
    this.present();
    return stations.status === 'fulfilled';
  }
  async watch({ stationId, pollutant = 'pm25', category = 'poor' } = {}) {
    const station = this.payload?.stations.stations.find(
      (row) => row.id === stationId,
    );
    if (!station || !STATION_WATCH_CATEGORIES.includes(category)) return false;
    const saved = await this.createStationWatch({
      station,
      pollutant,
      category,
    });
    this.feedback = saved
      ? t('Station watch saved in Watch areas. Start it there when ready.')
      : t('The station watch could not be saved.');
    this.present();
    return saved;
  }
  view() {
    const point = this.point();
    const payload = this.payload;
    const detail = payload?.stations.detail ?? null;
    const indices = stationIndices(detail);
    const detailStation = payload?.stations.stations.find(
      (row) => row.id === detail?.stationId,
    );
    return {
      available: point !== null,
      point,
      status: this.status,
      error: this.error,
      feedback: this.feedback,
      stations: payload && {
        state: payload.stations.state,
        reason: payload.stations.reason,
        retrievedAt: payload.stations.retrievedAt,
        radiusKm: km(payload.stations.radiusM),
        items: stationCards(payload.stations),
        detailId: detail?.stationId ?? null,
        detailState: detail?.state ?? null,
      },
      indices: indices && {
        ...indices,
        stationName: detailStation?.name ?? indices.stationId,
      },
      citizen: payload && {
        state: payload.citizen.state,
        retrievedAt: payload.citizen.retrievedAt,
        radiusKm: km(payload.citizen.radiusM),
        items: citizenCards(payload.citizen),
      },
      model: this.model && camsModelCard(this.model, this.now()),
      watchCategories: NAQI_CATEGORIES.filter((c) =>
        STATION_WATCH_CATEGORIES.includes(c.id),
      ).map((c) => ({ id: c.id, label: c.label })),
    };
  }
  present() {
    if (this.destroyed) return;
    this.store?.publish(this.view());
  }
  destroy() {
    if (this.destroyed) return;
    this.request?.abort();
    this.request = null;
    this.unsubscribe?.();
    if (this.owner) this.store?.detach(this.owner);
    this.destroyed = true;
  }
}
