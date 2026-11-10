import '../../../testSupport/registerDom.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp, nextTick } from 'vue';
import { createPinia } from 'pinia';
import { useAgentDeskStore } from '../../stores/agentDesk.js';
import { useFieldbookStore } from '../../stores/fieldbook.js';
import { createFieldbook } from '../../../fieldbook/document.js';
import { addNote, addPlace } from '../../../fieldbook/operations.js';
import AgentWritesToggle from './AgentWritesToggle.vue';
import FieldbookPanelBody from './FieldbookPanelBody.vue';
import { panelWithBody } from '../../../testSupport/panelBody.mjs';

const FieldbookPanel = panelWithBody('fieldbook-panel', FieldbookPanelBody);

function mount(t, component, pinia) {
  document.body.replaceChildren();
  const app = createApp(component).use(pinia);
  app.mount(document.body.appendChild(document.createElement('div')));
  t.after(() => app.unmount());
}

test('the toggle shows its state and reports changes to its owner', async (t) => {
  const pinia = createPinia();
  const store = useAgentDeskStore(pinia);
  const calls = [];
  store.connect({ setWritesAllowed: (value) => calls.push(value) });
  mount(t, AgentWritesToggle, pinia);
  assert.equal(document.querySelector('[data-agent-desk]'), null);
  store.publish({ writesAllowed: false, connected: true, activity: [] });
  await nextTick();
  const input = document.querySelector('#agent-writes-toggle');
  assert.equal(input.checked, false);
  assert.equal(input.getAttribute('role'), 'switch');
  assert.match(document.body.textContent, /Allow agent writes/);
  assert.match(document.body.textContent, /every write is refused/);
  input.checked = true;
  input.dispatchEvent(new Event('change'));
  assert.deepEqual(calls, [true]);
  store.publish({
    writesAllowed: true,
    connected: true,
    activity: [
      {
        op: 'fieldbook_add_place',
        client: 'claude-code',
        outcome: 'refused',
        code: 'writes_disabled',
        at: '2026-11-08T00:30:00.000Z',
      },
    ],
  });
  await nextTick();
  assert.equal(input.checked, true);
  assert.match(
    document.querySelector('.agent-desk-activity').textContent,
    /fieldbook_add_place · claude-code · refused \(writes_disabled\)/,
  );
});

test('Library shows agent-written entries as "by agent", and agent text as plain text', async (t) => {
  const pinia = createPinia();
  const store = useFieldbookStore(pinia);
  store.connect({});
  mount(t, FieldbookPanel, pinia);
  const now = '2026-11-08T00:30:00.000Z';
  const agentId = (n) =>
    `agent.claude-code.00000000-0000-4000-8000-00000000000${n}`;
  let project = createFieldbook({
    id: agentId(1),
    title: 'Mussoorie sunrise',
    now,
  });
  project = addPlace(
    project,
    {
      id: agentId(2),
      name: 'Lal Tibba',
      geometry: { type: 'Point', coordinates: [78.0957, 30.4594] },
      createdAt: now,
    },
    { now },
  );
  project = addPlace(
    project,
    {
      id: 'owner-place',
      name: 'Gun Hill',
      geometry: { type: 'Point', coordinates: [78.0759, 30.4627] },
    },
    { now },
  );
  project = addNote(
    project,
    {
      id: agentId(3),
      subjectId: agentId(2),
      text: '<img src=x onerror=alert(1)> arrive 06:15',
    },
    { now },
  );
  store.publish({
    loading: false,
    busy: false,
    draft: { ...project, revision: 1 },
    projects: [
      {
        id: project.id,
        title: project.title,
        createdAt: now,
        updatedAt: now,
        revision: 1,
      },
    ],
    dirty: false,
    noteDraft: '',
    error: null,
    status: '',
    conflict: false,
    corruptProjects: [],
  });
  await nextTick();
  const tags = [...document.querySelectorAll('[data-agent-author]')].map(
    (node) => node.textContent,
  );
  // The project in the list, the agent's place and its note; not Gun Hill.
  assert.equal(tags.length, 3);
  assert.ok(
    tags.every((tag) => /^by agent · claude-code · /.test(tag)),
    tags.join('|'),
  );
  assert.equal(document.querySelector('img'), null);
  assert.match(
    document.body.textContent,
    /<img src=x onerror=alert\(1\)> arrive 06:15/,
  );
});
