<script setup>
import { t } from '../../../i18n/index.js';
import RailPanel from '../../rail/RailPanel.vue';
import DeferredPanelBody from '../../rail/DeferredPanelBody.vue';

// The panel's header stays in the start-up bundle; its body (LensPanelBody.vue)
// loads on first open or once start-up settles (DeferredPanelBody).
const loadBody = () => import('./LensPanelBody.vue');
</script>

<template>
  <RailPanel id="lens-panel" start-collapsed :title="t('Lens')" :hint="t('Inspect a place and understand its sources')" scroll>
    <DeferredPanelBody panel-id="lens-panel" :name="t('Lens')" :load="loadBody" />
  </RailPanel>
</template>
