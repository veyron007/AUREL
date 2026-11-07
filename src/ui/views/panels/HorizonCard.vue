<script setup>
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { t } from '../../../i18n/index.js';
import { useHorizonStore } from '../../stores/horizon.js';

const props = defineProps({ surface: { type: String, default: 'lens' } });
const horizon = useHorizonStore();
const { view } = storeToRefs(horizon);
/** Today in the default zone, local noon for the shadow, 1.7 m eye, 1 m gnomon. */
const form = ref({
  localDate: new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
  }).format(new Date()),
  shadowTime: '12:00',
  timeZone: 'Asia/Kolkata',
  observerHeightM: 1.7,
  gnomonM: 1,
});
const id = (name) => `horizon-${props.surface}-${name}`;
const env = computed(() => view.value?.envelope ?? null);
const zone = computed(() => env.value?.query.timeZone ?? form.value.timeZone);
const unknown = () => t('Unknown');
const clock = (value) =>
  value
    ? new Date(value).toLocaleTimeString(undefined, {
        timeZone: zone.value,
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      })
    : unknown();
const degrees = (q) =>
  q?.value == null ? unknown() : t('{value}°', { value: q.value });
const metres = (q) =>
  q?.value == null
    ? unknown()
    : t('{value} m', { value: q.value.toLocaleString() });
const km = (q) =>
  q?.value == null ? unknown() : t('{value} km', { value: q.value });
const sunDelay = computed(() => {
  const a = env.value?.sun.astronomicalRise.value,
    b = env.value?.sun.terrainRise.value;
  return a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 60000) : null;
});
const directSun = computed(() => {
  const total = env.value?.sun.directSunMinutes.value;
  return total == null
    ? unknown()
    : t('{hours} h {minutes} min', {
        hours: Math.floor(total / 60),
        minutes: total % 60,
      });
});
const stateLabel = (state) =>
  ({
    skyline: t('On the skyline'),
    visible: t('Below farther terrain'),
    marginal: t('Marginal'),
  })[state] ?? state;
const hiddenCount = computed(
  () =>
    (env.value?.peaks.counts.hidden ?? 0) +
    (env.value?.peaks.counts.unknown ?? 0),
);
const demSource = computed(() =>
  env.value?.sources.find((source) => source.id === 'copernicus-glo30'),
);
const peakSource = computed(() =>
  env.value?.sources.find((source) => source.id === 'osm-peaks'),
);
/** Unrolled skyline: x is azimuth 0–360°, y the apparent elevation. */
const chart = computed(() => {
  const values = env.value?.horizon.elevationDeg.value ?? [];
  const finite = values.filter((value) => value !== null);
  if (!finite.length) return null;
  const low = Math.min(0, ...finite),
    high = Math.max(1, ...finite);
  const y = (value) => 76 - ((value - low) / (high - low)) * 68;
  const points = values
    .map((value, az) =>
      value === null ? null : `${az},${y(value).toFixed(2)}`,
    )
    .filter(Boolean)
    .join(' ');
  const peaks = (env.value?.peaks.listed ?? [])
    .filter((peak) => peak.state === 'skyline')
    .slice(0, 8)
    .map((peak) => ({
      id: peak.id,
      x: peak.azimuthDeg.value,
      y: y(peak.apparentElevationDeg.value),
    }));
  return { points, zero: y(0), peaks, high: Math.round(high * 10) / 10 };
});
function analyze() {
  horizon.act('analyze', { ...form.value });
}
</script>

