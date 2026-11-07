<script setup>
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { t } from '../../../i18n/index.js';
import UiButton from '../../kit/UiButton.vue';
import { useBreathStore } from '../../stores/breath.js';

const breath = useBreathStore();
const { view } = storeToRefs(breath);
const watchPollutant = ref('pm25');
const watchCategory = ref('poor');

const stamp = (value) =>
  value == null
    ? t('Unknown')
    : new Date(value).toISOString().slice(0, 16).replace('T', ' ');
const number = (value) =>
  value == null ? '--' : String(Math.round(value * 10) / 10);
const categoryLabel = (label) => (label ? t(label) : t('Unknown'));
const subIndex = (row) => {
  if (row.state !== 'ok') return '--';
  return row.openEnded ? `${row.floor}+` : String(row.index);
};
const stationState = computed(() => {
  const tier = view.value?.stations;
  if (!tier) return null;
  const unavailable = t('Station readings are unavailable right now.');
  return (
    {
      'no-monitor': t(
        'No monitor within {value} km. This does not mean the air is clean.',
        { value: tier.radiusKm },
      ),
      'no-data': t(
        'Monitors nearby have reported nothing in the last 24 hours.',
      ),
      stale: t(
        'Readings are more than 3 hours old or come from an earlier retrieval.',
      ),
      partial: t('Some station readings could not be retrieved.'),
      'needs-key': t(
        'Add the free OpenAQ key in Provider Settings to see monitoring stations.',
      ),
      blocked: t(
        "Today's OpenAQ request budget is used up. Try again tomorrow.",
      ),
      'rate-limited': t('Rate limited'),
      unavailable,
      'invalid-response': unavailable,
    }[tier.state] ?? null
  );
});
const citizenState = computed(() => {
  const tier = view.value?.citizen;
  if (!tier) return null;
  const unavailable = t('Citizen readings are unavailable right now.');
  return (
    {
      'no-sensor': t('No citizen sensor within {value} km.', {
        value: tier.radiusKm,
      }),
      stale: t('Citizen readings are more than an hour old.'),
      'rate-limited': t('Rate limited'),
      unavailable,
      'invalid-response': unavailable,
    }[tier.state] ?? null
  );
});
const indexCards = computed(() =>
  view.value?.indices
    ? [
        {
          id: 'naqi',
          title: t('NAQI (India)'),
          card: view.value.indices.naqi,
          basis: t('24 h means (8 h for CO and O3) ending {time} UTC', {
            time: stamp(view.value.indices.naqi.basisEnd),
          }),
        },
        {
          id: 'usaqi',
          title: t('US AQI'),
          card: view.value.indices.usAqi,
          basis: t(
            '24 h PM, 8 h O3 and CO, latest hour of NO2 and SO2, ending {time} UTC',
            { time: stamp(view.value.indices.usAqi.basisEnd) },
          ),
        },
      ]
    : [],
);
const watchStation = computed(() =>
  view.value?.stations?.items.find(
    (item) => item.id === view.value.stations.detailId,
  ),
);
function saveWatch() {
  breath.act('watch', {
    stationId: watchStation.value.id,
    pollutant: watchPollutant.value,
    category: watchCategory.value,
  });
}
</script>

