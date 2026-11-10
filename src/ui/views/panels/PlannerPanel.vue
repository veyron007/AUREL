<script setup>
import { t } from '../../../i18n/index.js';
import RailPanel from '../../rail/RailPanel.vue';
import DeferredPanelBody from '../../rail/DeferredPanelBody.vue';

// The panel's header stays in the start-up bundle; its body (PlannerPanelBody.vue)
// loads on first open or once start-up settles (DeferredPanelBody).
const loadBody = () => import('./PlannerPanelBody.vue');
</script>

<template>
  <RailPanel
    id="planner-panel"
    start-collapsed
    :title="t('Planner')"
    :hint="t('Terrain, daylight and forecast context for a place or route')"
    scroll
  >
    <DeferredPanelBody panel-id="planner-panel" :name="t('Planner')" :load="loadBody" />
  </RailPanel>
</template>
