'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startServer, j, waitVibe, vibe } = require('./_harness');

let s;
before(async () => {
  s = await startServer();
  await j(s.base, '/api/repos', { name: 'm' });
  await vibe(s.base, 'm', { prompt: 'a notes app' });
  await j(s.base, '/api/repos/m/branches', { name: 'feat/tags' });
  await vibe(s.base, 'm', { prompt: 'add tags' }, 'feat/tags');
  await vibe(s.base, 'm', { prompt: 'add search on main' }); // divergence
});
after(() => s.stop());

test('compare isolates the branch\'s unique vibes', async () => {
  const cmp = (await j(s.base, '/api/repos/m/compare?with=feat%2Ftags&base=main')).body;
  assert.deepEqual(cmp.vibes.map((v) => v.prompt), ['add tags']);
  assert.ok(cmp.promptDiff.length > 0);
  assert.ok(cmp.codeDiff.length > 0);
});

test('intent-replay merge: merge vibe lands on main with full lineage', async () => {
  const { body } = await j(s.base, '/api/repos/m/merge', { branch: 'feat/tags' });
  const mv = await waitVibe(s.base, 'm', body.vibeSha);
  assert.equal(mv.state, 'done');
  assert.match(mv.prompt, /Merge branch 'feat\/tags'/);

  const commits = (await j(s.base, '/api/repos/m/code/commits')).body;
  const mergeCommit = commits.find((c) => c.vibeCommits.includes(body.vibeSha));
  assert.ok(mergeCommit, 'merge code commit exists with Vibe-Commit trailer');

  // Merged-Vibe lineage: compare is now empty, re-merge refused
  const cmp = (await j(s.base, '/api/repos/m/compare?with=feat%2Ftags&base=main')).body;
  assert.deepEqual(cmp.vibes, []);
  const again = await j(s.base, '/api/repos/m/merge', { branch: 'feat/tags' });
  assert.equal(again.status, 400);
  assert.match(again.body.error, /already merged/);
});

test('incremental merge: new branch work becomes mergeable again', async () => {
  await vibe(s.base, 'm', { prompt: 'tag colors' }, 'feat/tags');
  const cmp = (await j(s.base, '/api/repos/m/compare?with=feat%2Ftags&base=main')).body;
  assert.deepEqual(cmp.vibes.map((v) => v.prompt), ['tag colors']);
  const { status } = await j(s.base, '/api/repos/m/merge', { branch: 'feat/tags' });
  assert.equal(status, 201);
});

test('merge guards: self-merge and unknown branches', async () => {
  assert.equal((await j(s.base, '/api/repos/m/merge', { branch: 'main' })).status, 400);
  assert.equal((await j(s.base, '/api/repos/m/merge', { branch: 'ghost' })).status, 404);
});
