<script setup>
import { t } from '../../../i18n/index.js';
const props = defineProps({ snapshot: { type: Object, required: true } });
const time = (value) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        timeZone: props.snapshot.timeZone,
        timeZoneName: 'short',
      })
    : t('Unknown');
const metres = (value) =>
  value == null ? t('Unknown') : t('{value} m', { value });
</script>

<template>
  <div class="fieldbook-analysis">
    <p class="fieldbook-help">{{
      t(
        'Historical snapshot. Values stay as captured; opening this analysis does not refresh any source.',
      )
    }}</p>
    <p class="fieldbook-help">{{ t('Geometric visibility, terrain-only') }}</p>
    <dl>
      <dt>{{ t('Captured') }}</dt><dd>{{ time(snapshot.capturedAt) }}</dd>
      <dt>{{ t('Local date') }}</dt
      ><dd>{{ snapshot.localDate }} · {{ snapshot.timeZone }}</dd>
      <dt>{{ t('Astronomical sunrise (flat horizon)') }}</dt
      ><dd>{{ time(snapshot.sun.astronomicalRise) }}</dd>
      <dt>{{ t('Sun clears the terrain') }}</dt
      ><dd>{{ time(snapshot.sun.terrainRise) }}</dd>
      <dt>{{ t('Sun drops behind the terrain') }}</dt
      ><dd>{{ time(snapshot.sun.terrainSet) }}</dd>
      <template v-if="snapshot.shadow"
        ><dt>{{
          t('Shadow of a {height} m gnomon', {
            height: snapshot.shadow.gnomonM,
          })
        }}</dt
        ><dd
          >{{ time(snapshot.shadow.at) }} ·
          {{
            snapshot.shadow.shadowLengthM == null
              ? t('No measurable shadow')
              : metres(snapshot.shadow.shadowLengthM)
          }}</dd
        ></template
      >
      <dt>{{ t('DEM void samples') }}</dt
      ><dd>{{ snapshot.dem.voidSamples }}</dd>
    </dl>
    <section v-if="snapshot.peaks.length">
      <h5>{{ t('Peaks on the horizon') }}</h5>
      <p v-for="peak in snapshot.peaks" :key="peak.id"
        >{{ peak.name }} ·
        {{
          t('az {azimuth} · {distance} · elevation {angle}', {
            azimuth: t('{value}°', { value: peak.azimuthDeg }),
            distance: t('{value} km', { value: peak.distanceKm }),
            angle: t('{value}°', { value: peak.apparentElevationDeg }),
          })
        }}
        ·
        {{
          t('DEM {dem} · OSM ele {osm}', {
            dem: metres(peak.demM),
            osm: metres(peak.osmEleM),
          })
        }}</p
      >
    </section>
    <p class="fieldbook-help">{{ snapshot.dem.label }} ·
      {{ snapshot.dem.attribution }}</p>
  </div>
</template>