<template>
  <section
    class="horizon-card"
    :aria-labelledby="id('title')"
    :aria-busy="Boolean(view?.busy)"
  >
    <header class="horizon-heading">
      <h3 :id="id('title')">{{ t('Kshitij horizon') }}</h3>
      <span class="horizon-badge">{{
        t('Geometric visibility, terrain-only')
      }}</span>
    </header>
    <p v-if="!view?.hasPlace" class="horizon-help">{{
      t('Select a place in Lens to compute its terrain horizon.')
    }}</p>
    <form
      v-else
      :id="id('form')"
      class="horizon-form"
      @submit.prevent="analyze"
    >
      <p class="horizon-help"
        >{{ view.place.name }} · {{ view.place.lat.toFixed(5) }}°,
        {{ view.place.lon.toFixed(5) }}°</p
      >
      <div class="horizon-fields">
        <label :for="id('date')"
          >{{ t('Date')
          }}<input
            :id="id('date')"
            v-model="form.localDate"
            type="date"
            required
        /></label>
        <label :for="id('time')"
          >{{ t('Shadow time')
          }}<input
            :id="id('time')"
            v-model="form.shadowTime"
            type="time"
            required
        /></label>
        <label :for="id('eye')"
          >{{ t('Eye height above the DEM surface (m)')
          }}<input
            :id="id('eye')"
            v-model.number="form.observerHeightM"
            type="number"
            min="0"
            max="500"
            step="0.1"
            required
        /></label>
        <label :for="id('gnomon')"
          >{{ t('Gnomon height (m)')
          }}<input
            :id="id('gnomon')"
            v-model.number="form.gnomonM"
            type="number"
            min="0.1"
            max="100"
            step="0.1"
            required
        /></label>
        <label :for="id('zone')"
          >{{ t('Time zone')
          }}<input
            :id="id('zone')"
            v-model="form.timeZone"
            type="text"
            autocomplete="off"
            spellcheck="false"
            required
        /></label>
      </div>
      <div class="horizon-actions">
        <button
          :id="id('compute')"
          type="submit"
          class="horizon-primary"
          :disabled="view.busy"
          >{{
            view.busy ? t('Computing horizon…') : t('Compute horizon')
          }}</button
        >
        <button
          v-if="view.busy"
          type="button"
          @click="horizon.act('cancel')"
          >{{ t('Cancel') }}</button
        >
        <button
          v-if="view.canSave"
          :id="id('save')"
          type="button"
          @click="horizon.act('save')"
          >{{ t('Save horizon to Fieldbook') }}</button
        >
      </div>
      <p class="horizon-help">{{
        t(
          'The first horizon for an area reads about 30 MB of Copernicus DEM tiles; later ones use the local cache.',
        )
      }}</p>
    </form>
    <p
      v-if="view?.error"
      class="horizon-notice horizon-notice--error"
      role="alert"
      >{{ view.error }}</p
    >
    <p v-if="view?.feedback" class="horizon-notice" role="status">{{
      view.feedback
    }}</p>
    <template v-if="env">
      <p class="horizon-help">{{
        t('Observer: DEM surface {ground} plus {eye} m eye height.', {
          ground: metres(env.observer.groundM),
          eye: env.query.observerHeightM,
        })
      }}</p>
      <figure v-if="chart" class="horizon-chart">
        <svg
          viewBox="0 0 360 84"
          preserveAspectRatio="none"
          role="img"
          :aria-label="
            t(
              'Terrain skyline from north through east, south and west; highest point {value}°.',
              { value: chart.high },
            )
          "
        >
          <line
            x1="0"
            x2="360"
            :y1="chart.zero"
            :y2="chart.zero"
            class="horizon-chart-zero"
          />
          <polyline :points="chart.points" class="horizon-chart-line" />
          <circle
            v-for="peak in chart.peaks"
            :key="peak.id"
            :cx="peak.x"
            :cy="peak.y"
            r="2.2"
            class="horizon-chart-peak"
          />
        </svg>
        <figcaption class="horizon-axis" aria-hidden="true"
          ><span>0°</span><span>90°</span><span>180°</span><span>270°</span
          ><span>360°</span></figcaption
        >
      </figure>

      <section class="horizon-block" :aria-labelledby="id('sun')">
        <h4 :id="id('sun')">{{ t('Sunrise and sunset') }}</h4>
        <dl class="horizon-metrics">
          <div
            ><dt>{{ t('Astronomical sunrise (flat horizon)') }}</dt
            ><dd>{{ clock(env.sun.astronomicalRise.value) }}</dd></div
          >
          <div
            ><dt>{{ t('Sun clears the terrain') }}</dt
            ><dd
              >{{ clock(env.sun.terrainRise.value)
              }}<span v-if="sunDelay !== null" class="horizon-delta">
                · {{ t('{minutes} min later', { minutes: sunDelay }) }}</span
              ></dd
            ></div
          >
          <div
            ><dt>{{ t('Astronomical sunset (flat horizon)') }}</dt
            ><dd>{{ clock(env.sun.astronomicalSet.value) }}</dd></div
          >
          <div
            ><dt>{{ t('Sun drops behind the terrain') }}</dt
            ><dd>{{ clock(env.sun.terrainSet.value) }}</dd></div
          >
          <div
            ><dt>{{ t('Direct sun on this date') }}</dt
            ><dd>{{ directSun }}</dd></div
          >
          <div
            ><dt>{{ t('Moonrise, flat horizon / over terrain') }}</dt
            ><dd>{{
              env.moon.astronomicalRise.value
                ? `${clock(env.moon.astronomicalRise.value)} / ${clock(env.moon.terrainRise.value)}`
                : t('No moonrise on this date')
            }}</dd></div
          >
        </dl>
      </section>

      <section
        v-if="env.shadow"
        class="horizon-block"
        :aria-labelledby="id('shadow')"
      >
        <h4 :id="id('shadow')">{{
          t('Shadow at {time}', { time: clock(env.shadow.at) })
        }}</h4>
        <dl class="horizon-metrics">
          <div
            ><dt>{{ t('Sun elevation') }}</dt
            ><dd>{{ degrees(env.shadow.sunAltitudeDeg) }}</dd></div
          >
          <div
            ><dt>{{ t('Sun azimuth') }}</dt
            ><dd>{{ degrees(env.shadow.sunAzimuthDeg) }}</dd></div
          >
          <div
            ><dt>{{ t('Terrain') }}</dt
            ><dd>{{
              env.shadow.sunlit
                ? t('Sun above the terrain horizon')
                : t('In terrain shadow')
            }}</dd></div
          >
          <div
            ><dt>{{
              t('Shadow of a {height} m gnomon', {
                height: env.shadow.gnomonM.value,
              })
            }}</dt
            ><dd>{{
              env.shadow.shadowLengthM.value == null
                ? t('No measurable shadow')
                : `${metres(env.shadow.shadowLengthM)} · ${degrees(env.shadow.shadowAzimuthDeg)}`
            }}</dd></div
          >
        </dl>
        <p class="horizon-help">{{
          t(
            'Time source: the date and time entered on this device. Buildings and slopes are ignored.',
          )
        }}</p>
      </section>

      <section class="horizon-block" :aria-labelledby="id('peaks')">
        <h4 :id="id('peaks')">{{ t('Peaks on the horizon') }}</h4>
        <p v-if="!env.peaks.listed.length" class="horizon-help">{{
          peakSource
            ? t('No named peak clears the nearer terrain here.')
            : t('No peak gazetteer covers this place.')
        }}</p>
        <ol v-else class="horizon-peaks">
          <li
            v-for="peak in env.peaks.listed"
            :key="peak.id"
            :data-state="peak.state"
          >
            <strong
              >{{ peak.name
              }}<span v-if="peak.nameHi" lang="hi">
                · {{ peak.nameHi }}</span
              ></strong
            >
            <span class="horizon-peak-state">{{
              stateLabel(peak.state)
            }}</span>
            <span>{{
              t('az {azimuth} · {distance} · elevation {angle}', {
                azimuth: degrees(peak.azimuthDeg),
                distance: km(peak.distanceKm),
                angle: degrees(peak.apparentElevationDeg),
              })
            }}</span>
            <span class="horizon-help">{{
              t('DEM {dem} · OSM ele {osm}', {
                dem: metres(peak.demHeightM),
                osm: metres(peak.osmEleM),
              })
            }}</span>
          </li>
        </ol>
        <p v-if="hiddenCount" class="horizon-help">{{
          t('{count} more named peaks in range are hidden by nearer terrain.', {
            count: hiddenCount,
          })
        }}</p>
      </section>

      <section
        class="horizon-block horizon-sources"
        :aria-labelledby="id('sources')"
      >
        <h4 :id="id('sources')">{{ t('Sources and method') }}</h4>
        <dl class="horizon-metrics">
          <div
            ><dt>{{ t('DEM') }}</dt><dd>{{ demSource?.label }}</dd></div
          >
          <div
            ><dt>{{ t('DEM void samples') }}</dt
            ><dd>{{ env.dem.voidSamples.value.toLocaleString() }}</dd></div
          >
          <div
            ><dt>{{ t('Absent DEM tiles (read as sea level)') }}</dt
            ><dd>{{ env.dem.absentTiles.length }}</dd></div
          >
          <div
            ><dt>{{ t('Refraction coefficient') }}</dt
            ><dd>k = {{ env.refractionK }}</dd></div
          >
          <div
            ><dt>{{ t('Radius') }}</dt
            ><dd>{{ t('{value} km', { value: env.dem.radiusKm }) }}</dd></div
          >
          <div
            ><dt>{{ t('Applicable time') }}</dt
            ><dd>{{ demSource?.applicableTime }}</dd></div
          >
        </dl>
        <p class="horizon-help">{{ demSource?.attribution }}</p>
        <p v-if="peakSource" class="horizon-help"
          >{{ peakSource.label }} · {{ peakSource.attribution }} ·
          {{ peakSource.license }}</p
        >
        <p class="horizon-help">{{
          t(
            'Sun and Moon positions are computed on this device. Trees, buildings, haze and cloud are not modelled; DEM voids and refraction can move these times by a few minutes.',
          )
        }}</p>
      </section>
    </template>
  </section>
</template>
