import assert from 'node:assert/strict';
import test from 'node:test';
import { validateFieldbook, createFieldbook } from '../fieldbook/document.js';
import {
  agentAuthorLabel,
  agentAuthorOf,
  agentEntryId,
  parseAgentAuthor,
  sanitizeClientName,
} from './author.js';

const UUID = '6f1c2b8e-3a4d-4c5e-8f90-123456789abc';

test('client names are reduced to a safe tag', () => {
  assert.equal(sanitizeClientName('claude-code'), 'claude-code');
  assert.equal(sanitizeClientName('Claude Code'), 'claude-code');
  assert.equal(
    sanitizeClientName('<script>alert(1)</script>'),
    'script-alert-1-script',
  );
  assert.equal(sanitizeClientName(''), 'unknown-client');
  assert.equal(sanitizeClientName(null), 'unknown-client');
  assert.equal(sanitizeClientName('x'.repeat(80)).length, 32);
  assert.equal(sanitizeClientName('Codex ✨ CLI'), 'codex-cli');
});

test('agent IDs are valid Fieldbook IDs and round-trip their author', () => {
  const id = agentEntryId('Claude Code', UUID);
  assert.equal(id, `agent.claude-code.${UUID}`);
  assert.deepEqual(parseAgentAuthor(id), { client: 'claude-code' });
  const project = createFieldbook({
    id,
    title: 'x',
    now: '2026-11-08T00:30:00.000Z',
  });
  assert.doesNotThrow(() => validateFieldbook(project));
  assert.throws(() => agentEntryId('x', 'not-a-uuid'), /random UUID/);
});

test('owner entries have no author; agent entries carry client and time', () => {
  assert.equal(parseAgentAuthor('6f1c2b8e-3a4d-4c5e-8f90-123456789abc'), null);
  assert.equal(parseAgentAuthor('agent.claude-code.short'), null);
  assert.equal(agentAuthorOf({ id: 'x', createdAt: 'y' }), null);
  const entry = {
    id: agentEntryId('codex', UUID),
    createdAt: '2026-11-08T00:30:00.000Z',
  };
  assert.deepEqual(agentAuthorOf(entry), {
    client: 'codex',
    time: '2026-11-08T00:30:00.000Z',
  });
  assert.equal(
    agentAuthorLabel(entry),
    'by agent · codex · 2026-11-08T00:30:00.000Z',
  );
  assert.equal(
    agentAuthorLabel({ id: entry.id }),
    'by agent · codex · time unknown',
  );
});
