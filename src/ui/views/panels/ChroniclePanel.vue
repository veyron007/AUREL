<script setup>
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { t } from '../../../i18n/index.js';
import { useChronicleStore } from '../../stores/chronicle.js';
import RailPanel from '../../rail/RailPanel.vue';

const chronicle = useChronicleStore();
const { view } = storeToRefs(chronicle);
const startDate = ref('');
const endDate = ref('');
const note = ref('');
const interpretation = ref('unresolved');
const latestDate = new Date().toISOString().slice(0, 10);
const endLimit = computed(() => {
  const start = Date.parse(startDate.value);
  return Number.isFinite(start)
    ? new Date(Math.min(start + 30 * 86400000, Date.parse(latestDate)))
        .toISOString()
        .slice(0, 10)
    : latestDate;
});
const sides = computed(() => [
  { key: 'a', label: t('Image A'), descriptor: view.value?.slots?.a },
  { key: 'b', label: t('Image B'), descriptor: view.value?.slots?.b },
]);
const lanes = computed(() =>
  [
    {
      key: 'imagery',
      label: t('Imagery acquisitions'),
      empty: t('No dated imagery selected.'),
    },
    {
      key: 'observations',
      label: t('Observations'),
      empty: t('No dated observations attached.'),
    },
    {
      key: 'forecasts',
      label: t('Forecasts'),
      empty: t('No forecast windows attached.'),
    },
    {
      key: 'precipitation',
      label: t('Precipitation'),
      empty: t('No saved mountain weather sheets for this place.'),
    },
    {
      key: 'notes',
      label: t('Interpretations'),
      empty: t('No dated interpretations saved.'),
    },
  ].map((lane) => ({ ...lane, rows: view.value?.lanes?.[lane.key] ?? [] })),
);
const state = computed(
  () =>
    ({
      empty: t('Choose an area and dates'),
      ready: t('Dated evidence ready'),
      partial: t('Some imagery is unavailable'),
      unavailable: t('Imagery unavailable'),
      searching: t('Searching the imagery catalogue'),
      probing: t('Checking dated pixels'),
      comparing: t('Opening map comparison'),
      compared: t('Map comparison open'),
      saved: t('Comparison saved'),
      error: t('Imagery search unavailable'),
      cancelled: t('Search cancelled'),
    })[view.value?.status] ?? t('Choose an area and dates'),
);
const stamp = (value) =>
  value == null
    ? t('Date unknown')
    : new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
const acquisition = (time) =>
  time?.kind === 'day'
    ? time.date
    : time?.kind === 'instant'
      ? stamp(time.at)
      : time?.kind === 'interval'
        ? `${stamp(time.start)} → ${stamp(time.end)}`
        : t('Date unknown');
const coverage = (value) =>
  ({ full: t('Full'), partial: t('Partial'), unknown: t('Unknown') })[value] ??
  t('Unknown');
const availability = (value) =>
  ({
    catalogue: t('Catalogue match'),
    present: t('Pixels verified'),
    empty: t('No pixels found'),
    error: t('Pixel check failed'),
  })[value] ?? t('Unknown');
const canChoose = (candidate) =>
  ['catalogue', 'present', 'error'].includes(candidate.status);
const classification = (value) =>
  ({
    observed: t('Observed'),
    inferred: t('Inferred'),
    unresolved: t('Unresolved'),
  })[value] ?? t('Unresolved');
function search() {
  chronicle.act('search', {
    startDate: startDate.value,
    endDate: endDate.value,
  });
}
async function addNote() {
  if (
    await chronicle.act('addNote', {
      text: note.value.trim(),
      interpretation: interpretation.value,
    })
  )
    note.value = '';
}
</script>

