'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startServer, j, vibe } = require('./_harness');

let s;
before(async () => {
  s = await startServer();
  await j(s.base, '/api/repos', { name: 'app' });
});
after(() => s.stop());

test('vibe pipeline: agent commit linked by trailer, distillate committed', async () => {
  const v = await vibe(s.base, 'app', { prompt: 'a todo list' });
  assert.equal(v.state, 'done');
  assert.equal(v.distill, 'done');
  assert.match(v.codeCommit, /^[0-9a-f]{40}$/);

  const commits = (await j(s.base, '/api/repos/app/code/commits')).body;
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0].vibeCommits, [v.sha]); // the cross-link
  assert.equal(commits[0].author, 'VibeHub Agent');

  const prompt = (await j(s.base, '/api/repos/app/prompt')).body;
  assert.equal(prompt.exists, true);
  assert.match(prompt.front, /company: Anthropic/);
  assert.match(prompt.front, new RegExp(`distills_vibe: ${v.sha}`));
  assert.match(prompt.front, new RegExp(`code_state: ${v.codeCommit}`));
  assert.match(prompt.body, /Then: a todo list/);

  const hist = (await j(s.base, '/api/repos/app/prompt/history')).body;
  assert.equal(hist.length, 1);
  assert.deepEqual(hist[0].distills, [v.sha]);

  // trio data sources
  assert.equal((await j(s.base, `/api/repos/app/code/commits/${v.codeCommit}`)).status, 200);
  assert.equal((await j(s.base, `/api/repos/app/prompt/commits/${v.distillSha}`)).status, 200);
  const log = (await j(s.base, `/api/repos/app/vibes/${v.sha}/log`)).body;
  assert.match(log, /coding agent: stub/);
});

test('vibe validation: empty prompt rejected, bad branch 404s', async () => {
  assert.equal((await j(s.base, '/api/repos/app/vibes', { prompt: '   ' })).status, 400);
  assert.equal((await j(s.base, '/api/repos/app/vibes', { prompt: 'x', branch: 'ghost' })).status, 404);
});

test('ramble mode: tidied into prompt+plan, original preserved', async () => {
  const v = await vibe(s.base, 'app', { ramble: 'make it pretty. use pastels. add sparkles.' });
  assert.equal(v.prompt, 'make it pretty.');
  assert.match(v.plan, /- use pastels\./);
  assert.equal(v.ramble, 'make it pretty. use pastels. add sparkles.');
});

test('preview serves the app live and at historical refs', async () => {
  const d = (await j(s.base, '/api/repos/app')).body;
  const first = d.vibes[d.vibes.length - 1];
  assert.equal((await fetch(`${s.base}/preview/app/`)).status, 200);
  assert.equal((await fetch(`${s.base}/preview/app/@${first.codeCommit}/`)).status, 200);
  assert.equal((await fetch(`${s.base}/preview/app/@deadbeef/`)).status, 404);
});

test('manual prompt edit commits to history with provenance', async () => {
  const before = (await j(s.base, '/api/repos/app/prompt/history')).body.length;
  const r = await j(s.base, '/api/repos/app/prompt', { body: 'One prompt to rule them all.' });
  assert.equal(r.status, 200);
  const prompt = (await j(s.base, '/api/repos/app/prompt')).body;
  assert.equal(prompt.body, 'One prompt to rule them all.');
  assert.match(prompt.front, /edited: by hand/);
  const hist = (await j(s.base, '/api/repos/app/prompt/history')).body;
  assert.equal(hist.length, before + 1);
  assert.match(hist[0].subject, /edited by hand/);
  assert.deepEqual(hist[0].distills, []); // human commit, no vibe link
});

test('next distillation builds on the manual edit', async () => {
  await vibe(s.base, 'app', { prompt: 'add confetti' });
  const prompt = (await j(s.base, '/api/repos/app/prompt')).body;
  assert.ok(prompt.body.includes('One prompt to rule them all.'));
  assert.ok(prompt.body.includes('Then: add confetti'));
});

test('rerun: only failed vibes, and reruns to success once unblocked', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { waitVibe } = require('./_harness');
  await j(s.base, '/api/repos', { name: 'flaky' });

  // sabotage: hide the code repo's .git so the agent's commit fails
  const gitDir = path.join(s.dataDir, 'repos', 'flaky', 'code', '.git');
  fs.renameSync(gitDir, gitDir + '-off');
  const { body: created } = await j(s.base, '/api/repos/flaky/vibes', { prompt: 'doomed' });
  const failed = await waitVibe(s.base, 'flaky', created.vibeSha);
  assert.equal(failed.state, 'failed');
  assert.ok(failed.error);

  // rerun guard: a settled (done) vibe cannot be rerun
  const okVibe = (await j(s.base, '/api/repos/app')).body.vibes[0];
  assert.equal((await j(s.base, `/api/repos/app/vibes/${okVibe.sha}/rerun`, {})).status, 409);

  // repair and rerun the exact committed vibe
  fs.renameSync(gitDir + '-off', gitDir);
  assert.equal((await j(s.base, `/api/repos/flaky/vibes/${created.vibeSha}/rerun`, {})).status, 200);
  const redone = await waitVibe(s.base, 'flaky', created.vibeSha);
  assert.equal(redone.state, 'done');
  assert.ok(redone.codeCommit);
});
