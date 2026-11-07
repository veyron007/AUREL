<script setup>
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { t } from '../../../i18n/index.js';
import { useFieldbookStore } from '../../stores/fieldbook.js';
import RailPanel from '../../rail/RailPanel.vue';
import FieldbookAnalysis from './FieldbookAnalysis.vue';
import FieldbookComparison from './FieldbookComparison.vue';
import { agentAuthorOf } from '../../../fieldkit/author.js';

const fieldbook = useFieldbookStore();
const { view } = storeToRefs(fieldbook);
const draft = computed(() => view.value?.draft);
const newTitle = ref('');
const editTitle = ref('');
const note = ref('');
const importFile = ref(null);
const attachmentFile = ref(null);
watch(() => [draft.value?.id, draft.value?.revision], () => { editTitle.value = draft.value?.title ?? ''; });
watch(() => view.value?.noteDraft, (value) => { if (typeof value === 'string') note.value = value; });
const countRows = (counts) => [
  [t('Places'), counts.places], [t('Notes'), counts.notes], [t('Evidence'), counts.evidence],
  [t('Routes'), counts.routes], [t('Drawings'), counts.drawings], [t('Local files'), counts.attachments], [t('Scenes'), counts.scenes],
  [t('Analyses'), counts.analyses],
  [t('Comparisons'), counts.comparisons], [t('Change notes'), counts.changeNotes],
];
const subjectName = (id) => [...(draft.value?.places ?? []), ...(draft.value?.routes ?? []), ...(draft.value?.drawings ?? []), ...(draft.value?.attachments ?? [])].find((item) => item.id === id)?.name ?? draft.value?.title;
const displayTime = (value) => value ? new Date(value).toLocaleString() : t('Unknown');
const authorTag = (entry) => { const author = agentAuthorOf(entry); return author ? t('by agent · {client} · {time}', { client: author.client, time: displayTime(author.time) }) : ''; };
const coordinates = (place) => `${place.geometry.coordinates[1].toFixed(5)}°, ${place.geometry.coordinates[0].toFixed(5)}°`;
const kindLabel = (kind) => ({ observation: t('Observation'), forecast: t('Forecast'), imagery: t('Imagery'), derived: t('Derived'), manual: t('Manual'), simulation: t('Simulation'), unknown: t('Unknown') })[kind] ?? t('Unknown');
const coverageLabel = (value) => ({ unknown: t('Unknown'), supported: t('Supported'), unsupported: t('Unsupported'), partial: t('Partial') })[value] ?? t('Unknown');
const stateLabel = (value) => ({ unknown: t('Unknown'), nominal: t('Available'), loading: t('Loading'), degraded: t('Degraded'), stale: t('Stale'), partial: t('Partial'), fallback: t('Fallback'), unavailable: t('Unavailable'), blocked: t('Blocked') })[value] ?? t('Unknown');
async function create() { if (await fieldbook.act('create', newTitle.value.trim() || t('Untitled fieldbook'))) newTitle.value = ''; }
async function save() { if (editTitle.value.trim() !== draft.value?.title && !fieldbook.act('rename', editTitle.value.trim())) return; await fieldbook.act('save'); }
async function addNote() { if (await fieldbook.act('addProjectNote', note.value)) note.value = ''; }
async function chooseImport(event) { const file = event.target.files?.[0]; event.target.value = ''; if (file) await fieldbook.act('previewImportFile', file); }
async function chooseAttachment(event) { const file = event.target.files?.[0]; event.target.value = ''; if (file) await fieldbook.act('capture', 'attachment', file); }
</script>

