import '../../../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, nextTick } from 'vue';
import { createPinia } from 'pinia';
import { useFieldbookStore } from '../../stores/fieldbook.js';
import FieldbookPanel from './FieldbookPanel.vue';
import { analysisSnapshot } from '../../../fieldbook/analysisFixtures.mjs';
import { comparisonSnapshot } from '../../../fieldbook/comparisonFixtures.mjs';
import { createFieldbook } from '../../../fieldbook/document.js';
import { captureComparison, appendChangeNote } from '../../../fieldbook/comparisonOperations.js';

function mount(t, view) {
  document.body.replaceChildren(); const pinia = createPinia();
  const store = useFieldbookStore(pinia); const calls = [];
  store.connect({ addProjectNote: (text) => { calls.push(['note', text]); return false; }, save: () => calls.push(['save']), applyImport: () => calls.push(['import']), exportBackup: () => calls.push(['export']) });
  const app = createApp(FieldbookPanel).use(pinia); app.mount(document.body.appendChild(document.createElement('div')));
  store.publish(view); t.after(() => app.unmount());
  return { store, calls };
}
const draft = { id: 'project', title: 'Dehradun fieldwork', revision: 0, places: [], notes: [], evidence: [], routes: [], drawings: [], attachments: [], sceneDocuments: [], analyses: [], comparisons: [], changeNotes: [] };
const view = { draft, projects: [], dirty: true, loading: false, busy: false, error: null, status: '', importPreview: null, exportPreview: null, recovery: null };

test('empty library provides a labelled create action without requiring an account', async (t) => {
  mount(t, { ...view, draft: null }); await nextTick();
  assert.match(document.querySelector('#fieldbook-panel').textContent, /No saved projects/);
  assert.ok(document.querySelector('label[for="fieldbook-new-title"]'));
  assert.ok(document.querySelector('#fieldbook-create'));
});

test('save failures keep note editing intact and show an export action', async (t) => {
  const { store, calls } = mount(t, view); await nextTick();
  const note = document.querySelector('#fieldbook-note'); note.value = 'Meet near Rajpur Road'; note.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#fieldbook-note-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await nextTick();
  assert.deepEqual(calls[0], ['note', 'Meet near Rajpur Road']);
  assert.equal(note.value, 'Meet near Rajpur Road');
  store.publish({ ...view, error: 'Could not save', conflict: true }); await nextTick();
  assert.equal(document.querySelector('#fieldbook-note'), note);
  assert.match(document.querySelector('[role="alert"]').textContent, /Could not save/);
  assert.ok(document.querySelector('#fieldbook-export'));
});

test('import and export require their explicit preview actions', async (t) => {
  const preview = { title: 'Backup', counts: { places: 2, notes: 1, evidence: 0, routes: 0, drawings: 0, attachments: 0, scenes: 0 }, onlineReferences: 0, localAttachments: 0 };
  const { calls } = mount(t, { ...view, importPreview: preview, exportPreview: preview }); await nextTick();
  assert.equal(calls.length, 0);
  document.querySelector('#fieldbook-import-apply').click();
  document.querySelector('#fieldbook-export-confirm').click();
  assert.deepEqual(calls, [['import'], ['export']]);
});

test('busy storage operations disable mutations but retain the project view', async (t) => {
  mount(t, { ...view, busy: true }); await nextTick();
  assert.equal(document.querySelector('#fieldbook-save').disabled, true);
  assert.equal(document.querySelector('#fieldbook-title').disabled, true);
  assert.match(document.querySelector('#fieldbook-panel').textContent, /Dehradun fieldwork/);
});

test('project brief includes general notes and saved evidence keeps uncertainty explicit', async (t) => {
  mount(t, { ...view, draft: { ...draft, evidence: [{ id: 'evidence', subjectId: 'project', sourceLabel: 'Survey', kind: 'manual', applicableTime: null, retrievedAt: null, resolutionM: null, uncertainty: 25, coverage: 'partial', feedState: 'stale', attribution: null }] }, brief: { title: draft.title, notes: ['Bring offline notes'], evidence: [], places: [], counts: { places: 0, notes: 1, evidence: 1, routes: 0, drawings: 0, attachments: 0, scenes: 0 } } });
  await nextTick();
  assert.match(document.querySelector('.fieldbook-brief').textContent, /Bring offline notes/);
  assert.match(document.querySelector('.fieldbook-evidence').textContent, /Spatial uncertainty25 m/);
  assert.match(document.querySelector('.fieldbook-evidence').textContent, /CoveragePartial/);
});

test('saved analyses show historical context and local timezone without fetching providers', async (t) => {
  const priorFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Saved analysis must not fetch'); };
  t.after(() => { globalThis.fetch = priorFetch; });
  mount(t, { ...view, draft: { ...draft, analyses: [{ id: 'analysis', subjectId: 'project', createdAt: '2026-11-07T06:00:00.000Z', snapshot: analysisSnapshot() }] } });
  await nextTick();
  const content = document.querySelector('.fieldbook-analysis').textContent;
  assert.match(content, /Historical snapshot/);
  assert.match(content, /Asia\/Kolkata/);
  assert.match(content, /Daylight/);
  assert.match(content, /terrain and building horizons/);
});

test('comparison cards preserve day precision, source limits and manual interpretation without network work',async(t)=>{
  const {project,comparisonId}=captureComparison(createFieldbook(),{name:'Dehradun',geometry:{type:'Point',coordinates:[78.0438,30.3258]}},comparisonSnapshot());
  const saved=appendChangeNote(project,comparisonId,{text:'Possible shadow change',interpretation:'unresolved'});
  const priorFetch=globalThis.fetch;globalThis.fetch=()=>{throw new Error('Historical card must not fetch');};t.after(()=>{globalThis.fetch=priorFetch;});
  mount(t,{...view,draft:saved});await nextTick();
  const content=document.querySelector('.fieldbook-comparison').textContent;
  assert.match(content,/2026-01-01/);assert.doesNotMatch(content,/2026-01-01T00:00/);
  assert.match(content,/Scene cloud coverUnknown/);assert.match(content,/Unverified alignment/);
  assert.match(content,/Unresolved/);assert.match(content,/Possible shadow change/);
});
