<script setup>
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { t } from '../../../i18n/index.js';
import { useRegionsStore } from '../../stores/regions.js';
const regions = useRegionsStore();
const { view } = storeToRefs(regions);
const query = ref('');
watch(
  () => view.value?.query,
  (value) => {
    query.value = typeof value === 'string' ? value : '';
  },
);
const manifest = computed(() => view.value?.manifest);
const totalBytes = computed(
  () =>
    manifest.value?.assets.reduce(
      (total, asset) => total + asset.byteLength,
      0,
    ) ?? 0,
);
const stamp = (value) =>
  value == null
    ? t('Unknown')
    : new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
const bytes = (value) =>
  t('{value} bytes', { value: Number(value).toLocaleString() });
const status = computed(() =>
  view.value?.loaded
    ? t('Verified and loaded')
    : ({
        empty: t('No region pack loaded'),
        previewing: t('Reading pack metadata'),
        preview: t('Verification pending'),
        loading: t('Verifying local files'),
        error: t('Region pack unavailable'),
      }[view.value?.status] ?? t('No region pack loaded')),
);
const countRows = computed(() =>
  manifest.value
    ? [
        [t('Road features'), manifest.value.counts.roads],
        [t('Building footprints'), manifest.value.counts.buildings],
        [t('Water features'), manifest.value.counts.water],
        [t('Place features'), manifest.value.counts.places],
        [t('Included names'), manifest.value.counts.names],
        [
          t('Features with supplied heights'),
          manifest.value.counts.suppliedHeights,
        ],
      ]
    : [],
);
const kind = (value) =>
  ({
    road: t('Road'),
    building: t('Building'),
    water: t('Water'),
    place: t('Place'),
  })[value] ?? t('Map feature');
