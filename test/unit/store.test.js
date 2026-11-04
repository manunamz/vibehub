'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// store resolves its data dir at require time
process.env.VIBEHUB_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'vibehub-store-'));

const { test, after } = require('node:test');
const assert = require('node:assert');
const store = require('../../lib/store');

after(() => fs.rmSync(process.env.VIBEHUB_DATA, { recursive: true, force: true }));

const reject = (p, re) => assert.rejects(p, (e) => re.test(e.message));

test('createRepo validates names and rejects duplicates', async () => {
  await reject(store.createRepo('../evil'), /invalid repo name/);
  await reject(store.createRepo(''), /invalid repo name/);
  const meta = await store.createRepo('alpha', 'first repo');
  assert.equal(meta.name, 'alpha');
  await reject(store.createRepo('alpha'), /already exists/);
});

test('renameRepo validates target and collisions', async () => {
  await store.createRepo('beta');
  await reject(store.renameRepo('alpha', 'beta'), /already exists/);
  await reject(store.renameRepo('alpha', 'bad/name'), /invalid repo name/);
  await reject(store.renameRepo('ghost', 'x'), /no repo/);
  const meta = await store.renameRepo('beta', 'gamma');
  assert.equal(meta.name, 'gamma');
  assert.ok(store.exists('gamma') && !store.exists('beta'));
});

test('repo settings: defaults, validation, isolation, description', async () => {
  const s = await store.readRepoSettings('alpha');
  assert.equal(s.agentKind, 'auto');
  assert.equal(s.agentModel, 'default');
  await reject(store.writeRepoSettings('alpha', { agentModel: 'bad model!!' }), /invalid model/);
  await reject(store.writeRepoSettings('alpha', { agentKind: 'skynet' }), /agent must be/);
  await store.writeRepoSettings('alpha', { agentKind: 'stub', description: 'x'.repeat(500) });
  const s2 = await store.readRepoSettings('alpha');
  assert.equal(s2.agentKind, 'stub');
  assert.equal(s2.description.length, 200); // capped
  assert.equal((await store.readRepoSettings('gamma')).agentKind, 'auto'); // isolated
});

test('branch validation: bad names and bad fork points', async () => {
  await reject(store.createBranch('alpha', '../up'), /invalid branch name/);
  await reject(store.createBranch('alpha', 'a//b'), /invalid branch name/);
  await reject(store.createBranch('alpha', 'tip.lock'), /invalid branch name/);
  await reject(store.createBranch('alpha', 'main'), /already exists/);
  await reject(store.createBranch('alpha', 'ok', 'deadbeef'.repeat(5)), /no vibe/);
  assert.equal(store.branchExists('alpha', 'main'), true);
  assert.equal(store.branchExists('alpha', 'nope'), false);
});

test('deleteRepo removes everything; missing repo 404s', async () => {
  await store.createRepo('doomed');
  await store.deleteRepo('doomed');
  assert.equal(store.exists('doomed'), false);
  await reject(store.deleteRepo('doomed'), /no repo/);
});

test('user profile: defaults, caps, name required', async () => {
  const u = await store.readUser();
  assert.equal(u.name, 'vibybara');
  const u2 = await store.writeUser({ bio: 'b'.repeat(999), location: 'onsen' });
  assert.equal(u2.bio.length, 240);
  assert.equal(u2.location, 'onsen');
  await reject(store.writeUser({ name: '   ' }), /name is required/);
});
