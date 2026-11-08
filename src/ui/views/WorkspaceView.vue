<script setup>
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { t } from '../../i18n/index.js';
import { useWorkspaceStore, WORKSPACE_DESTINATIONS, WORKSPACE_APPEARANCES } from '../stores/workspace.js';
import { usePanelStore } from '../stores/panels.js';
import { PANEL_RAIL_ITEMS } from '../panelRailCatalog.js';
import { useDisplayStore } from '../stores/display.js';
import { useLocationStore } from '../stores/location.js';
import { useQualityStore, QUALITY_MODES } from '../stores/quality.js';
import AgentWritesToggle from './panels/AgentWritesToggle.vue';
import CommandPalette from './panels/CommandPalette.vue';
import { ChromeRest, chromeHeldAwake } from '../chromeRest.js';

const workspace = useWorkspaceStore();
const panels = usePanelStore();
const display = useDisplayStore();
const location = useLocationStore();
const quality = useQualityStore();
// What adaptive quality applies now (src/app/qualityGovernor.js levels).
const QUALITY_STEPS = 3;
const qualityStatus = computed(() =>
  quality.level > 0
    ? t('Now: reduced, step {step} of {steps}', { step: quality.level, steps: QUALITY_STEPS })
    : t('Now: full quality'),
);
// Only a real place is named; the pin is the tray's decoration, not the name.
const placeLabel = computed(() => {
  const city = location.view?.status?.city;
  if (!city || city === t('📍 Location: --')) return '';
  return city.replace(/^📍\s*/u, '').trim();
});
// The imagery stamp names the active map source in full when it is known.
const imagerySource = computed(() => {
  const source = display.mapSource;
  const active = source?.chips?.find((chip) => chip.active);
  return active?.label || source?.status?.text || t('Loading');
});
const tools = computed(() => [...panels.sides.left, ...panels.sides.right].filter((panel) => panel.available));
const activePanel = computed(() => tools.value.find((panel) => panel.open));
const preferred = {
  explore: ['lens-panel', 'data-panel', 'global-context-panel', 'cctv-panel', 'street-level-panel', 'weather-panel'],
  compare: ['chronicle-panel', 'research-panel', 'orbit-witness-panel', 'recent-imagery-panel', 'data-panel'],
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
let chromeRest;
onMounted(() => {
  // Chrome rests after a quiet spell; anything open or focused holds it awake.
  chromeRest = new ChromeRest({ target: document.body, events: window, isHeld: () => chromeHeldAwake(document) });
  chromeRest.start();
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
  chromeRest?.destroy();
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
      <div v-if="placeLabel" class="workspace-context" :title="placeLabel"><span class="material-symbols-outlined" aria-hidden="true">location_on</span><span>{{ placeLabel }}</span></div>
    </header>
    <div class="workspace-source workspace-imagery-stamp" role="status" :aria-label="t('Map source')"><span class="workspace-status-dot" aria-hidden="true"></span><span class="workspace-stamp-label">{{ t('Imagery') }}</span><span class="workspace-stamp-value">{{ imagerySource }}</span></div>
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
      <AgentWritesToggle />
      <details class="workspace-settings"><summary>{{ t('Settings') }}</summary><label class="workspace-appearance"><span>{{ t('Appearance') }}</span><select :value="workspace.appearance" @change="workspace.setAppearance($event.target.value)"><option v-for="item in WORKSPACE_APPEARANCES" :key="item.id" :value="item.id">{{ t(item.label) }}</option></select></label><label class="workspace-appearance workspace-quality"><span>{{ t('Display quality') }}</span><select :value="quality.mode" @change="quality.setMode($event.target.value)"><option v-for="item in QUALITY_MODES" :key="item.id" :value="item.id">{{ t(item.label) }}</option></select></label><p class="workspace-tool-hint workspace-quality-status" role="status">{{ qualityStatus }}</p></details>
    </section>
    <div v-if="activePanel" id="aurel-workspace-sheet-controls" class="workspace-sheet-controls" role="group" :aria-label="t('Inspector size')">
      <span class="workspace-sheet-title">{{ panelLabel(activePanel) }}</span>
      <button type="button" :aria-pressed="workspace.sheetSize === 'collapsed'" @click="workspace.setSheetSize('collapsed')" :aria-label="t('Minimize inspector')">⌄</button>
      <button type="button" :aria-pressed="workspace.sheetSize === 'half'" @click="workspace.setSheetSize('half')" :aria-label="t('Half-height inspector')">↕</button>
      <button type="button" :aria-pressed="workspace.sheetSize === 'full'" @click="workspace.setSheetSize('full')" :aria-label="t('Full-height inspector')">⌃</button>
    </div>
    <CommandPalette />
  </div>
</template>
