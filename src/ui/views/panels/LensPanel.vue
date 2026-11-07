<script setup>
import { computed, nextTick, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { t } from '../../../i18n/index.js';
import RailPanel from '../../rail/RailPanel.vue';
import UiButton from '../../kit/UiButton.vue';
import { useLensStore } from '../../stores/lens.js';
import CorroborationCard from './CorroborationCard.vue';

const lens = useLensStore();
const { view } = storeToRefs(lens);
const tab = ref('overview');
const tabs = ['overview', 'evidence', 'notes'];
const labels = { overview: () => t('Overview'), evidence: () => t('Evidence'), notes: () => t('Notes') };
const selected = computed(() => view.value?.selection);
const selectedEvidence = computed(() => (view.value?.evidence || []).filter((row) => row.scope !== 'layer'));
const feeds = computed(() => (view.value?.evidence || []).filter((row) => row.scope === 'layer'));
const stamp = (value) => value == null ? t('Unknown') : new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
const quality = (value) => value == null ? t('Unknown') : `${value} m`;
const kind = (value) => ({ observation: t('Observation'), forecast: t('Forecast'), imagery: t('Imagery'), derived: t('Derived'), manual: t('Manual'), simulation: t('Simulation'), unknown: t('Unknown') })[value] || t('Unknown');
const state = (value) => ({ unknown: t('Unknown'), nominal: t('Available'), loading: t('Loading'), degraded: t('Degraded'), stale: t('Stale'), partial: t('Partial'), fallback: t('Fallback'), unavailable: t('Unavailable'), blocked: t('Blocked') })[value] || t('Unknown');
const coverage = (value) => ({ unknown: t('Unknown'), supported: t('Supported'), unsupported: t('Unsupported'), partial: t('Partial') })[value] || t('Unknown');
async function moveTab(event) {
  const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
  if (!delta && !['Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  tab.value = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(tabs.indexOf(tab.value) + delta + tabs.length) % tabs.length];
  await nextTick();
  document.getElementById(`lens-tab-${tab.value}`)?.focus();
}
</script>

<template>
  <RailPanel id="lens-panel" start-collapsed :title="t('Lens')" :hint="t('Inspect a place and understand its sources')" scroll>
    <div class="lens-content">
      <div class="lens-top-actions">
        <UiButton id="lens-inspect-view" @click="lens.act('inspectCurrentView')">{{ t('Inspect current view') }}</UiButton>
        <UiButton v-if="selected" :label="t('Clear selection')" @click="lens.act('clear')">{{ t('Clear') }}</UiButton>
      </div>
      <p v-if="!selected" class="lens-empty" role="status">{{ view?.status === 'loading' ? t('Finding the selected place…') : t('Search for a place, select a map feature, or inspect the current view.') }}</p>
      <template v-else>
        <p v-if="view.status === 'loading'" class="lens-explanation" role="status">{{ t('Loading') }}</p>
        <header class="lens-identity">
          <span class="lens-eyebrow">{{ t('Selected place') }}</span>
          <h2>{{ selected.name }}</h2>
          <p v-if="selected.aliases.length">{{ selected.aliases.join(' · ') }}</p>
          <p class="lens-coordinates">{{ selected.geometry.coordinates[1].toFixed(5) }}° {{ selected.geometry.coordinates[0].toFixed(5) }}°</p>
        </header>
        <div class="lens-tabs" role="tablist" :aria-label="t('Place details')" @keydown="moveTab">
          <button v-for="id in tabs" :id="`lens-tab-${id}`" :key="id" type="button" role="tab" :aria-selected="tab === id" :aria-controls="`lens-tabpanel-${id}`" :tabindex="tab === id ? 0 : -1" @click="tab = id">{{ labels[id]() }}</button>
        </div>
        <section v-show="tab === 'overview'" id="lens-tabpanel-overview" role="tabpanel" aria-labelledby="lens-tab-overview" tabindex="0">
          <dl class="lens-details">
            <div><dt>{{ t('Latitude') }}</dt><dd>{{ selected.geometry.coordinates[1].toFixed(5) }}°</dd></div>
            <div><dt>{{ t('Longitude') }}</dt><dd>{{ selected.geometry.coordinates[0].toFixed(5) }}°</dd></div>
            <div><dt>{{ t('Source') }}</dt><dd>{{ selected.sourceLabel || t('Unknown') }}</dd></div>
            <div><dt>{{ t('Extent') }}</dt><dd>{{ selected.extent ? selected.extent.map(value => `${value.toFixed(4)}°`).join(' / ') : t('Point selection') }}</dd></div>
          </dl>
          <p class="lens-explanation">{{ t('Source detail and dates are shown only when supplied. Zooming in does not establish finer imagery resolution.') }}</p>
          <div class="lens-actions">
            <UiButton id="lens-save-place" variant="primary" :disabled="view.busy" @click="lens.act('savePlace')">{{ t('Save place to Fieldbook') }}</UiButton>
            <UiButton @click="lens.act('focus')">{{ t('Return to selection') }}</UiButton>
            <UiButton @click="lens.act('openWorkspace', 'plan')">{{ t('Plan here') }}</UiButton>
            <UiButton @click="lens.act('openWorkspace', 'compare')">{{ t('Compare imagery') }}</UiButton>
          </div>
        </section>
        <section v-show="tab === 'evidence'" id="lens-tabpanel-evidence" role="tabpanel" aria-labelledby="lens-tab-evidence" tabindex="0">
          <p class="lens-explanation">{{ t('Observation time, retrieval time and feed update time are different. Unknown values remain unknown.') }}</p>
          <p v-if="!selectedEvidence.length" class="lens-empty">{{ t('No source metadata is attached to this selection yet.') }}</p>
          <article v-for="(row, index) in selectedEvidence" :key="`${row.scope}:${row.sourceId}:${index}`" class="lens-source">
            <h3>{{ row.sourceLabel }}</h3><span class="lens-kind">{{ kind(row.kind) }}</span>
            <dl class="lens-details">
              <div><dt>{{ t('Applicable time (UTC)') }}</dt><dd>{{ stamp(row.applicableTime) }}</dd></div>
              <div><dt>{{ t('Retrieved (UTC)') }}</dt><dd>{{ stamp(row.retrievedAt) }}</dd></div>
              <div><dt>{{ t('Native resolution') }}</dt><dd>{{ quality(row.resolutionM) }}</dd></div>
              <div><dt>{{ t('Spatial uncertainty') }}</dt><dd>{{ quality(row.uncertainty) }}</dd></div>
              <div><dt>{{ t('Coverage') }}</dt><dd>{{ coverage(row.coverage) }}</dd></div>
              <div><dt>{{ t('Source status') }}</dt><dd>{{ state(row.feedState) }}</dd></div>
            </dl>
            <p v-if="row.attribution" class="lens-attribution">{{ row.attribution }}</p>
            <p v-if="row.license" class="lens-attribution">{{ row.license }}</p>
          </article>
          <CorroborationCard />
          <section v-if="feeds.length" class="lens-feed-status">
            <h3>{{ t('Enabled source inventory') }}</h3>
            <p class="lens-explanation">{{ t('These are whole-layer states, not local coverage or observation counts for this place.') }}</p>
            <table><caption class="lens-sr-only">{{ t('Enabled sources and their last feed updates') }}</caption><thead><tr><th scope="col">{{ t('Source') }}</th><th scope="col">{{ t('Status') }}</th><th scope="col">{{ t('Feed update (UTC)') }}</th></tr></thead><tbody><tr v-for="row in feeds" :key="row.sourceId"><th scope="row">{{ row.sourceLabel }}</th><td>{{ state(row.feedState) }}</td><td>{{ stamp(row.feedUpdatedAt) }}</td></tr></tbody></table>
          </section>
          <UiButton @click="lens.act('refresh')">{{ t('Refresh source details') }}</UiButton>
        </section>
        <section v-show="tab === 'notes'" id="lens-tabpanel-notes" role="tabpanel" aria-labelledby="lens-tab-notes" tabindex="0">
          <label for="lens-note">{{ t('Note for this place') }}</label>
          <textarea id="lens-note" :value="view.note" maxlength="10000" rows="5" @input="lens.act('setNote', $event.target.value)"></textarea>
          <p class="lens-explanation">{{ t('Save this note to Fieldbook to keep it after closing the app.') }}</p>
          <div class="lens-actions"><UiButton id="lens-add-note" variant="primary" :disabled="view.busy || !view.note.trim()" @click="lens.act('addNote')">{{ t('Save note to Fieldbook') }}</UiButton><UiButton @click="lens.act('openWorkspace', 'library')">{{ t('Open Library') }}</UiButton></div>
        </section>
      </template>
      <p v-if="view?.error" class="lens-message lens-error" role="alert">{{ view.error }}</p>
      <p v-if="view?.feedback" class="lens-message" role="status">{{ view.feedback }}</p>
    </div>
  </RailPanel>
</template>
