<script setup>
import { t } from '../../../i18n/index.js';
import RailPanel from '../../rail/RailPanel.vue';
import DeferredPanelBody from '../../rail/DeferredPanelBody.vue';

// The panel's header stays in the start-up bundle; its body (OrbitWitnessPanelBody.vue)
// loads on first open or once start-up settles (DeferredPanelBody).
const loadBody = () => import('./OrbitWitnessPanelBody.vue');
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
    <DeferredPanelBody panel-id="orbit-witness-panel" :name="t('Orbit Witness')" :load="loadBody" />
  </RailPanel>
</template>
