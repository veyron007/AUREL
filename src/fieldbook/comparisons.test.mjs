import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFieldbook,
  parseFieldbook,
  stringifyFieldbook,
  validateFieldbook,
} from './document.js';
import {
  addPlace,
  addDrawing,
  removeEntry,
  duplicateFieldbook,
} from './operations.js';
import { captureComparison, appendChangeNote } from './comparisonOperations.js';
import {
  validateComparisonSnapshot,
  validateComparisonInput,
  extentContains,
  comparisonTimeBounds,
} from './comparisonSchema.js';
import { comparisonSnapshot } from './comparisonFixtures.mjs';

const now = '2026-11-07T06:00:00.000Z';
const place = {
  id: 'dehradun',
  name: 'Dehradun',
  geometry: { type: 'Point', coordinates: [78.0438, 30.3258] },
};
const project = () =>
  addPlace(createFieldbook({ id: 'fieldbook', now }), place, { now });
const compared = () =>
  captureComparison(project(), place, comparisonSnapshot(), { now });

test('comparison preserves day precision, admitted asset identities and immutable evidence links', () => {
  const { project: saved, comparisonId } = compared();
  assert.equal(saved.comparisons.length, 1);
  assert.equal(saved.evidence.length, 2);
  assert.equal(saved.comparisons[0].id, comparisonId);
  assert.equal(saved.evidence[0].applicableTime, null);
  assert.deepEqual(saved.comparisons[0].snapshot.before.time, {
    kind: 'day',
    date: '2026-01-01',
  });
  const restored = parseFieldbook(stringifyFieldbook(saved));
  assert.deepEqual(restored, saved);
  const retry = captureComparison(saved, place, comparisonSnapshot(), { now });
  assert.equal(retry.comparisonId, comparisonId);
  assert.equal(retry.project.evidence.length, 2);
  assert.throws(() => removeEntry(saved, 'evidence', saved.evidence[0].id), {
    code: 'INVALID_DOCUMENT',
  });
});

test('comparison input gate rejects invented dates, hidden URLs, wrong extents and unproven metadata', () => {
  const changes = [
    (s) => {
      s.before.time.date = '2026-02-31';
    },
    (s) => {
      s.before.asset.requestedDate = '2026-10-01';
    },
    (s) => {
      s.before.probedAt = '2025-01-01T00:00:00.000Z';
    },
    (s) => {
      s.after.time = s.before.time;
    },
    (s) => {
      s.before.asset.url = 'https://example.com/?key=secret';
    },
    (s) => {
      s.before.asset.productId = 'unregistered';
    },
    (s) => {
      s.before.availability = 'unknown';
    },
    (s) => {
      s.before.license = '';
    },
    (s) => {
      s.before.alignment = 'verified';
    },
    (s) => {
      s.before.nativeResolutionM = 0.1;
    },
    (s) => {
      s.before.cloudCoverPct = 101;
    },
    (s) => {
      s.before.georeference.extent = [0, 0, 1, 1];
    },
    (s) => {
      s.extent = [0, 0, 1, 1];
      s.before.georeference.extent = s.extent;
      s.after.georeference.extent = s.extent;
    },
  ];
  for (const change of changes) {
    const snapshot = comparisonSnapshot();
    change(snapshot);
    assert.throws(
      () => captureComparison(project(), place, snapshot, { now }),
      { code: 'INVALID_DOCUMENT' },
    );
  }
});

test('exact instants and acquisition intervals retain their declared precision', () => {
  const snapshot = comparisonSnapshot();
  snapshot.before.time = { kind: 'instant', at: '2026-01-01T05:10:00.000Z' };
  snapshot.after.time = {
    kind: 'interval',
    start: '2026-10-01T05:00:00.000Z',
    end: '2026-10-01T06:00:00.000Z',
  };
  validateComparisonInput(snapshot.before);
  validateComparisonInput(snapshot.after);
  const { project: saved } = captureComparison(project(), place, snapshot, {
    now,
  });
  assert.equal(saved.evidence[0].applicableTime, snapshot.before.time.at);
  assert.equal(saved.evidence[1].applicableTime, null);
  assert.deepEqual(
    saved.comparisons[0].snapshot.after.time,
    snapshot.after.time,
  );
  assert.deepEqual(comparisonTimeBounds(snapshot.before.time), [
    Date.parse(snapshot.before.time.at),
    Date.parse(snapshot.before.time.at),
  ]);
  assert.throws(
    () => comparisonTimeBounds({ kind: 'interval', start: now, end: now }),
    { code: 'INVALID_DOCUMENT' },
  );
  assert.throws(
    () =>
      validateComparisonInput({
        ...snapshot.before,
        granuleIds: ['same', 'same'],
      }),
    { code: 'INVALID_DOCUMENT' },
  );
  assert.throws(
    () => validateComparisonSnapshot({ ...snapshot, extent: [78, 30, 78, 31] }),
    { code: 'INVALID_DOCUMENT' },
  );
  assert.equal(extentContains([170, -10, -170, 10], [175, -5, -175, 5]), true);
  assert.equal(extentContains([170, -10, -170, 10], [0, -5, 1, 5]), false);
});

