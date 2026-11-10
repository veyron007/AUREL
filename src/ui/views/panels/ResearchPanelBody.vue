<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { t } from '../../../i18n/index.js';
import { useResearchStore } from '../../stores/research.js';
const research = useResearchStore();
const { view } = storeToRefs(research);
const startDate = ref(''),
  endDate = ref(''),
  size = ref(128),
  canvas = ref(null),
  canvasError = ref(false);
const latestDate = new Date().toISOString().slice(0, 10);
const endLimit = computed(() => {
  const start = Date.parse(startDate.value);
  return Number.isFinite(start)
    ? new Date(Math.min(start + 30 * 86400000, Date.parse(latestDate)))
        .toISOString()
        .slice(0, 10)
    : latestDate;
});
const resultStart = ref(null);
const available = computed(() => {
  const value = view.value?.result;
  return value?.status === 'available' && value.grid && value.statistics
    ? value
    : null;
});
const validFraction = computed(() =>
  available.value?.statistics.totalPixels > 0
    ? `${((available.value.statistics.validPixels / available.value.statistics.totalPixels) * 100).toFixed(1)}%`
    : t('Unknown'),
);
const stamp = (value) =>
  value == null
    ? t('Unknown')
    : new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
const decimal = (value) =>
  value == null ? t('Unknown') : Number(value).toFixed(3);
