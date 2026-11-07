<script setup>
import { ref } from 'vue';
import { storeToRefs } from 'pinia';
import { t, formatNumber } from '../../../i18n/index.js';
import { useOrbitWitnessStore } from '../../stores/orbitWitness.js';
import { LANES, LANE_SOURCES } from '../../../orbitWitness/lanes.js';
import RailPanel from '../../rail/RailPanel.vue';

const orbit = useOrbitWitnessStore();
const { view } = storeToRefs(orbit);
const planInput = ref(null);
const lanes = [LANES.predicted, LANES.planned, LANES.product, LANES.ride];
const className = (value) =>
  ({
    observed: t('observed'),
    modelled: t('modelled'),
    derived: t('derived'),
    simulated: t('simulated'),
    note: t('note'),
  })[value] ?? value;
const utc = (value) =>
  value
    ? `${new Date(value).toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : t('Unknown');
const local = (value) => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(new Date(value));
  } catch {
    return '';
  }
};
const km = (value) => formatNumber(Math.round(Math.abs(value)));
const deg = (value) => formatNumber(Math.round(value));
const confidenceLabel = (value) =>
  ({
    fresh: t('epoch within 3 days'),
    aging: t('epoch 3–7 days away, position less certain'),
    stale: t('epoch over 7 days away, low confidence'),
  })[value] ?? t('epoch unknown');
function predictedText(pass, imaging) {
  const lane = pass.lanes.predicted;
  if (!imaging)
    return t('Sky pass · peak elevation {elevation}° · {visibility}', {
      elevation: deg(lane.maxElevationDeg),
      visibility: lane.visible
        ? t('may be visible to the eye')
        : t('not naked-eye visible'),
    });
  return t(
    'Place {distance} km {side} of the ground track · {angle}° off nadir · sun {sun}° up · {node}',
    {
      distance: km(lane.crossTrackKm),
      side: lane.side === 'right' ? t('right') : t('left'),
      angle: deg(lane.offNadirDeg),
      sun: deg(lane.solarElevationDeg),
      node: lane.node === 'descending' ? t('descending') : t('ascending'),
    },
  );
}
function plannedText(lane) {
  return (
    {
      confirmed: t('Plan-confirmed: ESA datatake {id}, {start} to {end}', {
        id: lane.datatake?.id,
        start: utc(lane.datatake?.start),
        end: utc(lane.datatake?.end),
      }),
      contradicted: t(
        'The loaded ESA plan has no nominal datatake over this place at this time. The pass is predicted, not planned.',
      ),
      'no-plan': t(
        'No loaded ESA plan covers this time. Load one below to cross-check.',
      ),
      'not-published': t(
        'No admissible published plan: the USGS acquisition calendar ends on 31 December 2025.',
      ),
      'not-applicable': t('Not applicable: no open imaging product.'),
    }[lane.status] ?? t('Unknown')
  );
}
function productText(lane) {
  return (
    {
      available: t('{scene} · scene cloud {cloud}', {
        scene: lane.scene?.id,
        cloud:
          lane.scene?.cloudCoverPct === null
            ? t('unknown')
            : `${formatNumber(lane.scene?.cloudCoverPct)}%`,
      }),
      pending: t('Future pass: no product can exist yet.'),
      'not-yet': t(
        'Not catalogued yet. Level-2 products can take hours to days to appear.',
      ),
      'not-found': t(
        'No matching product catalogued. A pass is not an acquisition: duty cycle, downlink and processing decide.',
      ),
      unknown: t('Unknown: a catalogue did not answer completely.'),
      'not-applicable': t('Not applicable: no open imaging product.'),
    }[lane.status] ?? t('Unknown')
  );
}
function cloudText(lane) {
  if (lane.status === 'beyond-forecast')
    return t('Beyond the 14-day forecast');
  if (!['ok', 'stale'].includes(lane.status)) return t('Unknown');
  return t('{value}% total cloud at {time}{stale}', {
    value: formatNumber(lane.valuePct),
    time: utc(lane.applicableTime),
    stale: lane.status === 'stale' ? ` · ${t('stale')}` : '',
  });
}
const catalogueLabel = (status) =>
  ({
    ok: t('both catalogues answered'),
    partial: t('partial answer · missing products read as unknown'),
    unavailable: t('catalogues unreachable · products unknown'),
  })[status] ?? t('Unknown');
async function plansChosen(event) {
  const files = [...(event.target.files || [])];
  event.target.value = '';
  if (files.length) await orbit.act('loadPlans', files);
}
</script>
<template>
  <RailPanel
    id="orbit-witness-panel"
    start-collapsed
    :title="t('Orbit Witness')"
    :hint="
      t('Next Sentinel-2, Landsat and ISS passes over the selected place')
    "
    scroll
  >
    <div
      class="orbit-witness-workspace"
      :aria-busy="view?.status === 'loading'"
    >
      <header class="orbit-witness-intro"
        ><span class="orbit-witness-eyebrow">{{ t('Overpass oracle') }}</span
        ><h2>{{
          view?.place?.name ||
          view?.selection?.name ||
          t('Select a place in Lens')
        }}</h2
        ><p>{{
          t(
            'A predicted pass says where an orbit goes, not that a picture was taken. Each lane below is kept separate and labelled.',
          )
        }}</p></header
      >
      <ul class="orbit-witness-legend" :aria-label="t('Lanes')">
        <li v-for="lane in lanes" :key="lane.id" :data-lane="lane.id"
          ><strong>{{ t(lane.label) }}</strong
          ><span class="orbit-witness-class">{{
            className(lane.class)
          }}</span></li
        >
      </ul>
      <div class="orbit-witness-actions"
        ><button
          id="orbit-witness-predict"
          type="button"
          class="orbit-witness-primary"
          :disabled="!view?.selection || view?.status === 'loading'"
          @click="orbit.act('predict')"
          >{{ t('Predict passes') }}</button
        ><button
          v-if="view?.status === 'loading'"
          type="button"
          @click="orbit.act('cancel')"
          >{{ t('Cancel') }}</button
        ><button
          id="orbit-witness-watch"
          type="button"
          :disabled="!view?.canWatch"
          @click="orbit.act('watch')"
          >{{ t('Watch for the real scene') }}</button
        ></div
      >
      <p
        v-if="view?.status === 'loading'"
        role="status"
        class="orbit-witness-help"
        >{{ t('Propagating orbits and reading catalogues…') }}</p
      ><p
        v-if="view?.error"
        role="alert"
        class="orbit-witness-notice orbit-witness-notice--error"
        >{{ view.error }}</p
      ><p v-if="view?.feedback" role="status" class="orbit-witness-notice">{{
        view.feedback
      }}</p>
      <details class="orbit-witness-plans"
        ><summary
          >{{ t('Sentinel-2 acquisition plans') }} ·
          {{ formatNumber(view?.plans?.length ?? 0) }}</summary
        ><p class="orbit-witness-help">{{
          t(
            'ESA publishes plan files for each Sentinel-2 satellite. Its terms allow you to download them for non-commercial use but not redistribution, so AUREL never fetches or stores them: download the current files yourself and load them here for this session.',
          )
        }}</p
        ><a
          class="orbit-witness-link"
          :href="LANE_SOURCES.planned.url"
          target="_blank"
          rel="noopener"
          >{{ t('ESA Sentinel-2 acquisition plans') }}</a
        ><input
          ref="planInput"
          type="file"
          accept=".kml,application/vnd.google-earth.kml+xml"
          multiple
          hidden
          data-orbit-witness-plan-file
          @change="plansChosen"
        /><div class="orbit-witness-actions"
          ><button type="button" @click="planInput?.click()">{{
            t('Load plan files')
          }}</button
          ><button
            v-if="view?.plans?.length"
            type="button"
            @click="orbit.act('clearPlans')"
            >{{ t('Clear plans') }}</button
          ></div
        ><ul v-if="view?.plans?.length" class="orbit-witness-plan-list">
          <li v-for="plan in view.plans" :key="plan.fileName"
            ><strong>{{ plan.satellite }}</strong
            ><span
              >{{ utc(plan.coverageStart) }} → {{ utc(plan.coverageEnd) }} ·
              {{
                t('{count} datatakes', { count: formatNumber(plan.datatakes) })
              }}</span
            ></li
          >
        </ul>
        <p class="orbit-witness-credit">© European Space Agency - ESA</p></details
      >
      <dl v-if="view?.window" class="orbit-witness-sources"
        ><div
          ><dt>{{ t('Window') }}</dt
          ><dd>{{ utc(view.window.from) }} → {{ utc(view.window.to) }}</dd></div
        ><div
          ><dt>{{ t('Scene catalogues') }}</dt
          ><dd>{{ catalogueLabel(view.catalogue?.status) }}</dd></div
        ><div
          ><dt>{{ t('Cloud forecast') }}</dt
          ><dd>{{
            ['ok', 'stale'].includes(view.cloud?.status)
              ? t('Open-Meteo, retrieved {time}', {
                  time: utc(view.cloud.retrievedAt),
                })
              : t('Unavailable · cloud reads unknown')
          }}</dd></div
        ><div v-if="view.elementsStale"
          ><dt>{{ t('Orbit elements') }}</dt
          ><dd>{{
            t('CelesTrak unreachable; the last cached copy is used')
          }}</dd></div
        ></dl
      >
      <article
        v-for="mission in view?.missions ?? []"
        :key="mission.id"
        class="orbit-witness-mission"
        :data-mission="mission.id"
        :aria-label="mission.label"
      >
        <header
          ><h3>{{ mission.label }}</h3
          ><p v-if="mission.epoch" class="orbit-witness-epoch"
            >{{
              t('propagated, epoch {epoch}', { epoch: utc(mission.epoch) })
            }}
            ·
            {{
              t('{days} days old', {
                days: formatNumber(Math.round(mission.epochAgeDays * 10) / 10),
              })
            }}
            · {{ confidenceLabel(mission.confidence) }}</p
          ><p v-else class="orbit-witness-epoch">{{
            t('No orbit elements in the local cache for this spacecraft.')
          }}</p
          ><p v-if="mission.swathKm" class="orbit-witness-help"
            >{{
              t('Nominal swath {swath} km', {
                swath: formatNumber(mission.swathKm),
              })
            }}
            ·
            <a :href="mission.factSource.url" target="_blank" rel="noopener">{{
              mission.factSource.label
            }}</a></p
          ></header
        >
        <p
          v-if="mission.status === 'ok' && !mission.passes.length"
          class="orbit-witness-help"
          >{{
            mission.imaging
              ? t('No daylight swath crossing over this place in the window.')
              : t('No pass above 10° elevation in the next three days.')
          }}</p
        >
        <ol class="orbit-witness-passes">
          <li
            v-for="pass in mission.passes"
            :key="pass.id"
            :data-past="pass.past"
            :data-pass="pass.id"
          >
            <p class="orbit-witness-pass-time"
              ><strong>{{ utc(pass.time) }}</strong
              ><span>{{ local(pass.time) }}</span
              ><span v-if="pass.past" class="orbit-witness-class">{{
                t('past')
              }}</span></p
            >
            <dl class="orbit-witness-lanes">
              <div data-lane="predicted"
                ><dt
                  >{{ t(LANES.predicted.label) }} ·
                  {{ className(LANES.predicted.class) }}</dt
                ><dd>{{ predictedText(pass, mission.imaging) }}</dd></div
              >
              <div v-if="mission.imaging" data-lane="planned"
                ><dt
                  >{{ t(LANES.planned.label) }} ·
                  {{ className(LANES.planned.class) }}</dt
                ><dd>{{ plannedText(pass.lanes.planned) }}</dd></div
              >
              <div v-if="mission.imaging" data-lane="product"
                ><dt
                  >{{ t(LANES.product.label) }} ·
                  {{ className(LANES.product.class) }}</dt
                ><dd>{{ productText(pass.lanes.product) }}</dd></div
              >
              <div v-if="mission.imaging" data-lane="cloud"
                ><dt>{{ t('Cloud forecast') }} · {{ className('modelled') }}</dt
                ><dd>{{ cloudText(pass.lanes.cloud) }}</dd></div
              >
            </dl>
            <div v-if="mission.imaging" class="orbit-witness-actions">
              <button
                type="button"
                data-orbit-witness-footprint
                :aria-pressed="pass.footprint"
                @click="
                  orbit.act(
                    pass.footprint ? 'clearFootprint' : 'showFootprint',
                    pass.id,
                  )
                "
                >{{
                  pass.footprint ? t('Hide footprint') : t('Show footprint')
                }}</button
              ><button
                type="button"
                data-orbit-witness-ride
                :disabled="!view?.canRide || Boolean(view?.ride)"
                @click="orbit.act('ride', pass.id)"
                >{{ t('Ride this pass') }}</button
              ><button
                type="button"
                data-orbit-witness-export
                @click="orbit.act('exportRecord', pass.id)"
                >{{ t('Export record') }}</button
              >
            </div>
          </li>
        </ol>
        <p v-if="mission.unplanned?.length" class="orbit-witness-help">{{
          t('Planned by ESA but not predicted here: {takes}', {
            takes: mission.unplanned.map((take) => utc(take.start)).join(', '),
          })
        }}</p>
        <p v-if="mission.truncated" class="orbit-witness-help">{{
          t('The search reached its bound; later passes are not listed.')
        }}</p>
      </article>
      <ul v-if="view?.window" class="orbit-witness-limits">
        <li>{{
          t(
            'Passes are SGP4 propagations of the latest CelesTrak elements; accuracy falls as the pass moves away from the element epoch.',
          )
        }}</li>
        <li>{{
          t(
            'Optical instruments are listed only for daylight crossings. Swath edges are nominal; a scene tile can be cut off before the edge.',
          )
        }}</li>
        <li>{{
          t(
            'Cloud cover is a model forecast for the hour, not the cloud in the scene. Scene cloud percentages describe whole tiles.',
          )
        }}</li>
      </ul>
    </div>
    <Teleport to="body">
      <div
        v-if="view?.ride"
        id="orbit-witness-ride-caption"
        role="status"
        aria-live="polite"
        ><span class="orbit-witness-class">{{ className('simulated') }}</span
        ><p>{{ view.ride.mission }} · {{ view.ride.caption }}</p
        ><button type="button" @click="orbit.act('stopRide')">{{
          t('Stop ride')
        }}</button></div
      >
    </Teleport>
  </RailPanel>
</template>