<template>
  <section
    v-if="view?.available"
    class="breath-card"
    :aria-label="t('Breath: air near this place')"
    :aria-busy="view.status === 'loading'"
  >
    <header class="breath-head">
      <h3>{{ t('Breath: air near this place') }}</h3>
      <UiButton
        id="breath-check"
        :disabled="view.status === 'loading'"
        @click="breath.act('check')"
        >{{ t('Check air here') }}</UiButton
      >
    </header>
    <p class="lens-explanation">{{
      t(
        'Observed station readings, uncalibrated citizen sensors and the CAMS model are separate sources. They are never combined.',
      )
    }}</p>
    <p
      v-if="view.status === 'loading'"
      role="status"
      class="lens-explanation"
      >{{ t('Loading') }}</p
    >
    <p v-if="view.error" role="alert" class="lens-message lens-error">{{
      view.error
    }}</p>
    <p v-if="view.feedback" role="status" class="lens-message">{{
      view.feedback
    }}</p>

    <article
      v-if="view.stations"
      id="breath-stations"
      class="breath-tier"
      data-tier="station"
    >
      <h4
        >{{ t('Monitoring stations') }}
        <span class="lens-kind">{{ t('Observed') }}</span></h4
      >
      <p
        v-if="stationState"
        class="breath-state"
        :data-state="view.stations.state"
        role="status"
        >{{ stationState }}</p
      >
      <div
        v-for="station in view.stations.items"
        :key="station.id"
        class="breath-station"
        :data-station="station.id"
      >
        <p class="breath-station-name"
          ><strong>{{ station.name }}</strong>
          <span v-if="station.distanceKm !== null">
            · {{ t('{value} km away', { value: station.distanceKm }) }}</span
          ></p
        >
        <p v-if="station.network" class="lens-attribution">{{
          station.network
        }}</p>
        <table v-if="station.readings.length" class="breath-table">
          <caption class="lens-sr-only">{{
            station.name
          }}</caption>
          <thead
            ><tr
              ><th scope="col">{{ t('Pollutant') }}</th
              ><th scope="col">{{ t('Value') }}</th
              ><th scope="col">{{ t('Measured (UTC)') }}</th></tr
            ></thead
          >
          <tbody
            ><tr v-for="row in station.readings" :key="row.pollutant"
              ><th scope="row">{{ row.label }}</th
              ><td>{{ number(row.value) }} {{ row.unit }}</td
              ><td>{{ stamp(row.observedAt) }}</td></tr
            ></tbody
          >
        </table>
        <p v-if="station.readings.length" class="lens-explanation">{{
          t('Latest hourly values. An index needs 24 h means.')
        }}</p>
        <UiButton
          v-if="
            station.id !== view.stations.detailId && station.readings.length
          "
          :disabled="view.status === 'loading'"
          @click="breath.act('chooseStation', station.id)"
          >{{ t('Compute indices for this station') }}</UiButton
        >
        <p
          v-if="station.licenses.length"
          class="lens-attribution"
          translate="no"
          >OpenAQ · {{ station.licenses.join(', ') }}</p
        >
      </div>
      <p class="lens-attribution"
        >{{ t('Retrieved (UTC)') }}: {{ stamp(view.stations.retrievedAt) }}</p
      >
    </article>

    <article
      v-if="view.indices"
      id="breath-indices"
      class="breath-tier"
      data-tier="index"
    >
      <h4
        >{{ t('Indices for {name}', { name: view.indices.stationName }) }}
        <span class="lens-kind">{{ t('Derived') }}</span></h4
      >
      <div
        v-for="entry in indexCards"
        :key="entry.id"
        class="breath-index"
        :data-index="entry.id"
      >
        <p v-if="entry.card.state === 'ok'" class="breath-index-value"
          ><span>{{ entry.title }}</span> <strong>{{ entry.card.display }}</strong>
          <span>{{ categoryLabel(entry.card.categoryLabel) }}</span></p
        >
        <p v-else class="breath-index-value"
          ><span>{{ entry.title }}</span>
          <span>{{
            t(
              'Not enough data for an index: CPCB needs 16 of 24 hours and three pollutants including PM2.5 or PM10.',
            )
          }}</span></p
        >
        <p class="lens-explanation">{{ entry.basis }}</p>
        <p v-if="entry.card.state === 'ok'" class="lens-explanation"
          >{{ t('Dominant pollutant: {value}', { value: entry.card.dominant }) }}
          <template v-if="entry.card.converted">
            · {{ t('Gases converted to ppm or ppb at 25 °C and 1 atm.') }}
          </template></p
        >
        <details class="breath-subindices"
          ><summary>{{ t('Sub-indices') }}</summary
          ><ul
            ><li v-for="row in entry.card.rows" :key="row.pollutant"
              >{{ row.label }} · {{ number(row.mean) }} {{ row.unit }} ·
              {{
                t('{count} of {total} h', {
                  count: row.hours,
                  total: row.averagingHours,
                })
              }}
              · {{ subIndex(row) }}</li
            ></ul
          ></details
        >
      </div>
      <form v-if="watchStation" class="breath-watch" @submit.prevent="saveWatch">
        <h5>{{ t('Watch this station') }}</h5>
        <label for="breath-watch-pollutant">{{ t('Pollutant') }}</label>
        <select id="breath-watch-pollutant" v-model="watchPollutant">
          <option
            v-for="id in watchStation.pollutants"
            :key="id"
            :value="id"
            >{{
              watchStation.readings.find((row) => row.pollutant === id)
                ?.label ?? id
            }}</option
          >
        </select>
        <label for="breath-watch-category">{{ t('Category') }}</label>
        <select id="breath-watch-category" v-model="watchCategory">
          <option
            v-for="category in view.watchCategories"
            :key="category.id"
            :value="category.id"
            >{{ t(category.label) }}</option
          >
        </select>
        <UiButton id="breath-watch-save" type="submit">{{
          t('Save station watch')
        }}</UiButton>
      </form>
    </article>

    <article
      v-if="view.citizen && view.citizen.state !== 'disabled'"
      id="breath-citizen"
      class="breath-tier"
      data-tier="citizen"
    >
      <h4
        >{{ t('Citizen sensors (uncalibrated)') }}
        <span class="lens-kind">{{ t('Observed') }}</span></h4
      >
      <p class="lens-explanation">{{
        t(
          'Low-cost sensors from sensor.community. Uncalibrated, not regulatory, and never used for an index.',
        )
      }}</p>
      <p
        v-if="citizenState"
        class="breath-state"
        :data-state="view.citizen.state"
        role="status"
        >{{ citizenState }}</p
      >
      <ul class="breath-list">
        <li
          v-for="sensor in view.citizen.items"
          :key="sensor.id"
          translate="no"
          >PM2.5 {{ number(sensor.pm25) }} µg/m³ · PM10
          {{ number(sensor.pm10) }} µg/m³ ·
          {{ t('{value} km away', { value: sensor.distanceKm }) }} ·
          {{ stamp(sensor.observedAt) }} UTC</li
        >
      </ul>
      <p class="lens-attribution" translate="no">sensor.community · ODbL 1.0</p>
    </article>

    <article
      v-if="view.model"
      id="breath-model"
      class="breath-tier"
      data-tier="model"
    >
      <h4
        >{{ t('CAMS model (not a measurement)') }}
        <span class="lens-kind">{{ t('Modelled') }}</span></h4
      >
      <template v-if="view.model.rows">
        <p class="lens-explanation">{{
          t(
            'Modelled for the hour from {time} UTC on a grid of about {value} km.',
            {
              time: stamp(view.model.validAt),
              value: view.model.resolutionKm,
            },
          )
        }}</p>
        <ul class="breath-list">
          <li v-for="row in view.model.rows" :key="row.id"
            >{{ row.label }} · {{ number(row.value) }} {{ row.unit }}</li
          >
        </ul>
        <p class="lens-attribution"
          >{{ view.model.attribution }} · {{ view.model.license }}</p
        >
      </template>
      <p v-else class="breath-state" role="status">{{
        t('The model card is unavailable.')
      }}</p>
    </article>
  </section>
</template>
