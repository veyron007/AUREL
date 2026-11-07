<script setup>
import { t } from '../../../i18n/index.js';
const props = defineProps({ snapshot: { type: Object, required: true } });
const time = (value) => value ? new Date(value).toLocaleString(undefined, { timeZone: props.snapshot.timeZone, timeZoneName: 'short' }) : t('Unknown');
const meters = (value) => value == null ? t('Unknown') : t('{value} m', { value });
</script>

<template>
  <div class="fieldbook-analysis">
    <p class="fieldbook-help">{{ t('Historical snapshot. Values stay as captured; opening this analysis does not refresh any source.') }}</p>
    <dl>
      <dt>{{ t('Captured') }}</dt><dd>{{ time(snapshot.capturedAt) }}</dd>
      <dt>{{ t('Local date') }}</dt><dd>{{ snapshot.localDate }} · {{ snapshot.timeZone }}</dd>
      <dt>{{ t('Departure') }}</dt><dd>{{ time(snapshot.departureAt) }}</dd>
      <template v-if="snapshot.route"><dt>{{ t('Route') }}</dt><dd>{{ snapshot.route.name }} · {{ meters(snapshot.route.distanceM) }}</dd></template>
    </dl>
    <section v-if="snapshot.profile">
      <h5>{{ t('Elevation profile') }}</h5>
      <dl><dt>{{ t('Minimum elevation') }}</dt><dd>{{ meters(snapshot.profile.minM) }}</dd><dt>{{ t('Maximum elevation') }}</dt><dd>{{ meters(snapshot.profile.maxM) }}</dd><dt>{{ t('Sample spacing') }}</dt><dd>{{ meters(snapshot.profile.sampleSpacingM) }}</dd><dt>{{ t('Native resolution') }}</dt><dd>{{ meters(snapshot.profile.resolutionM) }}</dd><dt>{{ t('Vertical datum') }}</dt><dd>{{ snapshot.profile.datum }}</dd><dt>{{ t('Source') }}</dt><dd>{{ snapshot.profile.sourceLabel }} · {{ snapshot.profile.datasetVersions.join(', ') || t('Unknown') }}</dd><dt>{{ t('Retrieved') }}</dt><dd>{{ time(snapshot.profile.retrievedAt) }}</dd></dl>
      <p>{{ snapshot.profile.complete ? t('All profile samples available') : t('Profile contains gaps') }}</p>
      <p v-if="snapshot.profile.attribution" class="fieldbook-help">{{ snapshot.profile.attribution }}</p>
    </section>
    <section v-if="snapshot.daylight">
      <h5>{{ t('Daylight') }}</h5>
      <dl><dt>{{ t('Civil dawn') }}</dt><dd>{{ time(snapshot.daylight.civilDawn) }}</dd><dt>{{ t('Sunrise') }}</dt><dd>{{ time(snapshot.daylight.sunrise) }}</dd><dt>{{ t('Sunset') }}</dt><dd>{{ time(snapshot.daylight.sunset) }}</dd><dt>{{ t('Civil dusk') }}</dt><dd>{{ time(snapshot.daylight.civilDusk) }}</dd></dl>
      <p class="fieldbook-help">{{ t('Calculated solar times exclude terrain and building horizons.') }}</p>
    </section>
    <section v-for="(checkpoint, index) in snapshot.checkpoints" :key="index">
      <h5>{{ t('Checkpoint {number}', { number: index + 1 }) }} · {{ checkpoint.lat.toFixed(5) }}°, {{ checkpoint.lon.toFixed(5) }}°</h5>
      <div v-for="source in [checkpoint.context.weather, checkpoint.context.airQuality]" :key="source.sourceId">
        <strong>{{ source.sourceLabel }}</strong><p>{{ t('Forecast') }} · {{ source.state === 'ready' ? t('Available') : source.state === 'stale' ? t('Stale') : source.state === 'blocked' ? t('Blocked') : t('Unavailable') }}</p>
        <dl><dt>{{ t('Applicable time') }}</dt><dd>{{ time(source.validFrom) }} — {{ time(source.validTo) }}</dd><dt>{{ t('Retrieved') }}</dt><dd>{{ time(source.retrievedAt) }}</dd><dt>{{ t('Native resolution') }}</dt><dd>{{ meters(source.resolutionM) }}</dd></dl>
        <p v-if="source.hours.length">{{ t('{count} hourly forecast samples saved', { count: source.hours.length }) }}</p>
        <p class="fieldbook-help">{{ source.attribution }} · {{ source.license }}</p>
      </div>
    </section>
    <section v-if="snapshot.fireContext">
      <h5>{{ t('Fire context') }} · {{ snapshot.fireContext.source }}</h5>
      <p v-if="['ok', 'partial', 'stale'].includes(snapshot.fireContext.status)">{{ t('Records returned: {count}', { count: snapshot.fireContext.count }) }} · {{ snapshot.fireContext.status === 'stale' ? t('Stale') : snapshot.fireContext.status === 'partial' ? t('Partial') : t('Available') }}</p>
      <p v-else>{{ t('Unavailable') }}</p>
      <p>{{ time(snapshot.fireContext.window.start) }} — {{ time(snapshot.fireContext.window.end) }}</p>
      <p v-for="limit in snapshot.fireContext.limitations" :key="limit" class="fieldbook-help">{{ limit }}</p>
    </section>
  </div>
</template>