<template>
  <RailPanel
    id="chronicle-panel"
    start-collapsed
    :title="t('Chronicle')"
    :hint="
      t(
        'Compare dated imagery and keep the evidence behind your interpretation',
      )
    "
    scroll
  >
    <div class="chronicle-workspace" :aria-busy="Boolean(view?.busy)">
      <header class="chronicle-intro"
        ><span class="chronicle-eyebrow">{{ t('Evidence through time') }}</span
        ><h2>{{ view?.selection?.name || t('Choose a place to compare') }}</h2
        ><p>{{
          t(
            'Two dated images. Their sources, limits and your interpretation stay together.',
          )
        }}</p></header
      >
      <details
        class="chronicle-search-settings"
        :open="!view?.candidates?.length"
        ><summary>{{ t('Area and date window') }}</summary>
        <form id="chronicle-search-form" @submit.prevent="search">
          <p class="chronicle-help">{{
            t(
              'Search uses the current selected area. Change the selection in Lens to compare somewhere else.',
            )
          }}</p>
          <p class="chronicle-help">{{
            t(
              'Select a place and choose 1–31 past UTC days within an area no larger than 100 km per side.',
            )
          }}</p>
          <div class="chronicle-date-fields"
            ><div
              ><label for="chronicle-start">{{ t('Window starts') }}</label
              ><input
                id="chronicle-start"
                v-model="startDate"
                type="date"
                required
                :disabled="view?.busy" /></div
            ><div
              ><label for="chronicle-end">{{ t('Window ends') }}</label
              ><input
                id="chronicle-end"
                v-model="endDate"
                type="date"
                required
                :min="startDate || '2013-01-01'"
                :max="endLimit"
                :disabled="view?.busy" /></div
          ></div>
          <p v-if="view?.query?.extent" class="chronicle-coordinates"
            >{{ t('Requested area') }}: {{ view.query.extent.join('°, ') }}°</p
          >
        </form>
      </details>
      <div class="chronicle-actions"
        ><button
          id="chronicle-search"
          type="submit"
          form="chronicle-search-form"
          class="chronicle-primary"
          :disabled="!view?.selection || view?.busy"
          >{{ t('Find dated imagery') }}</button
        ><button
          v-if="view?.canCancel"
          type="button"
          @click="chronicle.act('cancel')"
          >{{ t('Cancel') }}</button
        ></div
      >
      <p class="chronicle-state" role="status">{{ state }}</p
      ><p
        v-if="view?.error"
        class="chronicle-notice chronicle-notice--error"
        role="alert"
        >{{ view.error }}</p
      ><p v-if="view?.feedback" class="chronicle-notice" role="status">{{
        view.feedback
      }}</p>
      <section
        v-if="view?.candidates?.length"
        class="chronicle-section"
        :aria-label="t('Dated imagery candidates')"
      >
        <div class="chronicle-section-heading"
          ><h3>{{ t('Choose two dates') }}</h3
          ><span class="chronicle-tag">{{ t('Explicit selection') }}</span></div
        >
        <p class="chronicle-help">{{
          t(
            'Choosing A or B checks that pixels are available. A rendering request date is not an acquisition date.',
          )
        }}</p>
        <ul class="chronicle-candidates"
          ><li
            v-for="candidate in view.candidates"
            :key="candidate.id"
            :data-candidate="candidate.id"
            ><div
              ><strong>{{
                candidate.descriptor
                  ? acquisition(candidate.descriptor.time)
                  : candidate.requestedDate
              }}</strong
              ><span>{{ candidate.label }}</span
              ><small
                >{{
                  candidate.descriptor
                    ? t('Acquisition date')
                    : t('Requested date')
                }}
                · {{ availability(candidate.status) }}</small
              ></div
            ><div class="chronicle-pick-actions"
              ><button
                type="button"
                data-slot="a"
                :disabled="view.busy || !canChoose(candidate)"
                :aria-label="
                  t('Use {date} as image A', {
                    date: candidate.descriptor
                      ? acquisition(candidate.descriptor.time)
                      : candidate.requestedDate,
                  })
                "
                @click="
                  chronicle.act('choose', { slot: 'a', id: candidate.id })
                "
                >{{ t('Use A') }}</button
              ><button
                type="button"
                data-slot="b"
                :disabled="view.busy || !canChoose(candidate)"
                :aria-label="
                  t('Use {date} as image B', {
                    date: candidate.descriptor
                      ? acquisition(candidate.descriptor.time)
                      : candidate.requestedDate,
                  })
                "
                @click="
                  chronicle.act('choose', { slot: 'b', id: candidate.id })
                "
                >{{ t('Use B') }}</button
              ></div
            ></li
          ></ul
        >
      </section>
      <section class="chronicle-section" :aria-label="t('Selected image pair')">
        <div class="chronicle-image-pair"
          ><article
            v-for="side in sides"
            :key="side.key"
            class="chronicle-image-card"
            :data-image-side="side.key"
            ><header
              ><span class="chronicle-side-marker" aria-hidden="true">{{
                side.key.toUpperCase()
              }}</span
              ><h3>{{ side.label }}</h3></header
            ><p v-if="!side.descriptor" class="chronicle-help">{{
              t('Choose a verified date above.')
            }}</p
            ><template v-else
              ><p class="chronicle-image-source">{{
                side.descriptor.sourceLabel
              }}</p
              ><dl class="chronicle-card-metadata"
                ><dt>{{ t('Acquisition date') }}</dt
                ><dd class="chronicle-acquisition">{{
                  acquisition(side.descriptor.time)
                }}</dd
                ><dt>{{ t('Native resolution') }}</dt
                ><dd>{{
                  t('{value} m', { value: side.descriptor.nativeResolutionM })
                }}</dd
                ><dt>{{ t('Pixel coverage') }}</dt
                ><dd>{{ coverage(side.descriptor.coverage) }}</dd
                ><dt>{{ t('Scene cloud cover') }}</dt
                ><dd>{{
                  side.descriptor.cloudCoverPct == null
                    ? t('Unknown')
                    : t('{value}%', { value: side.descriptor.cloudCoverPct })
                }}</dd
                ><dt>{{ t('Alignment') }}</dt
                ><dd>{{ t('Unverified') }}</dd></dl
              ><details class="chronicle-source-details"
                ><summary>{{ t('Source details') }}</summary
                ><dl
                  ><dt>{{ t('Pixels checked') }}</dt
                  ><dd>{{ stamp(side.descriptor.probedAt) }}</dd
                  ><dt>{{ t('Retrieved') }}</dt
                  ><dd>{{ stamp(side.descriptor.retrievedAt) }}</dd
                  ><dt>{{ t('Rendering date requested') }}</dt
                  ><dd>{{ side.descriptor.asset.requestedDate }}</dd
                  ><dt>{{ t('Reference system') }}</dt
                  ><dd>{{ side.descriptor.georeference.crs }}</dd
                  ><dt>{{ t('License') }}</dt
                  ><dd>{{ side.descriptor.license }}</dd></dl
                ><p>{{ side.descriptor.attribution }}</p></details
              ></template
            ></article
          ></div
        >
        <p class="chronicle-help">{{
          t(
            'Scene cloud cover does not describe cloud cover over your exact area. Different seasons, shadows and alignment can affect a visual comparison.',
          )
        }}</p>
        <p
          v-if="view?.pairWarning"
          class="chronicle-notice chronicle-pair-warning"
          role="status"
          >{{ view.pairWarning }}</p
        >
        <div class="chronicle-actions"
          ><button
            id="chronicle-compare"
            type="button"
            class="chronicle-primary"
            :disabled="!view?.canCompare || view?.busy"
            @click="chronicle.act('compare')"
            >{{ t('Compare on map') }}</button
          ><button
            v-if="view?.comparisonActive"
            type="button"
            :disabled="view?.busy"
            @click="chronicle.act('clearComparison')"
            >{{ t('Close comparison') }}</button
          ><button
            id="chronicle-save"
            type="button"
            :disabled="!view?.canSave || view?.busy"
            @click="chronicle.act('save')"
            >{{ t('Save comparison') }}</button
          ></div
        >
        <p v-if="view?.comparisonActive" class="chronicle-notice">{{
          t(
            'Drag the map divider to compare the two dated sources. The map remains interactive.',
          )
        }}</p
        ><p v-if="view?.savedComparison" class="chronicle-help">{{
          t(
            'This comparison is saved in Fieldbook. Reopening it restores its references without searching for new imagery.',
          )
        }}</p>
      </section>
      <section
        class="chronicle-section chronicle-timeline"
        :aria-label="t('Evidence timeline')"
        ><h3>{{ t('Four kinds of time') }}</h3
        ><p class="chronicle-help">{{
          t(
            'Acquisitions, observations, forecast windows and interpretations remain separate. Unknown dates stay unknown.',
          )
        }}</p
        ><section
          v-for="lane in lanes"
          :key="lane.key"
          class="chronicle-lane"
          :data-lane="lane.key"
          ><h4>{{ lane.label }}</h4
          ><p v-if="!lane.rows.length" class="chronicle-help">{{
            lane.empty
          }}</p
          ><ul v-else
            ><li v-for="row in lane.rows" :key="row.id"
              ><span class="chronicle-lane-marker" aria-hidden="true"></span
              ><div
                ><strong>{{ row.label }}</strong
                ><span
                  >{{ stamp(row.start)
                  }}<template v-if="row.end">
                    → {{ stamp(row.end) }}</template
                  ></span
                ><small v-if="row.sourceLabel">{{ row.sourceLabel }}</small
                ><small v-if="row.interpretation">{{
                  classification(row.interpretation)
                }}</small></div
              ></li
            ></ul
          ></section
        ></section
      >
      <section
        class="chronicle-section"
        :aria-label="t('Manual interpretations')"
        ><h3>{{ t('What do you see?') }}</h3
        ><p class="chronicle-help">{{
          t(
            'Record what is visible, what you infer, and what remains unresolved. These notes are your interpretation, not an automated change detection result.',
          )
        }}</p
        ><ul class="chronicle-notes"
          ><li v-for="item in view?.notes ?? []" :key="item.id"
            ><span class="chronicle-tag">{{
              classification(item.interpretation)
            }}</span
            ><p>{{ item.text }}</p
            ><small>{{ stamp(item.createdAt) }}</small></li
          ></ul
        ><p v-if="!view?.savedComparison" class="chronicle-notice">{{
          t('Save this comparison before adding an interpretation.')
        }}</p
        ><form id="chronicle-note-form" @submit.prevent="addNote"
          ><label for="chronicle-interpretation">{{
            t('Interpretation type')
          }}</label
          ><select
            id="chronicle-interpretation"
            v-model="interpretation"
            :disabled="!view?.savedComparison || view?.busy"
            ><option value="observed">{{ t('Observed') }}</option
            ><option value="inferred">{{ t('Inferred') }}</option
            ><option value="unresolved">{{ t('Unresolved') }}</option></select
          ><label for="chronicle-note">{{ t('Your evidence note') }}</label
          ><textarea
            id="chronicle-note"
            v-model="note"
            rows="3"
            maxlength="16384"
            :disabled="!view?.savedComparison || view?.busy"
          ></textarea
          ><button
            type="submit"
            :disabled="!view?.savedComparison || view?.busy || !note.trim()"
            >{{ t('Save interpretation') }}</button
          ></form
        ></section
      >
    </div>
  </RailPanel>
</template>
