<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { t } from '../../../i18n/index.js';
import { usePlannerStore } from '../../stores/planner.js';
import RailPanel from '../../rail/RailPanel.vue';
import HorizonCard from './HorizonCard.vue';

const planner = usePlannerStore();
const { view } = storeToRefs(planner);
const departure = ref('');
const timeZone = ref('Asia/Kolkata');
const snapshot = computed(() => view.value?.snapshot);
const settingsOpen = ref(true);
const resultStart = ref(null);
const statusLabel = computed(
  () =>
    ({
      empty: t('Ready to plan'),
      loading: t('Gathering context'),
      ready: t('Snapshot ready'),
      partial: t('Some context is missing'),
      stale: t('Saved context may be out of date'),
      error: t('Analysis unavailable'),
    })[view.value?.status] ?? t('Ready to plan'),
);
const stamp = (value) =>
  value == null
    ? t('Unknown')
    : new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
const meters = (value) =>
  value == null
    ? t('Unknown')
    : t('{value} m', { value: Math.round(value).toLocaleString() });
const distance = (value) =>
  value == null
    ? t('Unknown')
    : t('{value} km', { value: (value / 1000).toFixed(1) });
const duration = (value) =>
  value == null
    ? t('Unknown')
    : t('{value} min', { value: Math.round(value / 60) });
const sampleIndex = ref(0);
watch(
  () => snapshot.value,
  () => {
    sampleIndex.value = 0;
    settingsOpen.value = !snapshot.value;
  },
);
const profile = computed(() => snapshot.value?.profile);
const samples = computed(() => profile.value?.samples ?? []);
const selectedSample = computed(() => samples.value[sampleIndex.value]);
const profileSegments = computed(() => {
  const heights = samples.value
    .map((sample) => sample.elevationM)
    .filter(Number.isFinite);
  if (!heights.length) return [];
  const bottom = Math.min(...heights);
  const range = Math.max(...heights) - bottom || 1;
  const length = samples.value.at(-1)?.distanceM || 1;
  const segments = [];
  let current = [];
  for (const sample of samples.value) {
    if (!Number.isFinite(sample.elevationM)) {
      if (current.length) segments.push(current);
      current = [];
      continue;
    }
    current.push({
      x: 12 + (sample.distanceM / length) * 276,
      y: 108 - ((sample.elevationM - bottom) / range) * 96,
    });
  }
  if (current.length) segments.push(current);
  return segments;
});
const profilePoints = (segment) =>
  segment.map((point) => `${point.x},${point.y}`).join(' ');
const polarLabel = (value) =>
  ({
    'polar-day': t('The sun stays above the horizon on this date.'),
    'polar-night': t('The sun stays below the horizon on this date.'),
    transition: t('Sunrise or sunset is unavailable for this transition date.'),
  })[value] ?? '';
function focusSample(index) {
  sampleIndex.value = Number(index);
  planner.act('focusSample', sampleIndex.value);
}
const sourceState = (value) =>
  ({
    ready: t('Available'),
    stale: t('Stale'),
    blocked: t('Blocked'),
    unavailable: t('Unavailable'),
  })[value] ?? t('Unknown');
const checkpointSources = (checkpoint) => [
  {
    key: 'weather',
    label: t('Weather'),
    source: checkpoint.context?.weather,
    metrics: [
      ['temperatureC', t('Temperature')],
      ['precipitationMm', t('Precipitation')],
      ['precipitationProbabilityPct', t('Precipitation probability')],
      ['windSpeedMps', t('Wind speed')],
      ['windGustMps', t('Wind gusts')],
    ],
  },
  {
    key: 'airQuality',
    label: t('Air quality'),
    source: checkpoint.context?.airQuality,
    metrics: [
      ['pm25', t('PM2.5')],
      ['pm10', t('PM10')],
      ['usAqi', t('US AQI')],
    ],
  },
];
function forecastHour(source) {
  const target = Date.parse(snapshot.value?.departureAt);
  return source?.hours?.find(
    (hour) =>
      Date.parse(hour.time) <= target &&
      target < Date.parse(hour.time) + 3600000,
  );
}
function metric(source, key) {
  const value = forecastHour(source)?.[key];
  return value == null
    ? t('Unknown')
    : `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${source.units?.[key] ?? ''}`.trim();
}
const fireState = (value) =>
  ({
    ok: t('Available'),
    partial: t('Partial'),
    stale: t('Stale'),
    unavailable: t('Unavailable'),
    'needs-key': t('Saved key required'),
  })[value] ?? t('Unavailable');
