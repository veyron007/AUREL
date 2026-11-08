<script setup>
import { t } from '../../../i18n/index.js';
import RailPanel from '../../rail/RailPanel.vue';
import DeferredPanelBody from '../../rail/DeferredPanelBody.vue';

// The panel's header stays in the start-up bundle; its body (LocalCommandsPanelBody.vue)
// loads on first open or once start-up settles (DeferredPanelBody).
const loadBody = () => import('./LocalCommandsPanelBody.vue');
</script>

<template>
  <RailPanel
    id="local-commands-panel"
    start-collapsed
    :title="t('Local commands')"
    :hint="t('Preview an explicit action before it runs')"
    scroll
  >
    <DeferredPanelBody panel-id="local-commands-panel" :name="t('Local commands')" :load="loadBody" />
  </RailPanel>
</template>
