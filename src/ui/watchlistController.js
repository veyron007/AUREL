import { t } from '../i18n/index.js';
import {
  createWatchDefinition,
  watchBounds,
  reduceWatchCheck,
  watchKind,
  WATCH_LIMITS,
} from '../watchlists/model.js';
import {
  createSceneWatchDefinition,
  reduceSceneWatchCheck,
  SCENE_WATCH_KIND,
} from '../orbitWitness/sceneWatch.js';
import { createWatchlistRepository } from '../watchlists/repository.js';
import { createWatchlistSource } from '../watchlists/source.js';
import {
  createStationCondition,
  describeCondition,
  reduceStationWatchCheck,
} from '../airQuality/watch.js';

const iso = (value) =>
  value === null || value === undefined ? null : new Date(value).toISOString();
const defaultVisibility = () =>
  globalThis.document?.visibilityState !== 'hidden';
function visibilitySubscription(listener) {
  globalThis.document?.addEventListener('visibilitychange', listener);
  return () =>
    globalThis.document?.removeEventListener('visibilitychange', listener);
}
/** Explicit in-app monitoring only. No constructor/init acquisition, OS notifications or background service. */
export class WatchlistController {
  constructor({
    repository = createWatchlistRepository(),
    source = createWatchlistSource(),
    stationSource = null,
    sceneSource = null,
    onOpenScene = null,
    readSavedPlaces = () => [],
    subscribeSavedPlaces,
    visibility = defaultVisibility,
    subscribeVisibility = visibilitySubscription,
    now = Date.now,
    timers = {},
    store,
    publish = () => {},
  } = {}) {
    Object.assign(this, {
      repository,
      source,
      stationSource,
      sceneSource,
      onOpenScene,
      readSavedPlaces,
      subscribeSavedPlaces,
      visibility,
      subscribeVisibility,
      now,
      store,
      publish,
    });
    this.timers = {
      setTimeout:
        timers.setTimeout || ((...args) => globalThis.setTimeout(...args)),
      clearTimeout:
        timers.clearTimeout || ((...args) => globalThis.clearTimeout(...args)),
    };
    this.ownerId = globalThis.crypto.randomUUID();
    this.records = new Map();
    this.sessions = new Map();
    this.destroyed = false;
    this.loading = false;
    this.busy = false;
    this.error = null;
    this.feedback = null;
  }
  live() {
    return (
      !this.destroyed &&
      (!this.store?.owns || this.store.owns(this.owner, 'start'))
    );
  }
  init() {
    if (this.ready) return this.ready;
    this.owner = this.store?.connect(
      Object.fromEntries(
        [
          'create',
          'createStationWatch',
          'start',
          'stop',
          'remove',
          'clearNotifications',
          'refresh',
          'openScene',
        ].map((k) => [k, (...args) => this[k](...args)]),
      ),
    );
    this.offVisibility = this.subscribeVisibility(() =>
      this._visibilityChanged(),
    );
    this.offPlaces = this.subscribeSavedPlaces?.(() => this.present());
    this.ready = this.refresh();
    return this.ready;
  }
  present() {
    if (!this.live()) return;
    const places = (this.readSavedPlaces() || [])
      .slice(0, 1000)
      .map((place) => {
        let bounds = null;
        try {
          bounds = watchBounds(place);
        } catch {}
        return {
          id: place.id,
          name: place.name,
          bounds,
          available: bounds !== null,
        };
      });
    const watches = [...this.records.values()].map((record) => {
      const { definition: d, runtime: r } = record,
        session = this.sessions.get(d.id),
        foreign =
          record.lease &&
          record.lease.ownerId !== this.ownerId &&
          record.lease.until > this.now();
      return {
        id: d.id,
        kind:
          watchKind(d) === SCENE_WATCH_KIND
            ? SCENE_WATCH_KIND
            : d.condition
              ? 'station'
              : 'firms',
        condition: d.condition ? describeCondition(d.condition) : null,
        title: d.title,
        placeName: d.place.name,
        bounds: d.bounds,
        intervalMinutes: d.intervalMs / 60000,
        state: foreign ? 'other-tab' : session?.state || 'stopped',
        reason: foreign
          ? t('Monitoring is active in another tab.')
          : session?.reason || null,
        baselinePending: session?.baselinePending ?? r.baselineAt === null,
        lastAttemptAt: iso(r.lastAttemptAt),
        lastSuccessAt: iso(r.lastSuccessAt),
        lastRetrievedAt: iso(r.lastRetrievedAt),
        nextCheckAt: session?.wanted ? iso(r.nextAllowedAt) : null,
        errorCount: r.errorCount,
        coverage: r.coverage,
        sources: r.sources,
        notifications: r.notifications,
      };
    });
    this.view = {
      loading: this.loading,
      busy: this.busy,
      error: this.error,
      feedback: this.feedback,
      places,
      watches,
      canCreate:
        !this.loading &&
        !this.busy &&
        this.records.size < WATCH_LIMITS.definitions &&
        places.some((p) => p.available),
      sceneWatchAvailable: Boolean(this.sceneSource),
      limitations: [
        t(
          'Monitoring runs only while this app is open and visible. Each watch checks no more often than every 30 minutes.',
        ),
        t(
          'The first successful check establishes a quiet baseline. Waking or resuming does not generate a backlog of notifications.',
        ),
        t(
          'FIRMS thermal observations are not confirmed fires. Missing detections do not establish that no fire exists.',
        ),
        t(
          'A station watch notes when one monitor crosses into a NAQI category on its 24 h mean (8 h for CO and O3), once per crossing, at most every six hours.',
        ),
        t(
          'Scene watches check the open STAC catalogues no more often than hourly. A catalogued scene can arrive hours to days after acquisition, and a catalogue outage reads as unknown, not as no scene.',
        ),
      ],
    };
    this.publish(this.view);
    this.store?.publish(this.view);
  }
  async refresh() {
    if (!this.live()) return false;
    this.loading = true;
    this.present();
    try {
      const result = await this.repository.list();
      if (!this.live()) return false;
      this.records = new Map(result.watches.map((r) => [r.definition.id, r]));
      this.error = result.corrupt.length
        ? t(
            'Some local watchlists need recovery. Their original records have been preserved.',
          )
        : null;
      return true;
    } catch {
      if (this.live())
        this.error = t(
          'Local watchlists could not be loaded. Monitoring remains stopped.',
        );
      return false;
    } finally {
      this.loading = false;
      this.present();
    }
  }
  async create({
    placeId,
    place: supplied = null,
    title,
    intervalMinutes,
    kind = 'firms',
  } = {}) {
    if (!this.live() || this.busy) return false;
    const scene = kind === SCENE_WATCH_KIND;
    if (scene && !this.sceneSource) return false;
    this.busy = true;
    this.error = null;
    try {
      // A scene watch may also start from the place on screen (Orbit Witness).
      const place =
        this.readSavedPlaces().find((p) => p.id === placeId) ||
        (scene ? supplied : null);
      if (!place) throw Error();
      const fields = {
        place,
        title:
          typeof title === 'string' && title.trim() ? title.trim() : place.name,
        intervalMinutes: intervalMinutes ?? (scene ? 180 : 30),
      };
      const definition = scene
        ? createSceneWatchDefinition(fields, { now: this.now() })
        : createWatchDefinition(fields, { now: this.now() });
      const record = await this.repository.save(definition, {
        expectedRevision: null,
      });
      if (!this.live()) return false;
      this.records.set(record.definition.id, record);
      this.feedback = t(
        'Watchlist saved. Start monitoring explicitly when you are ready.',
      );
      return true;
    } catch {
      this.error = scene
        ? t(
            'The scene watch could not be saved. Use a place within a two-degree area and an interval of at least 60 minutes.',
          )
        : t(
            'The watchlist could not be saved. Use a saved place within a two-degree area and an interval of at least 30 minutes.',
          );
      return false;
    } finally {
      this.busy = false;
      this.present();
    }
  }
  /** A watch on one monitor crossing a NAQI category; no saved place needed. */
  async createStationWatch({
    station,
    pollutant = 'pm25',
    category = 'poor',
    intervalMinutes = 60,
  } = {}) {
    if (!this.live() || this.busy) return false;
    this.busy = true;
    this.error = null;
    try {
      if (!this.stationSource) throw Error();
      const condition = createStationCondition({
        station,
        pollutant,
        category,
      });
      const definition = createWatchDefinition(
        {
          place: {
            id: `station:${station.id}`,
            name: condition.stationName,
            geometry: { coordinates: [station.lon, station.lat] },
          },
          title: condition.stationName,
          intervalMinutes,
          condition,
        },
        { now: this.now() },
      );
      const record = await this.repository.save(definition, {
        expectedRevision: null,
      });
      if (!this.live()) return false;
      this.records.set(record.definition.id, record);
      this.feedback = t(
        'Station watch saved. Start monitoring explicitly when you are ready.',
      );
      return true;
    } catch {
      this.error = t(
        'The station watch could not be saved. At most eight watches are kept.',
      );
      return false;
    } finally {
      this.busy = false;
      this.present();
    }
  }
  /** One acquisition and reduction for either watch kind. */
  async _check(record, { signal, baseline, interval }) {
    if (watchKind(record.definition) === SCENE_WATCH_KIND) {
      if (!this.sceneSource) throw Error('No scene source');
      const result = await this.sceneSource.check(record.definition, {
        signal,
      });
      return {
        result,
        needsKey: false,
        runtime: reduceSceneWatchCheck(record.runtime, result.context, {
          now: this.now(),
          baseline,
          intervalMs: interval,
          lookbackDays: record.definition.scene.lookbackDays,
        }),
      };
    }
    const condition = record.definition.condition;
    if (!condition) {
      const result = await this.source.check(record.definition.bounds, {
        signal,
      });
      return {
        result,
        needsKey: result.context.status === 'needs-key',
        runtime: reduceWatchCheck(record.runtime, result.context, {
          bounds: record.definition.bounds,
          now: this.now(),
          baseline,
          intervalMs: interval,
        }),
      };
    }
    if (!this.stationSource) throw Error('No station source');
    const result = await this.stationSource.check(condition, { signal });
    return {
      result,
      needsKey: result.series.state === 'needs-key',
      runtime: reduceStationWatchCheck(record.runtime, result.series, {
        condition,
        now: this.now(),
        baseline,
        intervalMs: interval,
        limits: WATCH_LIMITS,
      }),
    };
  }
  _valid(id, session) {
    return (
      this.live() &&
      this.sessions.get(id) === session &&
      session.wanted &&
      !session.request?.signal.aborted
    );
  }
  _clearTimers(session) {
    for (const key of ['timer', 'heartbeat']) {
      if (session[key] !== null) this.timers.clearTimeout(session[key]);
      session[key] = null;
    }
  }
  async _halt(id, state = 'stopped', wanted = false, reason = null) {
    const session = this.sessions.get(id);
    if (!session) return;
    session.wanted = wanted;
    session.state = state;
    session.reason = reason;
    session.baselinePending = true;
    session.request?.abort();
    session.request = null;
    this._clearTimers(session);
    const token = session.token;
    session.token = null;
    this.present();
    if (token)
      try {
        const record = await this.repository.release(id, this.ownerId, token);
        if (this.sessions.get(id) === session && !session.token && record)
          this.records.set(id, record);
      } catch {
        this.error = t(
          'Monitoring stopped, but its local lease could not be released. It will expire automatically.',
        );
      }
    this.present();
  }
  async start(id) {
    if (!this.live() || this.loading || this.sessions.get(id)?.request)
      return false;
    const prior = this.sessions.get(id);
    if (
      prior?.wanted &&
      ['checking', 'running', 'paused-cooldown'].includes(prior.state)
    )
      return false;
    if (
      [...this.sessions].filter(([key, s]) => key !== id && s.wanted).length >=
      WATCH_LIMITS.active
    ) {
      this.error = t(
        'At most four watchlists can monitor at once. Stop one before starting another.',
      );
      this.present();
      return false;
    }
    if (!this.records.has(id)) return false;
    const session = {
      wanted: true,
      state: 'checking',
      reason: null,
      baselinePending: true,
      token: null,
      timer: null,
      heartbeat: null,
      request: null,
    };
    this.sessions.set(id, session);
    this.present();
    if (!this.visibility()) {
      session.state = 'paused-hidden';
      this.present();
      return true;
    }
    try {
      const record = await this.repository.claim(id, this.ownerId, this.now());
      if (!this._valid(id, session) || !this.visibility()) {
        await this.repository.release(id, this.ownerId, record.lease.token);
        return false;
      }
      this.records.set(id, record);
      session.token = record.lease.token;
      this._heartbeat(id, session);
      if (record.runtime.nextAllowedAt > this.now()) {
        session.state = 'paused-cooldown';
        session.reason = t('Waiting for the next allowed check.');
        this._schedule(id, session);
        this.present();
      } else void this._tick(id, session);
      return true;
    } catch (error) {
      if (this.sessions.get(id) !== session) return false;
      session.wanted = false;
      session.state =
        error.code === 'OTHER_TAB' ? 'other-tab' : 'paused-errors';
      session.reason =
        error.code === 'OTHER_TAB'
          ? t('Monitoring is active in another tab.')
          : t(
              'Monitoring could not obtain local ownership. Refresh and retry.',
            );
      this.present();
      return false;
    }
  }
  _heartbeat(id, session) {
    session.heartbeat = this.timers.setTimeout(async () => {
      session.heartbeat = null;
      if (this.sessions.get(id) !== session) return;
      if (!this._valid(id, session) || !this.visibility()) {
        await this._halt(
          id,
          this.visibility() ? 'stopped' : 'paused-hidden',
          !this.visibility(),
        );
        return;
      }
      const token = session.token;
      const currentLease = () =>
        this._valid(id, session) &&
        this.visibility() &&
        token !== null &&
        session.token === token;
      try {
        await this.repository.renew(id, this.ownerId, token, this.now());
        if (currentLease()) this._heartbeat(id, session);
      } catch {
        if (currentLease())
          await this._halt(
            id,
            'paused-errors',
            false,
            t(
              'Monitoring ownership expired. Start again to establish a new baseline.',
            ),
          );
      }
    }, WATCH_LIMITS.heartbeatMs);
  }
  _schedule(id, session) {
    if (!this._valid(id, session) || !session.token || !this.visibility())
      return;
    session.timer = this.timers.setTimeout(
      () => {
        session.timer = null;
        void this._tick(id, session);
      },
      Math.max(
        0,
        (this.records.get(id)?.runtime.nextAllowedAt || this.now()) -
          this.now(),
      ),
    );
  }
  async _tick(id, session) {
    if (!this._valid(id, session)) return;
    if (!this.visibility()) {
      await this._halt(id, 'paused-hidden', true);
      return;
    }
    const old = this.records.get(id);
    if (!old) return;
    if (old.runtime.nextAllowedAt > this.now()) {
      this._schedule(id, session);
      return;
    }
    session.state = 'checking';
    session.reason = null;
    session.request = new AbortController();
    const signal = session.request.signal;
    const started = this.now(),
      interval = old.definition.intervalMs;
    const gap =
      old.runtime.lastAttemptAt !== null &&
      started - old.runtime.lastAttemptAt > interval * 2;
    this.present();
    let pause = null;
    try {
      let record = await this.repository.get(id);
      if (signal.aborted || !this._valid(id, session)) return;
      record = await this.repository.commit(
        id,
        this.ownerId,
        session.token,
        {
          ...record.runtime,
          lastAttemptAt: started,
          nextAllowedAt: started + interval,
        },
        started,
      );
      if (signal.aborted || !this._valid(id, session)) return;
      this.records.set(id, record);
      const scene = watchKind(record.definition) === SCENE_WATCH_KIND;
      const checked = await this._check(record, {
        signal,
        baseline: session.baselinePending || gap,
        interval,
      });
      if (signal.aborted || !this._valid(id, session)) return;
      const { result } = checked;
      let runtime = checked.runtime;
      if (runtime.lastSuccessAt === record.runtime.lastSuccessAt) {
        runtime = {
          ...runtime,
          errorCount: Math.min(100, record.runtime.errorCount + 1),
        };
        session.reason = scene
          ? t(
              'The catalogues did not answer; scene availability is unknown. Previous summaries were retained.',
            )
          : t(
              'Fresh observations were unavailable; previous summaries were retained.',
            );
      }
      const retryAt = result.retryAt;
      if (Number.isFinite(retryAt) && retryAt > this.now())
        runtime = {
          ...runtime,
          nextAllowedAt: Math.max(
            runtime.nextAllowedAt,
            Math.min(this.now() + 86400000, retryAt),
          ),
        };
      record = await this.repository.commit(
        id,
        this.ownerId,
        session.token,
        runtime,
        this.now(),
      );
      if (signal.aborted || !this._valid(id, session)) return;
      this.records.set(id, record);
      if (runtime.lastSuccessAt !== old.runtime.lastSuccessAt)
        session.baselinePending = false;
      if (checked.needsKey) pause = 'needs-key';
      else if (runtime.errorCount >= 3) pause = 'paused-errors';
      session.state = runtime.errorCount ? 'paused-cooldown' : 'running';
    } catch {
      if (signal.aborted || !this._valid(id, session)) return;
      const record = this.records.get(id),
        runtime = {
          ...record.runtime,
          lastAttemptAt: started,
          nextAllowedAt: this.now() + interval,
          errorCount: Math.min(100, record.runtime.errorCount + 1),
          coverage: 'unavailable',
        };
      try {
        const saved = await this.repository.commit(
          id,
          this.ownerId,
          session.token,
          runtime,
          this.now(),
        );
        if (!signal.aborted && this._valid(id, session))
          this.records.set(id, saved);
      } catch {
        pause = 'paused-errors';
      }
      if (runtime.errorCount >= 3) pause = 'paused-errors';
      session.state = 'paused-cooldown';
      session.reason = t(
        'The check failed. Monitoring is cooling down before retrying.',
      );
    } finally {
      if (this.sessions.get(id) === session) {
        session.request = null;
        if (session.wanted) {
          if (pause)
            await this._halt(
              id,
              pause,
              false,
              pause !== 'needs-key'
                ? t(
                    'Monitoring paused after repeated errors. Start again when the source is available.',
                  )
                : this.records.get(id)?.definition.condition
                  ? t('OpenAQ needs its saved API key. Monitoring is stopped.')
                  : t('FIRMS needs its saved API key. Monitoring is stopped.'),
            );
          else this._schedule(id, session);
        }
        this.present();
      }
    }
  }
  stop(id) {
    return this._halt(id);
  }
  /** Hand a fired scene to Chronicle; the composition decides how it opens. */
  async openScene(id, observationId) {
    if (!this.live() || !this.onOpenScene) return false;
    const record = this.records.get(id);
    if (watchKind(record?.definition) !== SCENE_WATCH_KIND) return false;
    const observation = record.runtime.notifications
      .flatMap((note) => note.observations)
      .find((row) => row.id === observationId);
    if (!observation) return false;
    const result = await this.onOpenScene({
      place: record.definition.place,
      observation,
    });
    if (!this.live()) return false;
    this.feedback = result?.ok
      ? t('The scene opened in Chronicle beside the previous scene.')
      : result?.message ||
        t('The scene could not be opened in Chronicle. Try again later.');
    this.present();
    return Boolean(result?.ok);
  }
  async _visibilityChanged() {
    if (!this.live()) return;
    for (const [id, session] of [...this.sessions])
      if (session.wanted) {
        if (!this.visibility())
          await this._halt(
            id,
            'paused-hidden',
            true,
            t('Monitoring pauses while this app is hidden.'),
          );
        else if (session.state === 'paused-hidden') await this.start(id);
      }
    this.present();
  }
  async remove(id) {
    if (!this.live() || this.busy) return false;
    this.busy = true;
    try {
      await this.stop(id);
      await this.repository.remove(id);
      this.records.delete(id);
      this.sessions.delete(id);
      return true;
    } catch {
      this.error = t(
        'The watchlist could not be removed. Another tab may be monitoring it.',
      );
      return false;
    } finally {
      this.busy = false;
      this.present();
    }
  }
  async clearNotifications(id) {
    if (!this.live()) return false;
    try {
      const record = await this.repository.clearNotifications(id);
      if (this.live()) this.records.set(id, record);
      this.present();
      return true;
    } catch {
      this.error = t('Local summaries could not be cleared.');
      this.present();
      return false;
    }
  }
  async destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.offVisibility?.();
    this.offPlaces?.();
    const releases = [...this.sessions.keys()].map((id) => this._halt(id));
    this.store?.detach(this.owner);
    await Promise.all(releases);
    this.repository.close();
  }
}
