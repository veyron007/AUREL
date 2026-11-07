import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeLocalProposal } from './proposalEvaluation.js';
const trial = {
  context: {},
  expected: {
    status: 'ready',
    command: { type: 'search_places', args: { query: 'Springfield' } },
  },
};
test('proposal evaluation checks allowlisted meaning with stable object key order', () => {
  assert.equal(
    gradeLocalProposal(
      {
        command: { args: { query: 'Springfield' }, type: 'search_places' },
        status: 'ready',
      },
      trial,
    ).correct,
    true,
  );
  assert.equal(
    gradeLocalProposal(
      {
        status: 'ready',
        command: {
          type: 'fly_to_location',
          args: { latitude: 39, longitude: -89 },
        },
      },
      trial,
    ).correct,
    false,
  );
});
test('unsafe proposals and ready actions lacking current evidence never pass evaluation', () => {
  assert.equal(
    gradeLocalProposal(
      { status: 'ready', command: { type: 'save_route', args: {} } },
      {
        context: { hasRoute: false },
        expected: { status: 'needs-input', command: null },
      },
    ).valid,
    false,
  );
  assert.equal(
    gradeLocalProposal(
      { status: 'blocked', command: { type: 'save_project', args: {} } },
      trial,
    ).valid,
    false,
  );
  assert.equal(
    gradeLocalProposal(
      { status: 'ready', command: { type: 'shell', args: { command: 'ls' } } },
      trial,
    ).valid,
    false,
  );
  assert.equal(
    gradeLocalProposal(
      { status: 'unsupported', command: null },
      { context: {}, expected: { status: 'unsupported', command: null } },
    ).correct,
    true,
  );
});