async function analyze() {
  const previous = snapshot.value;
  const completed = await planner.act('analyze', {
    localDateTime: departure.value,
    timeZone: timeZone.value.trim(),
  });
  if (!completed || !snapshot.value || snapshot.value === previous) return;
  await nextTick();
  const target = resultStart.value;
  const scroller = target?.closest('.planner-panel-inner');
  if (!scroller) return;
  // A hidden mobile header has zero height; desktop results clear the sticky title.
  const headerHeight =
    scroller.querySelector('.ui-panel__head')?.getBoundingClientRect().height ??
    0;
  const reducedMotion = window.matchMedia?.(
    '(prefers-reduced-motion: reduce)',
  ).matches;
  scroller.scrollTo?.({
    top: Math.max(
      0,
      scroller.scrollTop +
        target.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        headerHeight -
        12,
    ),
    behavior: reducedMotion ? 'auto' : 'smooth',
  });
}
</script>

<template>
  <RailPanel
    id="planner-panel"
    start-collapsed
    :title="t('Planner')"
    :hint="t('Terrain, daylight and forecast context for a place or route')"
    scroll
  >
    <div class="planner-workspace" :aria-busy="Boolean(view?.busy)">
      <header v-if="!snapshot" class="planner-intro"
        ><h2>{{ t('Before you go') }}</h2
        ><p>{{
          t(
            'Use the selected place or the current route. Analysis runs only when you request it.',
          )
        }}</p></header
      >
      <details
        id="planner-settings"
        class="planner-settings"
        :open="settingsOpen"
        @toggle="settingsOpen = $event.target.open"
        ><summary>{{
          snapshot ? t('Edit plan and reanalyze') : t('Planning settings')
        }}</summary>
        <form id="planner-form" @submit.prevent="analyze">
          <fieldset class="planner-scope"
            ><legend>{{ t('Plan for') }}</legend
            ><label for="planner-scope-place"
              ><input
                id="planner-scope-place"
                type="radio"
                name="planner-scope"
                value="place"
                :checked="(view?.scope ?? 'place') === 'place'"
                :disabled="view?.busy || view?.hasPlace === false"
                @change="planner.act('setScope', 'place')"
              />{{ t('Selected place') }}</label
            ><label for="planner-scope-route"
              ><input
                id="planner-scope-route"
                type="radio"
                name="planner-scope"
                value="route"
                :checked="view?.scope === 'route'"
                :disabled="view?.busy || view?.hasRoute === false"
                @change="planner.act('setScope', 'route')"
              />{{ t('Current route') }}</label
            ></fieldset
          >
          <p
            v-if="view?.scope === 'route' && view?.routeSummary"
            class="planner-route-summary"
            >{{ view.routeSummary.mode }} ·
            {{ distance(view.routeSummary.distanceM) }}<br />{{
              view.routeSummary.from.lat.toFixed(4)
            }}°, {{ view.routeSummary.from.lon.toFixed(4) }}° →
            {{ view.routeSummary.to.lat.toFixed(4) }}°,
            {{ view.routeSummary.to.lon.toFixed(4) }}°</p
          >
          <label for="planner-departure">{{
            t('Departure · local date and time')
          }}</label>
          <input
            id="planner-departure"
            v-model="departure"
            type="datetime-local"
            required
            :disabled="view?.busy"
          />
          <label for="planner-timezone">{{ t('Time zone') }}</label>
          <input
            id="planner-timezone"
            v-model="timeZone"
            type="text"
            required
            autocomplete="off"
            spellcheck="false"
            :disabled="view?.busy"
            aria-describedby="planner-timezone-help"
          />
          <p id="planner-timezone-help" class="planner-help">{{
            t(
              'Use an IANA time zone, such as Asia/Kolkata. All source times below are shown in UTC.',
            )
          }}</p>
        </form>
      </details>
      <div ref="resultStart" class="planner-actions planner-result-actions"
        ><button
          id="planner-analyze"
          type="submit"
          form="planner-form"
          class="planner-primary"
          :disabled="
            !view ||
            view.busy ||
            (view.scope === 'route'
              ? view.hasRoute === false
              : view.hasPlace === false)
          "
          >{{ t('Analyze') }}</button
        ><button
          v-if="view?.busy && view?.status === 'loading'"
          id="planner-cancel"
          type="button"
          @click="planner.act('cancel')"
          >{{ t('Cancel') }}</button
        ><button
          id="planner-save"
          type="button"
          :disabled="!view?.canSave || view?.busy"
          @click="planner.act('save')"
          >{{ t('Save snapshot') }}</button
        ></div
      >
      <p
        class="planner-state"
        role="status"
        v-bind="{ 'data-status': view?.status }"
        >{{ statusLabel }}</p
      >
      <p
        v-if="view?.error"
        class="planner-notice planner-notice--error"
        role="alert"
        >{{ view.error }}</p
      >
      <p v-if="view?.feedback" class="planner-notice" role="status">{{
        view.feedback
      }}</p>
      <div v-if="!snapshot" class="planner-empty"
        ><span aria-hidden="true">↗</span
        ><p>{{
          t(
            'Select a place in Lens, or prepare a route in Directions, then choose a departure time.',
          )
        }}</p></div
      >
      <template v-else>
        <section
          class="planner-section planner-summary"
          :aria-label="t('Analysis snapshot')"
        >
          <h3>{{ snapshot.route?.name || t('Selected place') }}</h3
          ><p class="planner-help"
            >{{ t('Captured') }} {{ stamp(snapshot.capturedAt) }}</p
          >
          <dl class="planner-metrics"
            ><div
              ><dt>{{ t('Distance') }}</dt
              ><dd>{{ distance(snapshot.route?.distanceM) }}</dd></div
            ><div
              ><dt>{{ t('Estimated travel time') }}</dt
              ><dd>{{ duration(snapshot.route?.durationS) }}</dd></div
            ><div
              ><dt>{{ t('Departure (UTC)') }}</dt
              ><dd>{{ stamp(snapshot.departureAt) }}</dd></div
            ><div
              ><dt>{{ t('Time zone') }}</dt
              ><dd>{{ snapshot.timeZone }}</dd></div
            ></dl
          >
          <p class="planner-help">{{
            t(
              'Route estimates do not confirm that a road or trail is open or safe.',
            )
          }}</p>
        </section>
        <section
          class="planner-section planner-profile"
          :aria-label="t('Terrain profile')"
        >
          <div class="planner-section-heading"
            ><h3>{{ t('Terrain profile') }}</h3
            ><span class="planner-tag">{{ t('Modelled terrain') }}</span></div
          >
          <p v-if="!profile" class="planner-help">{{
            t('No terrain profile is available for this snapshot.')
          }}</p>
          <template v-else>
            <svg
              class="planner-profile-chart"
              viewBox="0 0 300 120"
              role="img"
              :aria-label="
                t('Elevation profile with gaps where height is unknown')
              "
            >
              <path d="M12 12V108H288" class="planner-profile-axis" />
              <template
                v-for="(segment, index) in profileSegments"
                :key="index"
              >
                <polyline
                  v-if="segment.length > 1"
                  class="planner-profile-path"
                  :points="profilePoints(segment)"
                />
                <circle
                  v-else
                  class="planner-profile-point"
                  :cx="segment[0].x"
                  :cy="segment[0].y"
                  r="3"
                />
              </template>
            </svg>
            <p v-if="!profile.complete" class="planner-help">{{
              t(
                'Missing heights remain gaps. The profile does not interpolate them.',
              )
            }}</p>
            <div v-if="samples.length" class="planner-profile-cursor"
              ><label for="planner-sample">{{
                t('Inspect a terrain sample')
              }}</label
              ><input
                id="planner-sample"
                type="range"
                min="0"
                :max="samples.length - 1"
                :value="sampleIndex"
                @input="focusSample($event.target.value)"
                :aria-valuetext="`${distance(selectedSample?.distanceM)} · ${meters(selectedSample?.elevationM)}`"
              /><p aria-live="polite"
                >{{ distance(selectedSample?.distanceM) }} ·
                {{ meters(selectedSample?.elevationM) }}</p
              ></div
            >
            <dl class="planner-metrics"
              ><div
                ><dt>{{ t('Lowest sample') }}</dt
                ><dd>{{ meters(profile.minM) }}</dd></div
              ><div
                ><dt>{{ t('Highest sample') }}</dt
                ><dd>{{ meters(profile.maxM) }}</dd></div
              ><div
                ><dt>{{ t('Sample spacing') }}</dt
                ><dd>{{ meters(profile.sampleSpacingM) }}</dd></div
              ><div
                ><dt>{{ t('Native resolution') }}</dt
                ><dd>{{ meters(profile.resolutionM) }}</dd></div
              ></dl
            >
            <p class="planner-help">{{
              t('Sample spacing is not a vertical accuracy estimate.')
            }}</p>
            <details class="planner-details"
              ><summary>{{ t('Terrain samples and source') }}</summary
              ><p>{{ profile.sourceLabel }} · {{ profile.datum }}</p
              ><p class="planner-help"
                >{{ t('Retrieved') }} {{ stamp(profile.retrievedAt) }}</p
              ><p class="planner-help">{{ profile.attribution }}</p
              ><a
                v-if="profile.link"
                :href="profile.link"
                target="_blank"
                rel="noopener noreferrer"
                >{{ t('Open source') }}</a
              ><div class="planner-table-scroll"
                ><table class="planner-profile-table"
                  ><caption>{{
                    t(
                      'Saved terrain samples; unknown heights are not filled in',
                    )
                  }}</caption
                  ><thead
                    ><tr
                      ><th scope="col">{{ t('Distance') }}</th
                      ><th scope="col">{{ t('Elevation') }}</th
                      ><th scope="col">{{ t('Map') }}</th></tr
                    ></thead
                  ><tbody
                    ><tr v-for="(sample, index) in samples" :key="index"
                      ><td>{{ distance(sample.distanceM) }}</td
                      ><td>{{ meters(sample.elevationM) }}</td
                      ><td
                        ><button
                          type="button"
                          @click="focusSample(index)"
                          :aria-label="
                            t('Show terrain sample {number} on map', {
                              number: index + 1,
                            })
                          "
                          >{{ t('View') }}</button
                        ></td
                      ></tr
                    ></tbody
                  ></table
                ></div
              ></details
            >
          </template>
        </section>
        <section
          class="planner-section planner-daylight"
          :aria-label="t('Daylight')"
        >
          <div class="planner-section-heading"
            ><h3>{{ t('Daylight') }}</h3
            ><span class="planner-tag">{{ t('Calculated') }}</span></div
          >
          <p v-if="!snapshot.daylight" class="planner-help">{{
            t('Daylight calculation is unavailable.')
          }}</p>
          <template v-else
            ><p
              v-if="polarLabel(snapshot.daylight.polarState)"
              class="planner-help"
              >{{ polarLabel(snapshot.daylight.polarState) }}</p
            ><dl class="planner-metrics"
              ><div
                ><dt>{{ t('Sunrise (UTC)') }}</dt
                ><dd>{{ stamp(snapshot.daylight.sunrise) }}</dd></div
              ><div
                ><dt>{{ t('Sunset (UTC)') }}</dt
                ><dd>{{ stamp(snapshot.daylight.sunset) }}</dd></div
              ><div
                ><dt>{{ t('Civil dawn (UTC)') }}</dt
                ><dd>{{ stamp(snapshot.daylight.civilDawn) }}</dd></div
              ><div
                ><dt>{{ t('Civil dusk (UTC)') }}</dt
                ><dd>{{ stamp(snapshot.daylight.civilDusk) }}</dd></div
              ><div
                ><dt>{{ t('Daylight duration') }}</dt
                ><dd>{{ duration(snapshot.daylight.daylightSeconds) }}</dd></div
              ></dl
            ><p class="planner-help">{{ snapshot.daylight.method }}</p
            ><p class="planner-help">{{
              t('Nearby hills and buildings can obstruct the visible sun.')
            }}</p></template
          >
        </section>
        <section
          class="planner-section planner-checkpoints"
          :aria-label="t('Forecast checkpoints')"
        >
          <div class="planner-section-heading"
            ><h3>{{ t('Forecast checkpoints') }}</h3
            ><span class="planner-tag">{{ t('Model output') }}</span></div
          >
          <p class="planner-help">{{
            t(
              'Each checkpoint shows the forecast hour containing your departure, not an estimated arrival time.',
            )
          }}</p>
          <p v-if="!snapshot.checkpoints?.length" class="planner-help">{{
            t('No checkpoint forecasts are available.')
          }}</p>
          <article
            v-for="(checkpoint, index) in snapshot.checkpoints"
            :key="index"
            class="planner-checkpoint"
          >
            <header
              ><h4>{{ t('Checkpoint {number}', { number: index + 1 }) }}</h4
              ><p class="planner-coordinate"
                >{{ checkpoint.lat.toFixed(4) }}°,
                {{ checkpoint.lon.toFixed(4) }}° ·
                {{ distance(checkpoint.distanceM) }}</p
              ></header
            >
            <section
              v-for="entry in checkpointSources(checkpoint)"
              :key="entry.key"
              class="planner-source"
            >
              <div class="planner-section-heading"
                ><h5>{{ entry.label }}</h5
                ><span
                  class="planner-source-state"
                  :data-state="entry.source?.state"
                  >{{ sourceState(entry.source?.state) }}</span
                ></div
              >
              <p class="planner-help">{{
                entry.source?.sourceLabel || t('Unknown')
              }}</p>
              <p v-if="!forecastHour(entry.source)" class="planner-notice">{{
                t('No forecast value is available for this departure hour.')
              }}</p>
              <p v-else class="planner-validity"
                >{{ t('Forecast valid from') }}
                {{ stamp(forecastHour(entry.source).time) }}</p
              >
              <dl class="planner-metrics"
                ><div v-for="[key, label] in entry.metrics" :key="key"
                  ><dt>{{ label }}</dt
                  ><dd>{{ metric(entry.source, key) }}</dd></div
                ></dl
              >
              <p v-if="entry.key === 'airQuality'" class="planner-help">{{
                t('Modelled air quality; not a nearby station reading.')
              }}</p>
              <details class="planner-details"
                ><summary>{{ t('Source, timing and resolution') }}</summary
                ><dl class="planner-source-details"
                  ><dt>{{ t('Retrieved') }}</dt
                  ><dd>{{ stamp(entry.source?.retrievedAt) }}</dd
                  ><dt>{{ t('Issue time') }}</dt
                  ><dd>{{ stamp(entry.source?.issuedAt) }}</dd
                  ><dt>{{ t('Forecast window starts') }}</dt
                  ><dd>{{ stamp(entry.source?.validFrom) }}</dd
                  ><dt>{{ t('Forecast window ends (exclusive)') }}</dt
                  ><dd>{{ stamp(entry.source?.validTo) }}</dd
                  ><dt>{{ t('Native resolution') }}</dt
                  ><dd>{{ meters(entry.source?.resolutionM) }}</dd
                  ><dt>{{ t('Native model time step') }}</dt
                  ><dd>{{
                    duration(entry.source?.nativeTimeResolutionSeconds)
                  }}</dd
                  ><dt>{{ t('Returned time step') }}</dt
                  ><dd>{{ duration(entry.source?.timeResolutionSeconds) }}</dd
                  ><dt>{{ t('License') }}</dt
                  ><dd>{{ entry.source?.license || t('Unknown') }}</dd></dl
                ><p class="planner-help">{{ entry.source?.attribution }}</p
                ><a
                  v-if="entry.source?.link"
                  :href="entry.source.link"
                  target="_blank"
                  rel="noopener noreferrer"
                  >{{ t('Open source') }}</a
                ></details
              >
            </section>
          </article>
        </section>
        <section
          class="planner-section planner-fire-context"
          :aria-label="t('Thermal detections')"
        >
          <div class="planner-section-heading"
            ><h3>{{ t('Thermal detections') }}</h3
            ><span class="planner-tag">{{
              fireState(snapshot.fireContext?.status)
            }}</span></div
          >
          <p class="planner-help">{{
            t(
              'Satellite thermal detections are not road closures or fire perimeters.',
            )
          }}</p>
          <p
            v-if="
              !snapshot.fireContext ||
              ['unavailable', 'needs-key'].includes(snapshot.fireContext.status)
            "
            class="planner-help"
            >{{
              t('No thermal detection context is available in this snapshot.')
            }}</p
          >
          <template v-if="snapshot.fireContext">
            <p>{{ snapshot.fireContext.source }}</p>
            <p
              v-if="
                snapshot.fireContext.status === 'ok' &&
                snapshot.fireContext.count === 0
              "
              class="planner-help"
              >{{
                t(
                  'No detections were returned for this area and time window. Missing detections do not establish safety.',
                )
              }}</p
            >
            <p
              v-else-if="
                ['ok', 'partial', 'stale'].includes(snapshot.fireContext.status)
              "
              >{{
                t('{count} detections retained from {total} matches', {
                  count: snapshot.fireContext.count,
                  total: snapshot.fireContext.matchedCount,
                })
              }}</p
            >
            <p v-if="snapshot.fireContext.truncated" class="planner-help">{{
              t(
                'The source response was truncated. This snapshot does not contain every matching detection.',
              )
            }}</p>
            <details class="planner-details"
              ><summary>{{ t('Detection window and observations') }}</summary
              ><dl class="planner-source-details"
                ><dt>{{ t('Window starts') }}</dt
                ><dd>{{ stamp(snapshot.fireContext.window.start) }}</dd
                ><dt>{{ t('Window ends') }}</dt
                ><dd>{{ stamp(snapshot.fireContext.window.end) }}</dd
                ><dt>{{ t('Retrieved') }}</dt
                ><dd>{{ stamp(snapshot.fireContext.fetchedAt) }}</dd
                ><dt>{{ t('Area bounds') }}</dt
                ><dd
                  >{{ snapshot.fireContext.bounds.west }}°,
                  {{ snapshot.fireContext.bounds.south }}° →
                  {{ snapshot.fireContext.bounds.east }}°,
                  {{ snapshot.fireContext.bounds.north }}°</dd
                ></dl
              ><p
                v-for="(limitation, index) in snapshot.fireContext.limitations"
                :key="index"
                class="planner-help"
                >{{ limitation }}</p
              ><p
                v-if="snapshot.fireContext.observations.length"
                class="planner-help"
                >{{
                  t('Showing first {count} saved detections.', {
                    count: Math.min(
                      10,
                      snapshot.fireContext.observations.length,
                    ),
                  })
                }}</p
              ><ul class="planner-detections"
                ><li
                  v-for="item in snapshot.fireContext.observations.slice(0, 10)"
                  :key="item.id"
                  ><strong>{{ item.sensor }} · {{ item.satellite }}</strong
                  ><span>{{ stamp(item.acquiredAt) }}</span
                  ><span
                    >{{ item.lat.toFixed(4) }}°,
                    {{ item.lon.toFixed(4) }}°</span
                  ></li
                ></ul
              ></details
            >
          </template>
        </section>
      </template>
      <HorizonCard v-if="view?.scope !== 'route'" surface="planner" />
    </div>
  </RailPanel>
</template>