test('change notes cite their own comparison evidence, retain interpretation and copy references', () => {
  const { project: initial, comparisonId } = compared();
  const saved = appendChangeNote(
    initial,
    comparisonId,
    {
      text: 'Possible seasonal vegetation difference',
      interpretation: 'unresolved',
    },
    { now },
  );
  assert.equal(saved.changeNotes[0].comparisonId, comparisonId);
  assert.deepEqual(
    saved.changeNotes[0].supportingEvidenceIds,
    saved.evidence.map((row) => row.id),
  );
  const copy = duplicateFieldbook(saved, { id: 'copy', now });
  assert.equal(copy.changeNotes[0].comparisonId, copy.comparisons[0].id);
  assert.throws(() => removeEntry(saved, 'comparisons', comparisonId), {
    code: 'INVALID_DOCUMENT',
  });
  assert.throws(
    () =>
      appendChangeNote(
        saved,
        comparisonId,
        {
          text: 'Unsupported',
          interpretation: 'observed',
          supportingEvidenceIds: ['missing'],
        },
        { now },
      ),
    { code: 'INVALID_DOCUMENT' },
  );
});

test('manual change polygons must belong to the comparison area and remain reference-protected', () => {
  const { project: saved, comparisonId } = compared();
  const drawn = addDrawing(
    saved,
    {
      id: 'polygon',
      name: 'Possible change',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [78.01, 30.01],
            [78.02, 30.01],
            [78.02, 30.02],
            [78.01, 30.01],
          ],
        ],
      },
    },
    { now },
  );
  const noted = appendChangeNote(
    drawn,
    comparisonId,
    {
      text: 'Visible tonal difference',
      interpretation: 'observed',
      drawingId: 'polygon',
    },
    { now },
  );
  assert.equal(noted.changeNotes[0].drawingId, 'polygon');
  assert.throws(() => removeEntry(noted, 'drawings', 'polygon'), {
    code: 'INVALID_DOCUMENT',
  });
  const outside = structuredClone(drawn);
  outside.drawings[0].geometry.coordinates = [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ],
  ];
  assert.throws(
    () =>
      appendChangeNote(
        outside,
        comparisonId,
        {
          text: 'Wrong area',
          interpretation: 'inferred',
          drawingId: 'polygon',
        },
        { now },
      ),
    { code: 'INVALID_DOCUMENT' },
  );
  assert.throws(
    () =>
      appendChangeNote(
        drawn,
        comparisonId,
        {
          text: 'Missing polygon',
          interpretation: 'unresolved',
          drawingId: 'missing',
        },
        { now },
      ),
    { code: 'INVALID_DOCUMENT' },
  );
});

test('v1 and v2 read migrations add empty comparison collections without changing existing content', () => {
  const current = project();
  for (const version of [1, 2]) {
    const { comparisons, changeNotes, ...legacy } = current;
    legacy.version = version;
    legacy.revision = 4;
    if (version === 1) delete legacy.analyses;
    const migrated = parseFieldbook(JSON.stringify(legacy));
    assert.equal(migrated.version, 3);
    assert.equal(migrated.id, current.id);
    assert.equal(migrated.revision, 4);
    assert.deepEqual(migrated.comparisons, []);
    assert.deepEqual(migrated.changeNotes, []);
    assert.deepEqual(migrated.places, current.places);
    assert.throws(
      () => parseFieldbook(JSON.stringify({ ...legacy, comparisons: [] })),
      { code: 'INVALID_DOCUMENT' },
    );
  }
  assert.throws(() => validateFieldbook({ ...current, version: 99 }), {
    code: 'INVALID_DOCUMENT',
  });
});
