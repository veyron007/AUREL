import test from 'node:test';
import assert from 'node:assert/strict';
import { SceneDirector } from './director.js';
import { createDefaultProject } from './project.js';

test('project capture uses the existing scene schema and never exposes mutable director state', () => {
  const director = Object.create(SceneDirector.prototype);
  director._project = createDefaultProject();
  const snapshot = director.getProjectSnapshot();
  assert.equal(snapshot.version, director._project.version);
  snapshot.scenes[0].title = 'Changed detached copy';
  assert.notEqual(director._project.scenes[0].title, snapshot.scenes[0].title);
  director._destroyed = true;
  assert.equal(director.getProjectSnapshot(), null);
});
test('explicit snapshot restoration validates before delegating to normal import and carries no remote assets', async () => {
  const director = Object.create(SceneDirector.prototype);
  const calls = [];
  director.importProjectFile = async (...args) => {
    calls.push(args);
    return true;
  };
  const project = createDefaultProject();
  assert.equal(await director.restoreProjectSnapshot(project), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1].prepared.project, project);
  assert.equal(calls[0][1].prepared.assets.size, 0);
  await assert.rejects(() =>
    director.restoreProjectSnapshot({ ...project, version: 999 }),
  );
  assert.equal(calls.length, 1);
});
