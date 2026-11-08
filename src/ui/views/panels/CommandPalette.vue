<script setup>
import { nextTick, ref, watch, onBeforeUnmount } from 'vue';
import { storeToRefs } from 'pinia';
import { t } from '../../../i18n/index.js';
import { usePaletteStore } from '../../stores/palette.js';

// The command palette as src/app/paletteTools.js publishes it. Keys, typing
// and choices go back through the store; the rows run existing owners.
const palette = usePaletteStore();
const { view } = storeToRefs(palette);
const field = ref(null);
const headings = {
  places: () => t('Places'),
  layers: () => t('Layers'),
  actions: () => t('Actions'),
};
let opener = null;

watch(
  () => view.value.open,
  async (open) => {
    const doc = globalThis.document;
    if (!doc) return;
    doc.body?.classList.toggle('command-palette-open', Boolean(open));
    if (open) {
      opener = doc.activeElement;
      await nextTick();
      field.value?.focus({ preventScroll: true });
      return;
    }
    // Return focus to where the palette was opened from, unless the chosen
    // row moved it somewhere on purpose.
    await nextTick();
    const lost = !doc.activeElement || doc.activeElement === doc.body;
    if (lost && opener?.isConnected) opener.focus?.({ preventScroll: true });
    opener = null;
  },
);
onBeforeUnmount(() =>
  globalThis.document?.body?.classList.remove('command-palette-open'),
);

function onKey(event) {
  if (palette.act('key', event)) {
    event.preventDefault();
    event.stopPropagation();
  }
}
function choose(index) {
  palette.act('activate', index);
}
</script>

<template>
  <Teleport to="body">
    <div v-if="view.open" class="command-palette" @mousedown.self="palette.act('close')">
      <div class="command-palette-box" role="dialog" aria-modal="true" :aria-label="t('Command palette')">
        <div class="command-palette-field">
          <span class="material-symbols-outlined" aria-hidden="true">search</span>
          <input
            ref="field"
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="command-palette-list"
            :aria-expanded="view.empty ? 'false' : 'true'"
            :aria-activedescendant="view.activeId || null"
            :aria-label="t('Command palette')"
            :placeholder="t('Fly to a place, show a layer, open a view…')"
            :value="view.query"
            autocomplete="off"
            spellcheck="false"
            enterkeyhint="go"
            @input="palette.act('setQuery', $event.target.value)"
            @keydown="onKey"
          />
        </div>
        <div id="command-palette-list" class="command-palette-list ui-scroll" role="listbox" :aria-label="t('Command palette')">
          <div v-for="section in view.sections" :key="section.id" class="command-palette-section" role="group" :aria-labelledby="`command-palette-heading-${section.id}`">
            <div :id="`command-palette-heading-${section.id}`" class="command-palette-heading" role="presentation">{{ headings[section.id]() }}</div>
            <div
              v-for="row in section.rows"
              :id="row.id"
              :key="row.key"
              class="command-palette-row"
              :class="{ 'is-active': row.active }"
              role="option"
              :aria-selected="row.active ? 'true' : 'false'"
              :data-section="row.section"
              @mousedown.prevent
              @mousemove="palette.act('highlight', row.index)"
              @click="choose(row.index)"
            >
              <span class="command-palette-text"><span class="command-palette-title">{{ row.title }}</span><span v-if="row.detail" class="command-palette-detail" :data-on="row.pressed ? 'true' : undefined">{{ row.detail }}</span></span>
              <small v-if="row.meta" class="command-palette-meta">{{ row.meta }}</small>
            </div>
          </div>
        </div>
        <p v-if="view.empty" class="command-palette-empty" role="status">{{ t('No matches') }}</p>
        <p v-else-if="view.status" class="command-palette-status" role="status">{{ view.status }}</p>
        <div class="command-palette-hints" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd>{{ t('Move') }}</span>
          <span><kbd>↵</kbd>{{ t('Choose') }}</span>
          <span><kbd>{{ t('Esc') }}</kbd>{{ t('Close') }}</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>
