<script setup>
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { t } from '../../../i18n/index.js';
import { useWatchlistsStore } from '../../stores/watchlists.js';
import RailPanel from '../../rail/RailPanel.vue';
const watchlists = useWatchlistsStore();
const { view } = storeToRefs(watchlists);
const placeId = ref(''),
  title = ref(''),
  kind = ref('firms'),
  intervalMinutes = ref(30);
const intervalChoices = computed(() =>
  kind.value === 'scene' ? [60, 180, 360, 720] : [30, 60, 180, 360],
);
function chooseKind(value) {
  kind.value = value;
  intervalMinutes.value = value === 'scene' ? 180 : 30;
}
const sceneLabel = (item) =>
  `${item.platform} · ${item.collection}${
    item.cloudCover === null
      ? ` · ${t('scene cloud unknown')}`
      : ` · ${t('scene cloud {value}%', { value: item.cloudCover })}`
  }`;
const selectedPlace = computed(() =>
  view.value?.places?.find((place) => place.id === placeId.value),
);
const stateLabel = (state) =>
  ({
    stopped: t('Stopped'),
    running: t('Monitoring'),
    checking: t('Checking source'),
    'paused-hidden': t('Paused while hidden'),
    'paused-errors': t('Paused after errors'),
    'paused-cooldown': t('Waiting for cooldown'),
    'other-tab': t('Active in another tab'),
    'needs-key': t('Saved provider key required'),
  })[state] ?? t('Unknown');
const coverageLabel = (value, watchKind) =>
  watchKind === 'scene' && value === 'unavailable'
    ? t('Catalogues unreachable · availability unknown')
    : ({
        unknown: t('Unknown'),
        complete: t('All responded'),
        partial: t('Partial'),
        stale: t('Stale'),
        unavailable: t('Unavailable'),
      })[value] ?? t('Unknown');
const sourceStatus = (value) =>
  ({
    ok: t('Available'),
    unavailable: t('Unavailable'),
    'rate-limited': t('Rate limited'),
    timeout: t('Timed out'),
    'invalid-response': t('Invalid response'),
    partial: t('Partial'),
    blocked: t('Refused by the local request budget'),
  })[value] ?? t('Unknown');
const stamp = (value, fallback = t('Unknown')) =>
  value == null
    ? fallback
    : new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
const active = (watch) =>
  ['running', 'checking', 'paused-hidden', 'paused-cooldown'].includes(
    watch.state,
  );
