<script setup>
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { t } from '../../../i18n/index.js';
import { useLocalCommandsStore } from '../../stores/localCommands.js';
import {
  localCommandLabel,
  localCommandReason,
  localCommandStatus,
} from '../../localCommandPresentation.js';
import RailPanel from '../../rail/RailPanel.vue';
const commands = useLocalCommandsStore();
const { view } = storeToRefs(commands);
const proposal = computed(() => view.value?.proposal?.command);
const details = computed(() => {
  const { type, args } = proposal.value || {};
  if (!args) return '';
  if (type === 'fly_to_location') return `${args.latitude}, ${args.longitude}`;
  if (type === 'search_places') return args.query;
  if (type === 'open_panel')
    return args.panelId.replace(/-panel$/, '').replace(/-/g, ' ');
  if (type === 'set_layer_visibility')
    return `${args.layerId} · ${args.enabled ? t('Show') : t('Hide')}`;
  return t('Uses the current selection shown in its workspace.');
});
const missions = computed(() => [
  {
    name: t('Explore a place'),
    command: 'open lens',
    steps: t(
      'Search for a place, choose the right result, inspect source evidence, then save it to Fieldbook.',
    ),
    source: t('Map detail varies by place. Unknown coverage stays unknown.'),
  },
  {
    name: t('Plan an outing'),
    command: 'open planner',
    steps: t(
      'Choose a place or current route, set local departure time, then explicitly analyze terrain, daylight and forecast context.',
    ),
    source: t(
      'Forecasts and terrain are context, not a safety assessment. Source gaps remain visible.',
    ),
  },
  {
    name: t('Investigate change'),
    command: 'open compare',
    steps: t(
      'Choose a place and date window, verify two acquisitions, then compare them and save your observation.',
    ),
    source: t(
      'Acquisition dates, resolution and cloud limits matter. Imagery is not a live feed.',
    ),
  },
]);
const examples = [
  'find Dehradun, India',
  'go to 30.3258, 78.0438',
  'save place',
  'save route',
  'show earthquakes',
  'brief selected evidence',
];
</script>
<template>
  <RailPanel
    id="local-commands-panel"
    start-collapsed
    :title="t('Local commands')"
    :hint="t('Preview an explicit action before it runs')"
    scroll
  >
    <div class="local-command-workspace" :aria-busy="Boolean(view?.busy)">
      <header class="local-command-intro">
        <span class="local-command-eyebrow">{{
          t('Your intent, made explicit')
        }}</span>
        <h2>{{ t('One action. Your decision.') }}</h2>
        <p>{{
          t(
            'Commands are interpreted on this device. Source actions can use existing free providers. No language model is enabled.',
          )
        }}</p>
      </header>
      <form
        class="local-command-form"
        @submit.prevent="commands.act('preview')"
      >
        <label for="local-command-input">{{ t('Type a command') }}</label>
        <input
          id="local-command-input"
          :value="view?.input || ''"
          type="text"
          maxlength="512"
          autocomplete="off"
          spellcheck="false"
          :disabled="Boolean(view?.busy)"
          aria-describedby="local-command-guidance"
          @input="commands.act('setInput', $event.target.value)"
        />
        <p id="local-command-guidance" class="local-command-muted">{{
          t(
            'Use the examples below. Imported notes and model output never run as commands.',
          )
        }}</p>
        <div class="local-command-actions">
          <button
            type="submit"
            :disabled="!view || view.busy || !view.input?.trim()"
            >{{ t('Preview command') }}</button
          >
          <button
            type="button"
            :disabled="!view || view.busy"
            @click="commands.act('clear')"
            >{{ t('Clear') }}</button
          >
        </div>
      </form>
      <section
        v-if="proposal"
        class="local-command-preview"
        :aria-label="t('Action preview')"
      >
        <span class="local-command-eyebrow">{{ t('Will run') }}</span>
        <h3>{{ localCommandLabel(proposal.type) }}</h3
        ><p class="local-command-target">{{ details }}</p>
        <p v-if="view.proposal.notice === 'choose-search-result'">{{
          t('Search opens for your choice. No place is selected automatically.')
        }}</p>
        <p v-if="view.proposal.notice === 'stale-evidence'">{{
          t(
            'The brief includes stale evidence, with its original source dates.',
          )
        }}</p>
        <button
          type="button"
          class="local-command-run"
          :disabled="!view.canRun"
          @click="commands.act('run')"
          >{{ t('Run this action') }}</button
        >
      </section>
      <div class="local-command-status" role="status" aria-live="polite">
        <p>{{ localCommandStatus(view) }}</p>
        <p v-if="view?.error" class="local-command-error">{{
          localCommandReason(view.error)
        }}</p>
      </div>
      <button
        v-if="view?.canCancel"
        type="button"
        @click="commands.act('cancel')"
        >{{ t('Cancel pending action') }}</button
      >
      <details class="local-command-examples"
        ><summary>{{ t('Command examples') }}</summary>
        <div class="local-command-chips"
          ><button
            v-for="example in examples"
            :key="example"
            type="button"
            :disabled="Boolean(view?.busy)"
            @click="commands.act('setInput', example)"
            >{{ example }}</button
          ></div
        >
      </details>
      <section
        class="local-command-missions"
        :aria-label="t('Guided workflows')"
      >
        <h3>{{ t('Start with a purpose') }}</h3>
        <article v-for="(mission, index) in missions" :key="mission.command">
          <span class="local-command-step" aria-hidden="true"
            >0{{ index + 1 }}</span
          >
          <div
            ><h4>{{ mission.name }}</h4
            ><p>{{ mission.steps }}</p
            ><p class="local-command-muted">{{ mission.source }}</p>
            <button
              type="button"
              :disabled="Boolean(view?.busy)"
              @click="commands.act('setInput', mission.command)"
              >{{ t('Prepare workspace command') }}</button
            >
          </div>
        </article>
      </section>
    </div>
  </RailPanel>
</template>
