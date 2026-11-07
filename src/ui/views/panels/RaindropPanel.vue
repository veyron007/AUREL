<script setup>
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { t } from '../../../i18n/index.js';
import { useRaindropStore } from '../../stores/raindrop.js';
import RailPanel from '../../rail/RailPanel.vue';

const raindrop = useRaindropStore();
const { view } = storeToRefs(raindrop);
const threshold = ref(20);
const result = computed(() => view.value?.result);
const drop = computed(() => result.value?.drop);
const far = computed(() => result.value?.farField);
const cards = computed(() => view.value?.cards ?? {});
const utc = (value) =>
  value == null
    ? t('Unknown')
    : new Date(value).toISOString().slice(11, 16) + ' UTC';
const day = (value) =>
  value == null
    ? t('Unknown')
    : new Date(value).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const km = (value) =>
  t('{value} km', { value: Number(value).toFixed(value < 10 ? 1 : 0) });
const km2 = (value) =>
  t('{value} km²', {
    value: Number(value).toLocaleString(undefined, {
      maximumFractionDigits: value < 10 ? 2 : 0,
    }),
  });
const mm = (value) =>
  value === Infinity ? '∞' : Number(value).toFixed(value < 10 ? 1 : 0);
const range = (lo, hi) => t('{lo}–{hi} mm', { lo: mm(lo), hi: mm(hi) });
const pct = (value) => Math.round(value * 100);
const latency = (minutes) =>
  t('{hours} h {minutes} min', {
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60,
  });
const status = computed(
  () =>
    ({
      idle: t('Choose where the rain lands.'),
      picking: t('Click the globe where the rain lands. Esc cancels.'),
      running: t('Tracing the drop on the terrain…'),
      ready: '',
    })[view.value?.status] ?? '',
);
const errorText = computed(
  () =>
    ({
      'no-selection': t('Select a place with search or Lens first.'),
      'invalid-point': t('That point is outside valid coordinates.'),
      'offline-outside-pack': t(
        'Offline, Raindrop works only inside the bundled Doon terrain.',
      ),
      'terrain-incomplete': t(
        'Too much of the terrain window failed to load. Try again later.',
      ),
      'no-height': t('The terrain has no height at that point.'),
    })[view.value?.error] ??
    (view.value?.error ? t('The drop could not be traced.') : ''),
);
const ending = computed(() => {
  if (far.value?.status === 'ok')
    return far.value.end === 'ocean'
      ? t('Reaches the ocean outlet of the HydroRIVERS network.')
      : far.value.end === 'inland'
        ? t('Ends in an inland basin.')
        : t('Stops where the bundled river network ends.');
  if (far.value?.status === 'unavailable')
    return t(
      'Stops at the edge of the sampled terrain; the river network is not loaded.',
    );
  return t('Stops at the edge of the sampled terrain.');
});
const stateText = (card) =>
  ({
    loading: t('Reading…'),
    blocked: t(
      'Not requested: the local Open-Meteo budget refused it ({reason}).',
      { reason: card?.reason },
    ),
    unavailable:
      card?.reason === 'offline'
        ? t('Unavailable offline.')
        : t('Unavailable ({reason}).', { reason: card?.reason }),
    insufficient: t('Too few days in the returned series to rank today.'),
  })[card?.state] ?? '';