<template>
  <RailPanel id="fieldbook-panel" start-collapsed :title="t('Fieldbook')" :hint="t('Your places, notes and evidence, saved on this device')" scroll>
    <div class="fieldbook-workspace" :aria-busy="Boolean(view?.loading || view?.busy)">
      <p v-if="!view || view.loading" role="status">{{ t('Loading saved projects…') }}</p>
      <template v-if="view">
        <p class="fieldbook-local-label">{{ t('Local library') }}</p>
        <p class="fieldbook-help">{{ t('Saved projects stay on this device. Export a backup to keep a separate copy.') }}</p>
        <div v-if="view.error" class="fieldbook-notice fieldbook-notice--error" role="alert">
          <p>{{ view.error }}</p>
          <button v-if="view.conflict" type="button" :disabled="view.busy" @click="fieldbook.act('reloadSaved')">{{ t('Reload saved version') }}</button>
        </div>
        <p v-if="view.draftWarning" class="fieldbook-notice" role="status">{{ view.draftWarning }}</p>
        <section v-if="view.recovery" class="fieldbook-notice" :aria-label="t('Draft recovery')">
          <p>{{ t('A protected draft is available: {title}', { title: view.recovery.title }) }}</p>
          <div class="fieldbook-actions">
            <button v-if="view.recovery.valid" type="button" :disabled="view.busy" @click="fieldbook.act('recoverDraft')">{{ t('Recover draft') }}</button>
            <button type="button" @click="fieldbook.act('exportRecovery')">{{ t('Download recovery copy') }}</button>
            <button type="button" @click="fieldbook.act('dismissRecovery')">{{ t('Dismiss') }}</button>
          </div>
        </section>
        <section v-if="view.pendingNavigation" class="fieldbook-notice" :aria-label="t('Unsaved project')">
          <p>{{ t('This project has unsaved changes. Save or export it before continuing, or explicitly leave this draft.') }}</p>
          <div class="fieldbook-actions">
            <button type="button" :disabled="view.busy" @click="fieldbook.act('discardAndContinue')">{{ t('Leave draft and continue') }}</button>
            <button type="button" @click="fieldbook.act('cancelNavigation')">{{ t('Keep editing') }}</button>
          </div>
        </section>

        <form class="fieldbook-create-form" @submit.prevent="create">
          <label for="fieldbook-new-title">{{ t('New project name') }}</label>
          <div class="fieldbook-input-action">
            <input id="fieldbook-new-title" v-model="newTitle" type="text" maxlength="512" :disabled="view.busy" :placeholder="t('Dehradun foothills weekend')" />
            <button id="fieldbook-create" type="submit" :disabled="view.busy">{{ t('Create') }}</button>
          </div>
        </form>
        <div class="fieldbook-library-toolbar">
          <label><input type="checkbox" :checked="view.showArchived" @change="fieldbook.act('setShowArchived', $event.target.checked)" />{{ t('Show archived') }}</label>
          <button type="button" :disabled="view.busy" @click="importFile.click()">{{ t('Import backup') }}</button>
          <input ref="importFile" type="file" accept=".json,application/json" hidden @change="chooseImport" :aria-label="t('Choose a Fieldbook backup')" />
        </div>
        <ul class="fieldbook-project-list" :aria-label="t('Saved projects')">
          <li v-for="project in view.projects" :key="project.id">
            <button type="button" :disabled="view.busy" :aria-pressed="draft?.id === project.id" @click="fieldbook.act('open', project.id)">
              <strong>{{ project.title }}</strong><span>{{ displayTime(project.updatedAt) }}</span><small v-if="authorTag(project)" class="fieldbook-author" data-agent-author>{{ authorTag(project) }}</small>
            </button>
          </li>
        </ul>
        <p v-if="!view.loading && !view.projects.length" class="fieldbook-empty">{{ view.showArchived ? t('No archived projects.') : t('No saved projects yet. Create one, or save a place from Lens.') }}</p>

        <section v-if="view.corruptProjects?.length" class="fieldbook-notice" :aria-label="t('Unreadable saved projects')"><p>{{ t('Some saved projects could not be read. Their original records have been kept for recovery.') }}</p><button v-for="item in view.corruptProjects" :key="item.id" type="button" @click="fieldbook.act('exportCorrupt', item.id)">{{ t('Download recovery copy') }}</button></section>

        <section v-if="view.importPreview" class="fieldbook-preview" :aria-label="t('Import preview')">
          <h3>{{ t('Import as a new project') }}</h3><p>{{ view.importPreview.title }}</p>
          <dl class="fieldbook-counts"><template v-for="[label, count] in countRows(view.importPreview.counts)" :key="label"><dt>{{ label }}</dt><dd>{{ count }}</dd></template></dl>
          <p class="fieldbook-help">{{ t('The existing project will not be overwritten. Review this copy, then save it.') }}</p>
          <div class="fieldbook-actions"><button id="fieldbook-import-apply" type="button" :disabled="view.busy" @click="fieldbook.act('applyImport')">{{ t('Restore a copy') }}</button><button type="button" @click="fieldbook.act('cancelImport')">{{ t('Cancel') }}</button></div>
        </section>

        <section v-if="draft" class="fieldbook-editor" :aria-label="draft.title">
          <div class="fieldbook-editor-heading"><h3>{{ draft.title }}</h3><span class="fieldbook-save-state" role="status">{{ view.busy ? t('Working…') : view.dirty ? t('Unsaved') : t('Saved') }}</span></div>
          <label for="fieldbook-title">{{ t('Project name') }}</label>
          <input id="fieldbook-title" v-model="editTitle" type="text" maxlength="512" :disabled="view.busy" @input="fieldbook.act('rename', editTitle)" />
          <div class="fieldbook-actions">
            <button id="fieldbook-save" type="button" class="fieldbook-primary" :disabled="view.busy || !view.dirty" @click="save">{{ t('Save') }}</button>
            <button id="fieldbook-export" type="button" @click="fieldbook.act('prepareExport')">{{ t('Export backup') }}</button>
            <button type="button" :disabled="view.busy" @click="fieldbook.act('duplicate')">{{ t('Duplicate') }}</button>
            <button type="button" :disabled="view.busy" @click="fieldbook.act(draft.archivedAt ? 'recover' : 'archive')">{{ draft.archivedAt ? t('Restore from archive') : t('Archive') }}</button>
          </div>
          <p v-if="draft.archivedAt" class="fieldbook-help">{{ t('Archived projects stay recoverable in this library. Save to apply this change.') }}</p>
          <p v-if="view.status" class="fieldbook-status" role="status">{{ view.status }}</p>

          <section v-if="view.exportPreview" class="fieldbook-preview" :aria-label="t('Export preview')">
            <h4>{{ t('What this backup includes') }}</h4>
            <dl class="fieldbook-counts"><template v-for="[label, count] in countRows(view.exportPreview.counts)" :key="label"><dt>{{ label }}</dt><dd>{{ count }}</dd></template></dl>
            <p>{{ t('{count} local files included · {bytes} bytes', { count: view.exportPreview.localAttachments, bytes: view.exportPreview.localBytes ?? 0 }) }}</p>
            <p>{{ t('{count} online evidence links remain references.', { count: view.exportPreview.onlineReferences }) }}</p>
            <p class="fieldbook-help">{{ t('Map imagery and external scene assets are not bundled. Scene documents retain their references. API keys are never included.') }}</p>
            <div class="fieldbook-actions"><button id="fieldbook-export-confirm" type="button" @click="fieldbook.act('exportBackup')">{{ t('Download backup') }}</button><button type="button" @click="fieldbook.act('cancelExport')">{{ t('Cancel') }}</button></div>
          </section>
          <section class="fieldbook-section" :aria-label="t('Saved places')">
            <h4>{{ t('Places') }} <span>{{ draft.places.length }}</span></h4>
            <p v-if="!draft.places.length" class="fieldbook-help">{{ t('Search or select a place, then choose Save place in Lens.') }}</p>
            <ul class="fieldbook-item-list"><li v-for="place in draft.places" :key="place.id"><div><strong>{{ place.name }}</strong><span class="fieldbook-coordinates">{{ coordinates(place) }}</span><small v-if="place.aliases.length">{{ place.aliases.join(' · ') }}</small><small v-if="authorTag(place)" class="fieldbook-author" data-agent-author>{{ authorTag(place) }}</small></div><button type="button" @click="fieldbook.act('focusSavedPlace', place.id)">{{ t('View') }}</button></li></ul>
          </section>
          <section class="fieldbook-section" :aria-label="t('Project notes')">
            <h4>{{ t('Notes') }} <span>{{ draft.notes.length }}</span></h4>
            <ul class="fieldbook-notes"><li v-for="item in draft.notes" :key="item.id"><span class="fieldbook-help">{{ subjectName(item.subjectId) }}</span><small v-if="authorTag(item)" class="fieldbook-author" data-agent-author>{{ authorTag(item) }}</small><p>{{ item.text }}</p><button type="button" :disabled="view.busy" @click="fieldbook.act('removeNote', item.id)">{{ t('Remove note') }}</button></li></ul>
            <form id="fieldbook-note-form" @submit.prevent="addNote"><label for="fieldbook-note">{{ t('Add a project note') }}</label><textarea id="fieldbook-note" v-model="note" @input="fieldbook.act('setNoteDraft', note)" rows="3" maxlength="16384" :disabled="view.busy"></textarea><button type="submit" :disabled="view.busy || !note.trim()">{{ t('Add note') }}</button></form>
          </section>
          <section class="fieldbook-section" :aria-label="t('Saved evidence')">
            <h4>{{ t('Evidence') }} <span>{{ draft.evidence.length }}</span></h4>
            <p v-if="!draft.evidence.length" class="fieldbook-help">{{ t('No evidence has been saved. Unknown detail and dates stay unknown.') }}</p>
            <details v-for="item in draft.evidence" :key="item.id" class="fieldbook-evidence"><summary>{{ item.sourceLabel }} · {{ kindLabel(item.kind) }}<template v-if="authorTag(item)"> · {{ t('cited by agent') }}</template></summary><dl><dt>{{ t('Applies to') }}</dt><dd>{{ subjectName(item.subjectId) }}</dd><dt>{{ t('Applicable time') }}</dt><dd>{{ displayTime(item.applicableTime) }}</dd><dt>{{ t('Retrieved') }}</dt><dd>{{ displayTime(item.retrievedAt) }}</dd><dt>{{ t('Native resolution') }}</dt><dd>{{ item.resolutionM == null ? t('Unknown') : t('{value} m', { value: item.resolutionM }) }}</dd><dt>{{ t('Spatial uncertainty') }}</dt><dd>{{ item.uncertainty == null ? t('Unknown') : t('{value} m', { value: item.uncertainty }) }}</dd><dt>{{ t('Coverage') }}</dt><dd>{{ coverageLabel(item.coverage) }}</dd><dt>{{ t('Source status') }}</dt><dd>{{ stateLabel(item.feedState) }}</dd><dt>{{ t('Attribution') }}</dt><dd>{{ item.attribution || t('Unknown') }}</dd></dl><a v-if="item.link" :href="item.link" target="_blank" rel="noopener noreferrer">{{ t('Open source') }}</a></details>
          </section>
          <section class="fieldbook-section" :aria-label="t('Saved analyses')">
            <h4>{{ t('Saved analyses') }} <span>{{ draft.analyses.length }}</span></h4>
            <p v-if="!draft.analyses.length" class="fieldbook-help">{{ t('Save a route or place analysis from Planner to keep its context here.') }}</p>
            <details v-for="item in draft.analyses" :key="item.id" class="fieldbook-evidence"><summary>{{ subjectName(item.subjectId) }} · {{ displayTime(item.snapshot.capturedAt) }}</summary><FieldbookAnalysis :snapshot="item.snapshot" /></details>
          </section>
          <section class="fieldbook-section" :aria-label="t('Saved comparisons')">
            <h4>{{ t('Saved comparisons') }} <span>{{ draft.comparisons.length }}</span></h4>
            <p v-if="!draft.comparisons.length" class="fieldbook-help">{{ t('Choose two verified dated inputs in Chronicle, then save the comparison here.') }}</p>
            <details v-for="item in draft.comparisons" :key="item.id" class="fieldbook-evidence"><summary>{{ item.snapshot.title }} · {{ subjectName(item.subjectId) }}</summary><button v-if="view.comparisonOpenAvailable" type="button" @click="fieldbook.act('openSavedComparison',item.id)">{{ t('Open in Chronicle') }}</button><FieldbookComparison :comparison="item" :notes="draft.changeNotes.filter(note=>note.comparisonId===item.id)" /></details>
          </section>
          <section class="fieldbook-section" :aria-label="t('Saved content')">
            <h4>{{ t('Routes, drawings and files') }}</h4>
            <div v-if="view.captureAvailable" class="fieldbook-actions"><button type="button" :disabled="view.busy" @click="fieldbook.act('capture', 'route')">{{ t('Save current route') }}</button><button type="button" :disabled="view.busy" @click="fieldbook.act('capture', 'drawing')">{{ t('Save drawings') }}</button><button type="button" :disabled="view.busy" @click="fieldbook.act('capture', 'scene')">{{ t('Save scene document') }}</button><button type="button" :disabled="view.busy" @click="attachmentFile.click()">{{ t('Attach local file') }}</button><input ref="attachmentFile" type="file" hidden @change="chooseAttachment" :aria-label="t('Choose a local file to include in this project')" /></div>
            <ul class="fieldbook-item-list"><template v-for="[kind, entries] in [['route', draft.routes], ['drawing', draft.drawings], ['attachment', draft.attachments], ['scene', draft.sceneDocuments]]" :key="kind"><li v-for="item in entries" :key="item.id"><div><strong>{{ item.name }}</strong><small v-if="authorTag(item)" class="fieldbook-author" data-agent-author>{{ authorTag(item) }}</small><span v-if="kind === 'attachment'">{{ t('{bytes} bytes · included locally', { bytes: item.bytes }) }}</span></div><button v-if="view.restoreAvailable" type="button" :disabled="view.busy" @click="fieldbook.act('restoreSavedCapture', kind, item.id)">{{ kind === 'attachment' ? t('Download') : t('Show saved content') }}</button></li></template></ul>
            <section v-if="view.restorePreview" class="fieldbook-notice" :aria-label="t('Restore scene document')"><p>{{ t('Restoring this scene document replaces the current scene project. Export your existing scenes first if you want to keep them.') }}</p><div class="fieldbook-actions"><button type="button" @click="fieldbook.act('confirmRestore')">{{ t('Replace scene project') }}</button><button type="button" @click="fieldbook.act('cancelRestore')">{{ t('Cancel') }}</button></div></section>
          </section>
          <section class="fieldbook-section"><button type="button" :aria-expanded="Boolean(view.brief)" @click="fieldbook.act('toggleBrief')">{{ t('Project brief') }}</button><div v-if="view.brief" class="fieldbook-brief"><h4>{{ view.brief.title }}</h4><p class="fieldbook-help">{{ t('A summary of project content. No live refresh or AI generation.') }}</p><dl class="fieldbook-counts"><template v-for="[label, count] in countRows(view.brief.counts)" :key="label"><dt>{{ label }}</dt><dd>{{ count }}</dd></template></dl><section v-if="view.brief.comparisons?.length"><h5>{{ t('Saved comparisons') }}</h5><div v-for="item in view.brief.comparisons" :key="item.id"><strong>{{ item.snapshot.title }}</strong><p v-for="note in item.notes" :key="note.id">{{ note.text }}</p></div></section><section v-if="view.brief.analyses?.length"><h5>{{ t('Saved analyses') }}</h5><p v-for="item in view.brief.analyses" :key="item.id">{{ subjectName(item.subjectId) }} · {{ displayTime(item.snapshot.capturedAt) }} · {{ item.snapshot.localDate }} ({{ item.snapshot.timeZone }})</p></section><section v-if="view.brief.notes?.length"><h5>{{ t('Project notes') }}</h5><p v-for="(text, index) in view.brief.notes" :key="index">{{ text }}</p></section><section v-if="view.brief.evidence?.length"><h5>{{ t('Saved evidence') }}</h5><p v-for="item in view.brief.evidence" :key="item.id">{{ item.sourceLabel }} · {{ kindLabel(item.kind) }} · {{ t('Applicable time') }}: {{ displayTime(item.applicableTime) }}</p></section><section v-for="place in view.brief.places" :key="place.id"><h5>{{ place.name }}</h5><p v-for="(text, index) in place.notes" :key="index">{{ text }}</p><p v-for="(item, index) in place.evidence" :key="index">{{ item.sourceLabel }} · {{ kindLabel(item.kind) }} · {{ t('Applicable time') }}: {{ displayTime(item.applicableTime) }}</p></section></div></section>
        </section>
      </template>
    </div>
  </RailPanel>
</template>