function search() {
  regions.act('search', query.value);
}
</script>
<template>
    <div class="region-workspace" :aria-busy="Boolean(view?.busy)">
      <header class="region-intro"
        ><span class="region-eyebrow">{{
          t('Open geography, kept local')
        }}</span
        ><h2>{{ manifest?.name || t('Dehradun core') }}</h2
        ><p>{{
          t(
            'Inspect the bundled streets, footprints, water and names before adding them to the map.',
          )
        }}</p></header
      >
      <div class="region-actions"
        ><button
          id="region-preview"
          type="button"
          :disabled="view?.busy"
          @click="regions.act('preview')"
          >{{ t('Preview bundled pack') }}</button
        ><button
          v-if="view?.canCancel"
          id="region-cancel"
          type="button"
          @click="regions.act('cancel')"
          >{{ t('Cancel') }}</button
        ></div
      >
      <p class="region-state" role="status">{{ status }}</p
      ><p
        v-if="view?.error"
        class="region-notice region-notice--error"
        role="alert"
        >{{ view.error }}</p
      >
      <details v-if="manifest" class="region-pack-details" :open="!view?.loaded"
        ><summary>{{ t('Pack details') }}</summary
        ><section class="region-preview" :aria-label="t('Local pack preview')"
          ><div class="region-preview-heading"
            ><strong>{{ t('Partial coverage') }}</strong
            ><span>{{ bytes(totalBytes) }}</span></div
          ><p class="region-help">{{
            t(
              'This is a bounded extract. Missing features do not establish that they are absent on the ground.',
            )
          }}</p
          ><dl class="region-counts"
            ><div v-for="[label, count] in countRows" :key="label"
              ><dt>{{ label }}</dt
              ><dd>{{ count.toLocaleString() }}</dd></div
            ></dl
          ><p class="region-help">{{
            t('Buildings are footprints unless the source supplies a height.')
          }}</p
          ><dl class="region-source-details"
            ><dt>{{ t('Area bounds') }}</dt
            ><dd
              >{{ manifest.extent.join('°, ') }}°<small>{{
                t('West, south, east, north')
              }}</small></dd
            ><dt>{{ t('Source') }}</dt
            ><dd>{{ manifest.source.label }}</dd
            ><dt>{{ t('Source extract date') }}</dt
            ><dd>{{ stamp(manifest.source.extractAt) }}</dd
            ><dt>{{ t('Retrieved') }}</dt
            ><dd>{{ stamp(manifest.source.retrievedAt) }}</dd
            ><dt>{{ t('License') }}</dt
            ><dd>{{ manifest.license.id }}</dd></dl
          ><p class="region-help">{{ manifest.license.attribution }}</p
          ><div class="region-source-links"
            ><a
              :href="manifest.source.url"
              target="_blank"
              rel="noopener noreferrer"
              >{{ t('View source extract') }}</a
            ><a
              :href="manifest.license.url"
              target="_blank"
              rel="noopener noreferrer"
              >{{ t('Read license') }}</a
            ></div
          ><details class="region-integrity"
            ><summary>{{ t('Local files and integrity') }}</summary
            ><p class="region-help">{{
              t(
                'Loading verifies each local file against its declared size and SHA-256 before rendering.',
              )
            }}</p
            ><ul class="region-assets"
              ><li v-for="asset in manifest.assets" :key="asset.id"
                ><strong>{{ asset.path }}</strong
                ><span>{{ bytes(asset.byteLength) }}</span
                ><span class="region-help">{{ t('Expected SHA-256') }}</span
                ><code>{{ asset.sha256 }}</code></li
              ></ul
            ><p class="region-help">{{ t('Source extract SHA-256') }}</p
            ><code>{{ manifest.source.extractSha256 }}</code></details
          ><p
            v-for="(limitation, index) in manifest.limitations"
            :key="index"
            class="region-notice"
            >{{ limitation }}</p
          ><p class="region-help">{{
            t('These local files do not include map imagery or terrain.')
          }}</p></section
        ></details
      >
      <div class="region-actions"
        ><button
          id="region-enable"
          type="button"
          class="region-primary"
          :disabled="!view?.canEnable || view?.busy"
          @click="regions.act('enable')"
          >{{ t('Verify and load on map') }}</button
        ><button
          id="region-remove"
          type="button"
          :disabled="!view?.canRemove || view?.busy"
          @click="regions.act('remove')"
          >{{ t('Remove from map') }}</button
        ></div
      >
      <section class="region-section" :aria-label="t('Search included names')"
        ><div class="region-section-heading"
          ><h3>{{ t('Find it in this pack') }}</h3
          ><span class="region-tag">{{ t('Local search') }}</span></div
        ><form id="region-search-form" @submit.prevent="search"
          ><label for="region-search">{{
            t('Included place or street name')
          }}</label
          ><input
            id="region-search"
            v-model="query"
            type="search"
            maxlength="160"
            autocomplete="off"
            :disabled="!view?.indexReady || view?.busy"
            @input="search"
          /><p v-if="!view?.indexReady" class="region-help">{{
            t('Load and verify the pack to search its included names.')
          }}</p
          ><p v-else class="region-help">{{
            t(
              'Search stays inside the verified local index. It does not query a provider.',
            )
          }}</p></form
        ><p
          v-if="view?.indexReady && view.query && !view.results.length"
          class="region-empty"
          role="status"
          >{{ t('No matching names in this local pack.') }}</p
        ><ul class="region-results"
          ><li v-for="result in view?.results ?? []" :key="result.id"
            ><button
              type="button"
              :data-region-result="result.id"
              :disabled="!view?.indexReady || view?.busy"
              @click="regions.act('focus', result.id)"
              ><span
                ><strong>{{ result.name }}</strong
                ><small>{{ kind(result.kind) }}</small></span
              ><span class="region-result-coordinate"
                >{{ result.lat.toFixed(4) }}°,
                {{ result.lon.toFixed(4) }}°</span
              ></button
            ></li
          ></ul
        ></section
      >
    </div>
</template>
