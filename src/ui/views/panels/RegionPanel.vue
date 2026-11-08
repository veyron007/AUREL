<script setup>
import { t } from '../../../i18n/index.js';
import RailPanel from '../../rail/RailPanel.vue';
import DeferredPanelBody from '../../rail/DeferredPanelBody.vue';

// The panel's header stays in the start-up bundle; its body (RegionPanelBody.vue)
// loads on first open or once start-up settles (DeferredPanelBody).
const loadBody = () => import('./RegionPanelBody.vue');
</script>

<template>
  <RailPanel
    id="region-panel"
    start-collapsed
    :title="t('Region packs')"
    :hint="
      t(
        'Load a bounded local extract with its source, license and integrity checks',
      )
    "
    scroll
  >
    <DeferredPanelBody panel-id="region-panel" :name="t('Region packs')" :load="loadBody" />
  </RailPanel>
</template>