function addWatch() {
  raindrop.act('addWatch', Number(threshold.value));
}
</script>
<template>
  <RailPanel
    id="raindrop-panel"
    start-collapsed
    :title="t('Raindrop')"
    :hint="t('Where water goes, and what fell on it')"
    scroll
  >
    <div class="raindrop-workspace" :aria-busy="Boolean(view?.busy)">
      <header class="raindrop-intro"
        ><span class="raindrop-eyebrow">{{ t('Where water goes') }}</span
        ><h2>{{ t('Raindrop and catchment') }}</h2
        ><p>{{
          t(
            'Drop rain on the terrain, follow it downhill to the sea and see the land that drains past that point.',
          )
        }}</p></header
      >
      <div class="raindrop-actions"
        ><button
          id="raindrop-pick"
          type="button"
          class="raindrop-primary"
          :disabled="view?.busy || view?.picking"
          @click="raindrop.act('pick')"
          >{{ t('Drop on the globe') }}</button
        ><button
          id="raindrop-selection"
          type="button"
          :disabled="view?.busy || !view?.hasSelection"
          @click="raindrop.act('traceSelection')"
          >{{ t('Use selected place') }}</button
        ><button
          v-if="view?.busy || view?.picking"
          id="raindrop-cancel"
          type="button"
          @click="raindrop.act('cancel')"
          >{{ t('Cancel') }}</button
        ></div
      >
      <p v-if="status" class="raindrop-state" role="status">{{ status }}</p>
      <p v-if="errorText" class="raindrop-notice raindrop-notice--error" role="alert">{{
        errorText
      }}</p>
      <template v-if="drop">
        <section class="raindrop-section" :aria-label="t('Downhill path')"
          ><div class="raindrop-section-heading"
            ><h3>{{ t('Downhill path') }}</h3
            ><span class="raindrop-tag">{{ t('Simulated') }}</span></div
          ><p v-if="result.rivers.length" class="raindrop-rivers">{{
            result.rivers.join(' → ')
          }}</p
          ><p v-else class="raindrop-help">{{
            t('No named river is close enough to this path to label it.')
          }}</p
          ><p>{{ ending }}</p
          ><dl class="raindrop-facts"
            ><dt>{{ t('On the terrain grid') }}</dt
            ><dd>{{ km(drop.localLengthKm) }}</dd
            ><template v-if="far?.status === 'ok'"
              ><dt>{{ t('On HydroRIVERS') }}</dt
              ><dd>{{ km(far.lengthKm) }}</dd></template
            ></dl
          ><div class="raindrop-actions"
            ><button id="raindrop-replay" type="button" @click="raindrop.act('replay')">{{
              t('Replay drop')
            }}</button
            ><button id="raindrop-clear" type="button" @click="raindrop.act('clear')">{{
              t('Clear')
            }}</button></div
          ><p class="raindrop-help">{{
            t('The animation pace is illustrative, not travel time.')
          }}</p></section
        >
        <section class="raindrop-section" :aria-label="t('Catchment')"
          ><div class="raindrop-section-heading"
            ><h3>{{ t('Catchment') }}</h3
            ><span class="raindrop-tag">{{ t('Derived') }}</span></div
          ><p class="raindrop-figure">{{ km2(drop.catchment.areaKm2) }}</p
          ><p class="raindrop-help">{{
            t('Land on the terrain grid that drains past {lat}°, {lon}°.', {
              lat: drop.outlet[1].toFixed(4),
              lon: drop.outlet[0].toFixed(4),
            })
          }}</p
          ><p v-if="drop.outletMoved" class="raindrop-help">{{
            t('The outlet moved up to 250 m onto the strongest nearby flow line.')
          }}</p
          ><p v-if="drop.catchment.touchesEdge" class="raindrop-notice">{{
            t(
              'The catchment continues beyond the sampled terrain, so this area is a lower bound.',
            )
          }}</p
          ><p v-if="result.basin" class="raindrop-help">{{
            t('HydroBASINS level-12 unit {id}: {area} upstream (HydroSHEDS, derived).', {
              id: result.basin.id,
              area: km2(result.basin.upKm2),
            })
          }}</p></section
        >
        <details class="raindrop-method" open
          ><summary>{{ t('Method and limits') }}</summary
          ><dl class="raindrop-facts"
            ><dt>{{ t('Terrain') }}</dt
            ><dd>{{
              result.dem.kind === 'bundled'
                ? t('Bundled Doon grid from the Re:Earth / Mapterhorn mesh')
                : t('Live window from the Re:Earth / Mapterhorn mesh')
            }}</dd
            ><dt>{{ t('Grid') }}</dt
            ><dd>{{
              t('{step}″ cells, about {ew} m × {ns} m', {
                step: result.window.resolution.stepArcSec,
                ew: result.window.resolution.eastWestM,
                ns: result.window.resolution.northSouthM,
              })
            }}</dd
            ><dt>{{ t('Heights') }}</dt
            ><dd>{{
              t('Metres above the EGM96 geoid; the mesh is simplified, so detail is coarser on smooth ground.')
            }}</dd
            ><dt>{{ t('Routing') }}</dt
            ><dd>{{
              t('D8 steepest descent after Priority-Flood+ε depression filling.')
            }}</dd
            ><dt>{{ t('Sink filling') }}</dt
            ><dd>{{
              t('{cells} cells raised, at most {depth} m.', {
                cells: (result.disclosure?.raisedCells ?? 0).toLocaleString(),
                depth: (result.disclosure?.maxRaiseM ?? 0).toFixed(1),
              })
            }}</dd
            ><dt>{{ t('Ambiguity') }}</dt
            ><dd>{{
              t('{ambiguous} of {steps} steps on this path were ambiguous: flat ground or near-equal descents, common on the Doon fans.', {
                ambiguous: drop.ambiguousSteps,
                steps: drop.steps,
              })
            }}</dd
            ><dt>{{ t('Ignored') }}</dt
            ><dd>{{
              t('Culverts, storm drains, embankments, bridges and buildings are not in the terrain.')
            }}</dd
            ><dt>{{ t('Beyond the grid') }}</dt
            ><dd>{{
              t('HydroSHEDS HydroRIVERS v1.0 network; names from OpenStreetMap and a short curated list.')
            }}</dd></dl
          ><p class="raindrop-help">{{
            t('HydroSHEDS v1 © World Wildlife Fund, Inc. (2006-2022), used under license; WWF has not evaluated the data as altered here. Names © OpenStreetMap contributors.')
          }}</p></details
        >
        <section class="raindrop-card" :aria-label="t('Satellite rain estimate')"
          ><div class="raindrop-section-heading"
            ><h3>{{ t('Satellite rain estimate') }}</h3
            ><span class="raindrop-tag">{{ t('Derived') }}</span></div
          ><p v-if="stateText(cards.imerg)" class="raindrop-help" role="status">{{
            stateText(cards.imerg)
          }}</p
          ><template v-if="cards.imerg?.windows"
            ><dl class="raindrop-rain"
              ><div v-for="name in ['1h', '3h', '24h']" :key="name"
                ><dt>{{ t('Last {window}', { window: name.replace('h', ' h') }) }}</dt
                ><dd>{{
                  cards.imerg.windows[name].lo == null
                    ? t('No data')
                    : range(cards.imerg.windows[name].lo, cards.imerg.windows[name].hi)
                }}<small v-if="!cards.imerg.windows[name].complete">{{
                  t('{present} of {steps} half-hours', {
                    present: cards.imerg.windows[name].presentSteps,
                    steps: cards.imerg.windows[name].steps,
                  })
                }}</small></dd></div
              ></dl
            ><p class="raindrop-help">{{
              t('Basin mean to {time}, {latency} ago; {coverage}% of the basin area had data.', {
                time: day(Date.parse(cards.imerg.latest) + 1800000),
                latency: latency(cards.imerg.latencyMin),
                coverage: pct(cards.imerg.coverage * (cards.imerg.requestShare ?? 1)),
              })
            }}</p
            ><p class="raindrop-help">{{
              t('NASA GIBS IMERG half-hourly rate, read through its published colormap; each value is a class range. IMERG misses short mountain bursts and arrives hours late.')
            }}</p
            ><a
              href="https://gibs.earthdata.nasa.gov/legends/GPM_Precipitation_Rate_H.svg"
              target="_blank"
              rel="noopener noreferrer"
              >{{ t('IMERG colour legend') }}</a
            ></template
          ></section
        >
        <section class="raindrop-card" :aria-label="t('Forecast rain on this catchment')"
          ><div class="raindrop-section-heading"
            ><h3>{{ t('Forecast rain on this catchment') }}</h3
            ><span class="raindrop-tag">{{ t('Modelled') }}</span></div
          ><p v-if="stateText(cards.forecast)" class="raindrop-help" role="status">{{
            stateText(cards.forecast)
          }}</p
          ><template v-if="cards.forecast?.totals"
            ><dl class="raindrop-rain"
              ><div v-for="row in cards.forecast.totals" :key="row.hours"
                ><dt>{{ t('Next {hours} h', { hours: row.hours }) }}</dt
                ><dd>{{ t('{value} mm', { value: mm(row.totalMm) }) }}<small v-if="!row.complete">{{
                  t('partial')
                }}</small></dd></div
              ></dl
            ><p class="raindrop-help">{{
              t('Open-Meteo best-match forecast, retrieved {time}. Area-weighted points: {points}. Local daily Open-Meteo units used: {units}.', {
                points: cards.forecast.points,
                time: day(cards.forecast.retrievedAt),
                units: cards.forecast.unitsReserved,
              })
            }}</p></template
          ></section
        >
        <section class="raindrop-card" :aria-label="t('River model rank')"
          ><div class="raindrop-section-heading"
            ><h3>{{ t('River model rank') }}</h3
            ><span class="raindrop-tag">{{ t('Derived') }}</span></div
          ><button
            v-if="!cards.glofas || cards.glofas.state === 'unavailable'"
            id="raindrop-glofas"
            type="button"
            @click="raindrop.act('readGlofas')"
            >{{ t('Read GloFAS rank (uses 7 Open-Meteo units)') }}</button
          ><p v-if="stateText(cards.glofas)" class="raindrop-help" role="status">{{
            stateText(cards.glofas)
          }}</p
          ><template v-if="cards.glofas?.state === 'ready'"
            ><p class="raindrop-figure">{{
              t('Percentile {percentile}', { percentile: cards.glofas.percentile })
            }}</p
            ><p class="raindrop-help">{{
              t('Today, against the previous {n} days of GloFAS v4 at the 0.05° cell {lat}°, {lon}°, via the Open-Meteo Flood API.', {
                n: cards.glofas.n,
                lat: cards.glofas.cell.lat.toFixed(3),
                lon: cards.glofas.cell.lon.toFixed(3),
              })
            }}</p></template
          ><p class="raindrop-help">{{
            t('A rank inside the model’s own recent series: not a flow, a water level or a warning. GloFAS skill in small mountain basins is poor.')
          }}</p></section
        >
      </template>
      <p class="raindrop-authority"
        >{{ t('For warnings and river conditions, follow the authorities:') }}
        <a href="https://mausam.imd.gov.in/" target="_blank" rel="noopener noreferrer">{{
          t('India Meteorological Department')
        }}</a>
        ·
        <a href="https://ffs.india-water.gov.in/" target="_blank" rel="noopener noreferrer">{{
          t('Central Water Commission')
        }}</a></p
      >
      <section class="raindrop-section" :aria-label="t('Basin rain watch')"
        ><div class="raindrop-section-heading"
          ><h3>{{ t('Basin rain watch') }}</h3
          ><span class="raindrop-tag">{{ t('Local') }}</span></div
        ><form
          v-if="view?.canWatch"
          id="raindrop-watch-form"
          class="raindrop-watch-form"
          @submit.prevent="addWatch"
          ><label for="raindrop-threshold">{{
            t('Notify once when the IMERG 3 h basin mean exceeds (mm)')
          }}</label
          ><input
            id="raindrop-threshold"
            v-model="threshold"
            type="number"
            min="1"
            max="500"
            step="1"
            required
          /><button type="submit">{{ t('Watch this basin') }}</button></form
        ><p class="raindrop-help">{{
          t('Checks every 30 minutes while AUREL is open. A watch fires once per crossing, then waits for the mean to fall and a 6 h cooldown.')
        }}</p
        ><p v-if="view?.watchesPaused && view?.watches.length" class="raindrop-notice"
          >{{ t('Watch checks are paused.') }}
          <button id="raindrop-resume" type="button" @click="raindrop.act('resumeWatches')">{{
            t('Resume')
          }}</button></p
        ><ul class="raindrop-watches"
          ><li v-for="watch in view?.watches ?? []" :key="watch.id"
            ><div class="raindrop-watch-head"
              ><strong>{{ watch.label }}</strong
              ><span>{{ t('above {value} mm in 3 h', { value: watch.thresholdMm }) }}</span
              ><button type="button" :data-raindrop-remove="watch.id" @click="raindrop.act('removeWatch', watch.id)">{{
                t('Remove')
              }}</button></div
            ><p class="raindrop-help">{{
              watch.runtime.lastWindowEnd
                ? t('Last reading {range} to {time}.', {
                    range: range(watch.runtime.lastLoMm, watch.runtime.lastHiMm),
                    time: day(watch.runtime.lastWindowEnd),
                  })
                : t('Not checked yet.')
            }}</p
            ><p
              v-for="note in watch.runtime.notifications"
              :key="note.id"
              class="raindrop-fired"
              role="status"
              >{{
                t('Fired for the 3 h to {time}: {range}, above {threshold} mm.', {
                  time: day(note.windowEnd),
                  range: range(note.loMm, note.hiMm),
                  threshold: note.thresholdMm,
                })
              }}</p
            ></li
          ></ul
        ></section
      >
    </div>
  </RailPanel>
</template>
