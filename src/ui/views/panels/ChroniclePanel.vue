<script setup>
import { t } from '../../../i18n/index.js';
import RailPanel from '../../rail/RailPanel.vue';
import DeferredPanelBody from '../../rail/DeferredPanelBody.vue';

// The panel's header stays in the start-up bundle; its body (ChroniclePanelBody.vue)
// loads on first open or once start-up settles (DeferredPanelBody).
const loadBody = () => import('./ChroniclePanelBody.vue');
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
    <DeferredPanelBody panel-id="chronicle-panel" :name="t('Chronicle')" :load="loadBody" />
  </RailPanel>
</template>
