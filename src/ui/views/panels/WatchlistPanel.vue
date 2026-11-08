<script setup>
import { t } from '../../../i18n/index.js';
import RailPanel from '../../rail/RailPanel.vue';
import DeferredPanelBody from '../../rail/DeferredPanelBody.vue';

// The panel's header stays in the start-up bundle; its body (WatchlistPanelBody.vue)
// loads on first open or once start-up settles (DeferredPanelBody).
const loadBody = () => import('./WatchlistPanelBody.vue');
</script>

<template>
  <RailPanel
    id="watchlist-panel"
    start-collapsed
    :title="t('Watch areas')"
    :hint="
      t('Explicit local checks for saved places, with honest source status')
    "
    scroll
  >
    <DeferredPanelBody panel-id="watchlist-panel" :name="t('Watch areas')" :load="loadBody" />
  </RailPanel>
</template>