async function create() {
  const success = await watchlists.act('create', {
    placeId: placeId.value,
    title: title.value.trim(),
    intervalMinutes: Number(intervalMinutes.value),
    ...(kind.value === 'scene' ? { kind: 'scene' } : {}),
  });
  if (success) {
    title.value = '';
    placeId.value = '';
  }
}
</script>
<template>
  <RailPanel
    id="watchlist-panel"
    start-collapsed
    :title="t('Watch areas')"
    :hint="
      t('Explicit local checks for saved places, with honest source status')
    "
    scroll
  >
    <div
      class="watchlist-workspace"
      :aria-busy="Boolean(view?.loading || view?.busy)"
    >
      <header class="watchlist-intro"
        ><span class="watchlist-eyebrow">{{ t('Keep a measured watch') }}</span
        ><h2>{{ t('Your places. Your schedule.') }}</h2
        ><p>{{
          t(
            'Checks start only when you choose Start monitoring. They pause while this app is hidden and stop when it closes. No OS alerts are sent.',
          )
        }}</p></header
      >
      <p v-if="!view || view.loading" role="status" class="watchlist-help">{{
        t('Loading saved watch areas…')
      }}</p
      ><p
        v-if="view?.error"
        class="watchlist-notice watchlist-notice--error"
        role="alert"
        >{{ view.error }}</p
      ><p v-if="view?.feedback" class="watchlist-notice" role="status">{{
        view.feedback
      }}</p>
      <details class="watchlist-create-settings" :open="!view?.watches?.length"
        ><summary>{{ t('Add a watch area') }}</summary
        ><form id="watchlist-form" @submit.prevent="create"
          ><fieldset v-if="view?.sceneWatchAvailable" class="watchlist-kind"
            ><legend>{{ t('Watch for') }}</legend
            ><label
              ><input
                type="radio"
                name="watchlist-kind"
                value="firms"
                :checked="kind === 'firms'"
                @change="chooseKind('firms')"
              />{{ t('FIRMS thermal detections') }}</label
            ><label
              ><input
                type="radio"
                name="watchlist-kind"
                value="scene"
                :checked="kind === 'scene'"
                @change="chooseKind('scene')"
              />{{ t('A new satellite scene') }}</label
            ></fieldset
          ><label for="watchlist-place">{{ t('Saved place') }}</label
          ><select
            id="watchlist-place"
            v-model="placeId"
            required
            :disabled="view?.busy"
            ><option disabled value="">{{ t('Choose a saved place') }}</option
            ><option
              v-for="place in view?.places ?? []"
              :key="place.id"
              :value="place.id"
              :disabled="!place.available"
              >{{ place.name
              }}{{
                place.available ? '' : ` · ${t('Area unavailable')}`
              }}</option
            ></select
          ><p v-if="!view?.places?.length" class="watchlist-help">{{
            t('Save a place in Fieldbook before creating a watch area.')
          }}</p
          ><label for="watchlist-title">{{ t('Watch name (optional)') }}</label
          ><input
            id="watchlist-title"
            v-model="title"
            type="text"
            maxlength="120"
            :disabled="view?.busy"
          /><label for="watchlist-interval">{{
            t('Minimum time between checks')
          }}</label
          ><select
            id="watchlist-interval"
            v-model.number="intervalMinutes"
            :disabled="view?.busy"
            ><option
              v-for="minutes in intervalChoices"
              :key="minutes"
              :value="minutes"
              >{{ t('{value} min', { value: minutes }) }}</option
            ></select
          ><p v-if="selectedPlace?.bounds" class="watchlist-coordinates"
            >{{ t('Area bounds') }}: {{ selectedPlace.bounds.west }}°,
            {{ selectedPlace.bounds.south }}° →
            {{ selectedPlace.bounds.east }}°,
            {{ selectedPlace.bounds.north }}°</p
          ><p class="watchlist-help">{{
            kind === 'scene'
              ? t(
                  'Creating a scene watch does not start monitoring. The minimum interval is 60 minutes.',
                )
              : t(
                  'Creating an area does not start monitoring. The minimum interval is 30 minutes.',
                )
          }}</p></form
        ></details
      >
      <div class="watchlist-actions"
        ><button
          id="watchlist-create"
          type="submit"
          form="watchlist-form"
          :disabled="
            !view?.canCreate || view?.busy || !selectedPlace?.available
          "
          >{{ t('Create watch area') }}</button
        ><button
          type="button"
          :disabled="view?.busy"
          @click="watchlists.act('refresh')"
          >{{ t('Refresh saved list') }}</button
        ></div
      >
      <p
        v-if="view && !view.loading && !view.watches.length"
        class="watchlist-empty"
        >{{
          t(
            'No watch areas yet. Add one from a saved place, then start it when you are ready.',
          )
        }}</p
      >
      <article
        v-for="watch in view?.watches ?? []"
        :key="watch.id"
        class="watchlist-card"
        :aria-label="watch.title"
        ><header
          ><div
            ><span class="watchlist-eyebrow">{{ watch.placeName }}</span
            ><h3>{{ watch.title }}</h3></div
          ><span class="watchlist-state" role="status">{{
            stateLabel(watch.state)
          }}</span></header
        ><p class="watchlist-source-name"
          >{{
            watch.kind === 'scene'
              ? t('Earth Search and NASA CMR-STAC scenes')
              : t('NASA FIRMS thermal detections')
          }}
          ·
          {{ t('{value} min', { value: watch.intervalMinutes }) }}</p
        >
        <p v-if="watch.reason" class="watchlist-notice">{{ watch.reason }}</p
        ><p v-if="watch.baselinePending" class="watchlist-baseline"
          ><strong>{{ t('Starting record pending') }}</strong
          ><span>{{
            watch.kind === 'scene'
              ? t(
                  'The first successful check records the scenes already catalogued. Only scenes catalogued after it are announced, each once.',
                )
              : t(
                  'The first successful check records existing detections. It does not announce them as newly occurring.',
                )
          }}</span></p
        >
        <dl class="watchlist-metrics"
          ><div
            ><dt>{{ t('Source checks') }}</dt
            ><dd>{{ coverageLabel(watch.coverage, watch.kind) }}</dd></div
          ><div
            ><dt>{{ t('Consecutive errors') }}</dt
            ><dd>{{ watch.errorCount }}</dd></div
          ><div
            ><dt>{{ t('Last attempted check') }}</dt
            ><dd>{{ stamp(watch.lastAttemptAt, t('Not attempted')) }}</dd></div
          ><div
            ><dt>{{ t('Last successful check') }}</dt
            ><dd>{{ stamp(watch.lastSuccessAt, t('Never checked')) }}</dd></div
          ><div
            ><dt>{{ t('Source retrieved') }}</dt
            ><dd>{{ stamp(watch.lastRetrievedAt) }}</dd></div
          ><div
            ><dt>{{ t('Next scheduled check') }}</dt
            ><dd>{{ stamp(watch.nextCheckAt, t('Not scheduled')) }}</dd></div
          ></dl
        >
        <div class="watchlist-actions"
          ><button
            v-if="!active(watch)"
            type="button"
            data-watch-start
            class="watchlist-primary"
            :disabled="view.busy || watch.state === 'other-tab'"
            @click="watchlists.act('start', watch.id)"
            >{{ t('Start monitoring') }}</button
          ><button
            v-if="active(watch) || watch.state === 'other-tab'"
            type="button"
            data-watch-stop
            :disabled="watch.state === 'other-tab'"
            @click="watchlists.act('stop', watch.id)"
            >{{ t('Stop monitoring') }}</button
          ><button
            type="button"
            data-watch-remove
            :disabled="view.busy || watch.state === 'other-tab'"
            @click="watchlists.act('remove', watch.id)"
            >{{ t('Remove watch area') }}</button
          ></div
        >
        <details class="watchlist-details"
          ><summary>{{ t('Area and source checks') }}</summary
          ><p class="watchlist-coordinates"
            >{{ watch.bounds.west }}°, {{ watch.bounds.south }}° →
            {{ watch.bounds.east }}°, {{ watch.bounds.north }}°</p
          ><ul
            ><li v-for="source in watch.sources" :key="source.id"
              >{{ source.id }} · {{ sourceStatus(source.status) }}</li
            ></ul
          ></details
        >
        <section
          class="watchlist-summaries"
          :aria-label="t('Local check summaries')"
          ><div class="watchlist-section-heading"
            ><h4>{{ t('Local summaries') }}</h4
            ><button
              v-if="watch.notifications.length"
              type="button"
              @click="watchlists.act('clearNotifications', watch.id)"
              >{{ t('Clear summaries') }}</button
            ></div
          ><p v-if="!watch.notifications.length" class="watchlist-help">{{
            t(
              'No new summaries have been recorded. This does not establish that no events occurred.',
            )
          }}</p
          ><article
            v-for="notification in watch.notifications"
            :key="notification.id"
            class="watchlist-notification"
            ><p class="watchlist-summary-time"
              >{{ t('Check summary') }} · {{ stamp(notification.createdAt) }}</p
            ><dl class="watchlist-summary-counts"
              ><div
                ><dt>{{
                  watch.kind === 'scene'
                    ? t('Acquired since the last check')
                    : t('Newly occurring')
                }}</dt
                ><dd>{{ notification.newlyOccurredCount }}</dd></div
              ><div
                ><dt>{{
                  watch.kind === 'scene'
                    ? t('Earlier acquisitions newly catalogued')
                    : t('Older observations first retrieved')
                }}</dt
                ><dd>{{ notification.newlyRetrievedCount }}</dd></div
              ></dl
            ><details class="watchlist-details"
              ><summary>{{ t('Observation times and sources') }}</summary
              ><ul class="watchlist-observations"
                ><li v-for="item in notification.observations" :key="item.id"
                  ><strong>{{ stamp(item.acquiredAt) }}</strong
                  ><span v-if="watch.kind === 'scene'"
                    >{{ item.sceneId }} · {{ sceneLabel(item) }} ·
                    {{ t('available product (observed)') }}</span
                  ><span v-else
                    >{{ item.source }} · {{ item.lat.toFixed(4) }}°,
                    {{ item.lon.toFixed(4) }}°</span
                  ><button
                    v-if="watch.kind === 'scene'"
                    type="button"
                    data-watch-open-scene
                    @click="watchlists.act('openScene', watch.id, item.id)"
                    >{{ t('Open beside the previous scene in Chronicle') }}</button
                  ></li
                ></ul
              ><p v-if="notification.unlistedCount" class="watchlist-help">{{
                t(
                  '{count} additional observations are not listed in this summary.',
                  { count: notification.unlistedCount },
                )
              }}</p></details
            ></article
          ></section
        >
      </article>
      <p
        v-for="(limitation, index) in view?.limitations ?? []"
        :key="index"
        class="watchlist-help"
        >{{ limitation }}</p
      >
    </div>
  </RailPanel>
</template>
