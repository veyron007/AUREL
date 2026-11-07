<script setup>
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { t } from '../../i18n/index.js';
import { useWorkspaceStore, WORKSPACE_DESTINATIONS, WORKSPACE_APPEARANCES } from '../stores/workspace.js';
import { usePanelStore } from '../stores/panels.js';
import { PANEL_RAIL_ITEMS } from '../panelRailCatalog.js';
import { useDisplayStore } from '../stores/display.js';
import { useLocationStore } from '../stores/location.js';

const workspace = useWorkspaceStore();
const panels = usePanelStore();
const display = useDisplayStore();
const location = useLocationStore();
const placeLabel = computed(() => {
  const city = location.view?.status?.city;
  return !city || city === t('📍 Location: --') ? t('Explore the globe') : city;
});
const tools = computed(() => [...panels.sides.left, ...panels.sides.right].filter((panel) => panel.available));
const activePanel = computed(() => tools.value.find((panel) => panel.open));
const preferred = {
  explore: ['lens-panel', 'data-panel', 'global-context-panel', 'cctv-panel', 'street-level-panel', 'weather-panel'],
  compare: ['chronicle-panel', 'research-panel', 'recent-imagery-panel', 'data-panel'],
  plan: ['planner-panel', 'raindrop-panel', 'utilities-panel', 'weather-panel', 'data-panel'],
  library: ['fieldbook-panel', 'watchlist-panel', 'region-panel', 'local-commands-panel', 'scene-panel', 'utilities-panel'],
};
const primaryTools = computed(() => tools.value.filter((panel) => preferred[workspace.destination].includes(panel.id)));
const otherTools = computed(() => tools.value.filter((panel) => !preferred[workspace.destination].includes(panel.id)));
const panelLabel = (panel) => PANEL_RAIL_ITEMS[panel.id] ? t(PANEL_RAIL_ITEMS[panel.id].label) : panel.title;
const pausing = ref(false);
const pauseStatus = ref('');
async function pauseFeeds() {
  if (pausing.value) return;
  pausing.value = true;
  pauseStatus.value = '';
  try {
    const result = await workspace.act('pauseFeeds');
    pauseStatus.value = result?.ok ? t('Feeds paused. Enable a layer or watch to resume it.') : t('Some work could not stop. Check active layers and watches.');
  } catch {
    pauseStatus.value = t('Some work could not stop. Check active layers and watches.');
  } finally { pausing.value = false; }
}
let stop;
onMounted(() => {
  workspace.restoreAppearance();
  stop = watch(() => [workspace.appearance, workspace.destination, workspace.sheetSize, activePanel.value?.id], ([appearance, destination, size, panel]) => {
    document.body.dataset.workspaceAppearance = appearance;
    document.body.dataset.workspaceDestination = destination;
    document.body.dataset.workspaceSheet = size;
    document.body.dataset.workspaceInspector = panel || "";
  }, { immediate: true });
});
onBeforeUnmount(() => {
  stop?.();
  for (const key of ['workspaceAppearance', 'workspaceDestination', 'workspaceSheet', 'workspaceInspector']) delete document.body.dataset[key];
});
function openPanel(id) {
  if (workspace.sheetSize === 'collapsed') workspace.setSheetSize('half');
  workspace.act('openPanel', id);
}
</script>

<template>
  <div id="aurel-workspace">
    <header id="aurel-workspace-topbar" class="workspace-topbar">
      <div class="workspace-context"><span>{{ placeLabel }}</span></div>
      <div class="workspace-source" role="status"><span class="workspace-status-dot" aria-hidden="true"></span>{{ display.mapSource?.status?.text || t('Loading') }}</div>
      <label class="workspace-appearance"><span>{{ t('Appearance') }}</span><select :value="workspace.appearance" @change="workspace.setAppearance($event.target.value)"><option v-for="item in WORKSPACE_APPEARANCES" :key="item.id" :value="item.id">{{ t(item.label) }}</option></select></label>
    </header>
    <nav id="aurel-workspace-nav" class="workspace-nav" :aria-label="t('Workspace')">
      <button v-for="item in WORKSPACE_DESTINATIONS" :key="item.id" type="button" :data-workspace="item.id" :aria-pressed="workspace.destination === item.id" @click="workspace.chooseDestination(item.id)"><span class="material-symbols-outlined" aria-hidden="true">{{ item.icon }}</span><span>{{ t(item.label) }}</span></button>
    </nav>
    <section id="aurel-workspace-tools" class="workspace-tools" :aria-label="t('Workspace tools')">
      <div class="workspace-tools-heading">{{ t(WORKSPACE_DESTINATIONS.find((item) => item.id === workspace.destination).label) }}</div>
      <button v-for="panel in primaryTools" :key="panel.id" type="button" :aria-pressed="activePanel?.id === panel.id" @click="openPanel(panel.id)"><span class="material-symbols-outlined" aria-hidden="true">{{ PANEL_RAIL_ITEMS[panel.id]?.icon || 'more_horiz' }}</span>{{ panelLabel(panel) }}</button>
      <p v-if="workspace.destination === 'compare' && !tools.some((panel) => panel.id === 'recent-imagery-panel')" class="workspace-tool-hint">{{ t('Enable Recent Imagery in Data Layers to compare available captures.') }}</p>
      <details class="workspace-all-tools"><summary>{{ t('All tools') }}</summary><button v-for="panel in otherTools" :key="panel.id" type="button" :aria-pressed="activePanel?.id === panel.id" @click="openPanel(panel.id)">{{ panelLabel(panel) }}</button><button type="button" @click="workspace.act('openTray', 'location-bar')">{{ t('LOCATION') }}</button><button type="button" @click="workspace.act('openTray', 'control-panel')">{{ t('VISUAL PRESETS') }}</button></details>
      <button type="button" data-pause-feeds :disabled="pausing" :title="t('Stop live feeds, local watches and pending analyses. Saved work stays open.')" @click="pauseFeeds">{{ pausing ? t('Pausing feeds…') : t('Pause feeds') }}</button>
      <p v-if="pauseStatus" class="workspace-session-status workspace-tool-hint" role="status">{{ pauseStatus }}</p>
    </section>
    <div v-if="activePanel" id="aurel-workspace-sheet-controls" class="workspace-sheet-controls" role="group" :aria-label="t('Inspector size')">
      <span class="workspace-sheet-title">{{ panelLabel(activePanel) }}</span>
      <button type="button" :aria-pressed="workspace.sheetSize === 'collapsed'" @click="workspace.setSheetSize('collapsed')" :aria-label="t('Minimize inspector')">⌄</button>
      <button type="button" :aria-pressed="workspace.sheetSize === 'half'" @click="workspace.setSheetSize('half')" :aria-label="t('Half-height inspector')">↕</button>
      <button type="button" :aria-pressed="workspace.sheetSize === 'full'" @click="workspace.setSheetSize('full')" :aria-label="t('Full-height inspector')">⌃</button>
    </div>
  </div>
</template>
