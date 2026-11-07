<script setup>
import { computed } from 'vue';
import { t } from '../../../i18n/index.js';
import { useAgentDeskStore } from '../../stores/agentDesk.js';

const desk = useAgentDeskStore();
const view = computed(() => desk.view);
const outcome = (row) =>
  row.outcome === 'written'
    ? t('written')
    : row.outcome === 'answered'
      ? t('answered')
      : t('refused ({code})', { code: row.code });
const clock = (value) => new Date(value).toLocaleTimeString();
</script>

<template>
  <section v-if="view" class="agent-desk" data-agent-desk :aria-label="t('Agent writes')">
    <label class="agent-desk-switch">
      <input id="agent-writes-toggle" type="checkbox" role="switch" :checked="view.writesAllowed" :aria-checked="view.writesAllowed" @change="desk.act('setWritesAllowed', $event.target.checked)" />
      <span>{{ t('Allow agent writes') }}</span>
    </label>
    <p class="agent-desk-hint">{{ view.writesAllowed ? t('On for this session. Local MCP agents can add places, notes, areas and watches, tagged "by agent".') : t('Off. Agents can read; every write is refused. Turns off when this tab session ends.') }}</p>
    <p class="agent-desk-hint" role="status">{{ view.connected ? t('Agent desk ready on this server.') : t('Agent desk not connected.') }}</p>
    <ul v-if="view.activity.length" class="agent-desk-activity" :aria-label="t('Recent agent requests')">
      <li v-for="row in view.activity" :key="`${row.at}-${row.op}`">{{ clock(row.at) }} · {{ row.op }} · {{ row.client }} · {{ outcome(row) }}</li>
    </ul>
  </section>
</template>

<style scoped>
.agent-desk {
  display: grid;
  gap: 4px;
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--hairline, var(--aurel-line));
}
.agent-desk-switch {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  color: var(--aurel-ink);
  font-weight: 600;
  cursor: pointer;
}
.agent-desk-switch input {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--accent);
}
.agent-desk-switch input:focus-visible {
  outline: 2px solid var(--focus-ring, var(--accent));
  outline-offset: 2px;
}
.agent-desk-hint {
  margin: 0;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.4;
}
.agent-desk-activity {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--text-dim);
  font: 11px/1.4 var(--font-mono);
  overflow-wrap: anywhere;
}
</style>