const status = computed(
  () =>
    ({
      empty: t('Choose a place and scene'),
      searching: t('Searching Sentinel scenes'),
      analyzing: t('Reading a bounded science raster'),
      ready: available.value
        ? t('Research result ready')
        : t('Scenes ready to inspect'),
      error: t('Research unavailable'),
      cancelled: t('Research cancelled'),
    })[view.value?.status] ?? t('Choose a place and scene'),
);
function search() {
  research.act('search', {
    startDate: startDate.value,
    endDate: endDate.value,
  });
}
async function analyze() {
  const previous = available.value;
  const completed = await research.act('analyze', { size: Number(size.value) });
  if (!completed || !available.value || available.value === previous) return;
  await nextTick();
  const target = resultStart.value;
  const scroller = target?.closest('.research-panel-inner');
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
function color(value) {
  const low = value < 0 ? [93, 107, 141] : [189, 166, 121],
    high = value < 0 ? [189, 166, 121] : [80, 128, 104],
    fraction = value < 0 ? value + 1 : value;
  return low.map((channel, index) =>
    Math.round(channel + (high[index] - channel) * fraction),
  );
}
watch(
  [available, canvas],
  ([result, target]) => {
    if (!result || !target) return;
    canvasError.value = false;
    try {
      const { width, height } = result.grid;
      if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width < 1 ||
        height < 1 ||
        width > 256 ||
        height > 256 ||
        result.values.length !== width * height
      )
        throw new Error('invalid raster');
      target.width = width;
      target.height = height;
      const context = target.getContext('2d');
      if (!context) throw new Error('canvas unavailable');
      const pixels = context.createImageData(width, height);
      result.values.forEach((value, index) => {
        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value < -1 ||
          value > 1
        )
          return;
        const rgb = color(value);
        pixels.data.set([...rgb, 255], index * 4);
      });
      context.putImageData(pixels, 0, 0);
    } catch {
      canvasError.value = true;
    }
  },
  { flush: 'post' },
);
</script>
<template>
    <div class="research-workspace" :aria-busy="Boolean(view?.busy)">
      <header class="research-intro"
        ><span class="research-eyebrow">{{
          t('A closer look at the data')
        }}</span
        ><h2>{{ view?.selection?.name || t('Select a place in Lens') }}</h2
        ><p>{{
          t(
            'Compute NDVI from Sentinel-2 surface reflectance. Display imagery is never used as science data.',
          )
        }}</p></header
      >
      <details class="research-search-settings" :open="!view?.scenes?.length"
        ><summary>{{ t('Scene search window') }}</summary
        ><form id="research-search-form" @submit.prevent="search"
          ><p class="research-help">{{
            t(
              'Choose up to 31 past UTC days. Searching does not download a science raster.',
            )
          }}</p
          ><div class="research-date-fields"
            ><div
              ><label for="research-start">{{ t('Window starts') }}</label
              ><input
                id="research-start"
                v-model="startDate"
                type="date"
                required
                min="2015-01-01"
                :max="latestDate"
                :disabled="view?.busy" /></div
            ><div
              ><label for="research-end">{{ t('Window ends') }}</label
              ><input
                id="research-end"
                v-model="endDate"
                type="date"
                required
                :min="startDate || '2015-01-01'"
                :max="endLimit"
                :disabled="view?.busy" /></div></div></form
      ></details>
      <div class="research-actions"
        ><button
          id="research-search"
          type="submit"
          form="research-search-form"
          :disabled="!view?.selection || view?.busy"
          >{{ t('Find Sentinel scenes') }}</button
        ><button
          v-if="view?.canCancel"
          id="research-cancel"
          type="button"
          @click="research.act('cancel')"
          >{{ t('Cancel') }}</button
        ></div
      >
      <p class="research-state" role="status">{{ status }}</p
      ><p
        v-if="view?.error"
        class="research-notice research-notice--error"
        role="alert"
        >{{ view.error }}</p
      ><p v-if="view?.feedback" class="research-notice" role="status">{{
        view.feedback
      }}</p>
      <section
        v-if="view?.scenes?.length"
        class="research-section"
        :aria-label="t('Available Sentinel scenes')"
        ><h3>{{ t('Choose an acquisition') }}</h3
        ><p class="research-help">{{
          t(
            'Cloud percentages describe the whole scene, not the small area you will inspect.',
          )
        }}</p
        ><ul class="research-scenes"
          ><li v-for="scene in view.scenes" :key="scene.id"
            ><button
              type="button"
              :aria-pressed="view.selectedSceneId === scene.id"
              :disabled="view.busy"
              @click="research.act('choose', scene.id)"
              ><strong>{{ stamp(scene.acquiredAt) }}</strong
              ><span
                >{{ t('Scene cloud cover') }}:
                {{
                  scene.cloudCoverPct == null
                    ? t('Unknown')
                    : t('{value}%', { value: scene.cloudCoverPct })
                }}</span
              ><small>{{ scene.id }}</small></button
            ></li
          ></ul
        ></section
      >
      <section
        class="research-section research-controls"
        :aria-label="t('Bounded raster analysis')"
        ><label for="research-size">{{
          t('Area around the selected point')
        }}</label
        ><select id="research-size" v-model.number="size" :disabled="view?.busy"
          ><option :value="128">{{
            t('128 × 128 pixels · 1.28 km square')
          }}</option
          ><option :value="256">{{
            t('256 × 256 pixels · 2.56 km square')
          }}</option></select
        ><p class="research-help">{{
          t(
            'Reflectance uses the native 10 m grid. The categorical scene mask is 20 m and uses nearest-neighbor sampling.',
          )
        }}</p
        ><div ref="resultStart" class="research-actions"
          ><button
            id="research-analyze"
            type="button"
            class="research-primary"
            :disabled="!view?.canAnalyze || view?.busy"
            @click="analyze"
            >{{ t('Analyze NDVI') }}</button
          ><button
            id="research-export"
            type="button"
            :disabled="!view?.canExport || !available || view?.busy"
            @click="research.act('exportResult')"
            >{{ t('Export raster JSON') }}</button
          ></div
        ></section
      >
      <template v-if="available">
        <section
          class="research-section research-result"
          :aria-label="t('NDVI result')"
          ><div class="research-heading"
            ><h3>{{ t('NDVI') }}</h3
            ><span class="research-tag">{{
              t('Native science pixels')
            }}</span></div
          ><p class="research-help"
            >{{ t('Acquired') }} {{ stamp(available.acquiredAt) }}</p
          ><figure class="research-figure"
            ><canvas
              id="research-heatmap"
              ref="canvas"
              role="img"
              :aria-label="
                t(
                  'NDVI raster. Masked and missing pixels are transparent; see statistics and JSON for the values.',
                )
              "
            ></canvas
            ><figcaption
              ><div class="research-legend" aria-hidden="true"></div
              ><div class="research-legend-labels"
                ><span>−1</span><span>0</span><span>+1</span></div
              ><p class="research-help"
                ><span class="research-missing-swatch" aria-hidden="true"></span
                >{{ t('Masked or missing pixels; not zero NDVI') }}</p
              ></figcaption
            ></figure
          ><p v-if="canvasError" class="research-notice" role="alert">{{
            t(
              'This browser could not draw the raster. Export JSON to inspect the values.',
            )
          }}</p
          ><dl class="research-metrics"
            ><div
              ><dt>{{ t('Valid fraction') }}</dt
              ><dd>{{ validFraction }}</dd></div
            ><div
              ><dt>{{ t('Valid pixels') }}</dt
              ><dd
                >{{ available.statistics.validPixels }} /
                {{ available.statistics.totalPixels }}</dd
              ></div
            ><div
              ><dt>{{ t('Minimum NDVI') }}</dt
              ><dd>{{ decimal(available.statistics.min) }}</dd></div
            ><div
              ><dt>{{ t('Maximum NDVI') }}</dt
              ><dd>{{ decimal(available.statistics.max) }}</dd></div
            ><div
              ><dt>{{ t('Mean NDVI') }}</dt
              ><dd>{{ decimal(available.statistics.mean) }}</dd></div
            ><div
              ><dt>{{ t('Masked pixels') }}</dt
              ><dd>{{ available.statistics.maskedPixels }}</dd></div
            ></dl
          ><p class="research-help">{{
            t(
              'NDVI is a spectral index. A single scene does not establish vegetation health or change over time.',
            )
          }}</p></section
        >
        <section class="research-section" :aria-label="t('Science provenance')"
          ><h3>{{ t('Science provenance') }}</h3
          ><p>{{ available.provenance.sourceLabel }}</p
          ><p class="research-formula">{{ available.provenance.method }}</p
          ><dl class="research-source-details"
            ><dt>{{ t('Retrieved') }}</dt
            ><dd>{{ stamp(available.retrievedAt) }}</dd
            ><dt>{{ t('Reflectance grid') }}</dt
            ><dd
              >{{ t('{value} m', { value: available.grid.resolutionM }) }} ·
              {{ available.grid.width }} × {{ available.grid.height }}</dd
            ><dt>{{ t('Categorical mask') }}</dt
            ><dd
              >{{ available.provenance.mask.source }} ·
              {{
                t('{value} m', { value: available.provenance.mask.resolutionM })
              }}</dd
            ><dt>{{ t('Mask resampling') }}</dt
            ><dd>{{
              available.provenance.mask.resampling === 'nearest'
                ? t('Nearest neighbor')
                : t('Unknown')
            }}</dd
            ><dt>{{ t('Processing baseline') }}</dt
            ><dd>{{ available.provenance.processingBaseline }}</dd
            ><dt>{{ t('Reference system') }}</dt
            ><dd>{{ `EPSG:${available.grid.epsg}` }}</dd
            ><dt>{{ t('License') }}</dt
            ><dd>{{ available.provenance.license }}</dd></dl
          ><details class="research-details"
            ><summary>{{ t('Band scaling and transfer details') }}</summary
            ><div class="research-table-scroll"
              ><table
                ><caption>{{
                  t('Reflectance = stored value × scale + offset')
                }}</caption
                ><thead
                  ><tr
                    ><th scope="col">{{ t('Band') }}</th
                    ><th scope="col">{{ t('Scale') }}</th
                    ><th scope="col">{{ t('Offset') }}</th
                    ><th scope="col">{{ t('No data') }}</th></tr
                  ></thead
                ><tbody
                  ><tr
                    v-for="band in available.provenance.bands"
                    :key="band.name"
                    ><th scope="row">{{ band.name }}</th
                    ><td>{{ band.scale }}</td
                    ><td>{{ band.offset }}</td
                    ><td>{{ band.noData }}</td></tr
                  ></tbody
                ></table
              ></div
            ><dl class="research-source-details"
              ><dt>{{ t('Accepted mask classes') }}</dt
              ><dd>{{
                available.provenance.mask.acceptedClasses.join(', ')
              }}</dd
              ><dt>{{ t('Minimum denominator') }}</dt
              ><dd>{{ available.provenance.minimumDenominator }}</dd
              ><dt>{{ t('Grid transform') }}</dt
              ><dd>{{ available.grid.transform.join(', ') }}</dd
              ><dt>{{ t('Transferred bytes') }}</dt
              ><dd
                >{{ available.transfer.bytes.toLocaleString() }} /
                {{ available.transfer.maxBytes.toLocaleString() }}</dd
              ><dt>{{ t('Range requests') }}</dt
              ><dd
                >{{ available.transfer.requests }} /
                {{ available.transfer.maxRequests }}</dd
              ></dl
            ></details
          ><p
            v-for="(limitation, index) in available.provenance.limitations"
            :key="index"
            class="research-help"
            >{{ limitation }}</p
          ><p class="research-help">{{ available.provenance.attribution }}</p
          ><a
            v-if="available.provenance.link"
            :href="available.provenance.link"
            target="_blank"
            rel="noopener noreferrer"
            >{{ t('Open source') }}</a
          ></section
        >
      </template>
    </div>
</template>
