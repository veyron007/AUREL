<script setup>
import { computed, markRaw, onBeforeUnmount, shallowRef, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { t } from '../../i18n/index.js';
import UiButton from '../kit/UiButton.vue';
import { usePanelChromeStore } from '../stores/panelChrome.js';
import { whenStartupSettled } from './deferredBody.js';

// A rail panel's body whose code is a separate chunk (PERFORMANCE-PLAN.md
// WP2.4). The panel's header, id and collapsed geometry stay in the start-up
// bundle; the body loads when its panel first opens, or once start-up has
// settled, whichever comes first. Until then a fixed-height placeholder holds
// the body's place, and the rail's observers remeasure when the body lands.
// A failed import shows a translated message with a retry.
const props = defineProps({
  /** The RailPanel's id, whose collapsed state opens the body. */
  panelId: { type: String, required: true },
  /** The panel's translated name, for the failure message. */
  name: { type: String, required: true },
  /** Imports the body component: () => import('./XBody.vue'). */
  load: { type: Function, required: true },
  /** Placeholder height in px while the body loads. */
  height: { type: Number, default: 160 },
});

const { panels } = storeToRefs(usePanelChromeStore());
const open = computed(() => panels.value[props.panelId]?.collapsed === false);
const body = shallowRef(null);
const failed = shallowRef(null);
let loading = null;
let alive = true;

function load() {
  if (body.value || loading) return loading;
  failed.value = null;
  loading = Promise.resolve()
    .then(props.load)
    .then(
      (module) => {
        if (alive) body.value = markRaw(module.default ?? module);
      },
      (error) => {
        if (!alive) return;
        console.warn(`[Panels] ${props.panelId} body failed to load:`, error);
        failed.value = error;
      },
    )
    .finally(() => {
      loading = null;
    });
  return loading;
}

watch(open, (isOpen) => isOpen && load(), { immediate: true });
whenStartupSettled().then(() => alive && !failed.value && load());
onBeforeUnmount(() => {
  alive = false;
});
</script>

<template>
  <component :is="body" v-if="body" />
  <div
    v-else-if="failed"
    class="deferred-panel-body deferred-panel-body--failed"
    role="alert"
  >
    <p>{{
      t('{name} could not be loaded. Check the connection and try again.', {
        name: props.name,
      })
    }}</p>
    <UiButton type="button" class="gev-action-button" @click="load">{{
      t('Try again')
    }}</UiButton>
  </div>
  <div
    v-else
    class="deferred-panel-body"
    aria-busy="true"
    :style="{ minHeight: `${props.height}px` }"
  ></div>
</template>
