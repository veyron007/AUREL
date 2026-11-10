<script setup>
import { t } from '../../../i18n/index.js';
import RailPanel from '../../rail/RailPanel.vue';
import DeferredPanelBody from '../../rail/DeferredPanelBody.vue';

// The panel's header stays in the start-up bundle; its body (FieldbookPanelBody.vue)
// loads on first open or once start-up settles (DeferredPanelBody).
const loadBody = () => import('./FieldbookPanelBody.vue');
</script>

<template>
  <RailPanel id="fieldbook-panel" start-collapsed :title="t('Fieldbook')" :hint="t('Your places, notes and evidence, saved on this device')" scroll>
    <DeferredPanelBody panel-id="fieldbook-panel" :name="t('Fieldbook')" :load="loadBody" />
  </RailPanel>
</template>
