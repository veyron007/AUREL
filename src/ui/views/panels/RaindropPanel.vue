<script setup>
import { t } from '../../../i18n/index.js';
import RailPanel from '../../rail/RailPanel.vue';
import DeferredPanelBody from '../../rail/DeferredPanelBody.vue';

// The panel's header stays in the start-up bundle; its body (RaindropPanelBody.vue)
// loads on first open or once start-up settles (DeferredPanelBody).
const loadBody = () => import('./RaindropPanelBody.vue');
</script>

<template>
  <RailPanel
    id="raindrop-panel"
    start-collapsed
    :title="t('Raindrop')"
    :hint="t('Where water goes, and what fell on it')"
    scroll
  >
    <DeferredPanelBody panel-id="raindrop-panel" :name="t('Raindrop')" :load="loadBody" />
  </RailPanel>
</template>
