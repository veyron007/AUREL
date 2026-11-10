<script setup>
import { t } from '../../../i18n/index.js';
import RailPanel from '../../rail/RailPanel.vue';
import DeferredPanelBody from '../../rail/DeferredPanelBody.vue';

// The panel's header stays in the start-up bundle; its body (ResearchPanelBody.vue)
// loads on first open or once start-up settles (DeferredPanelBody).
const loadBody = () => import('./ResearchPanelBody.vue');
</script>

<template>
  <RailPanel
    id="research-panel"
    start-collapsed
    :title="t('Research')"
    :hint="
      t('Inspect a bounded Sentinel-2 science raster with its source metadata')
    "
    scroll
  >
    <DeferredPanelBody panel-id="research-panel" :name="t('Research')" :load="loadBody" />
  </RailPanel>
</template>
