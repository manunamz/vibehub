'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startServer, j } = require('./_harness');

let s;
before(async () => { s = await startServer(); });
after(() => s.stop());

test('repo lifecycle: create, list, detail, rename, delete', async () => {
  assert.equal((await j(s.base, '/api/repos', { name: 'one', description: 'first' })).status, 201);
  assert.equal((await j(s.base, '/api/repos', { name: 'one' })).status, 409);
  assert.equal((await j(s.base, '/api/repos', { name: '../evil' })).status, 400);

  const list = (await j(s.base, '/api/repos')).body;
  assert.ok(list.some((r) => r.name === 'one' && r.description === 'first'));

  const d = (await j(s.base, '/api/repos/one')).body;
  assert.equal(d.branch, 'main');
  assert.deepEqual(d.branches, ['main']);
  assert.deepEqual(d.vibes, []);
  assert.equal((await j(s.base, '/api/repos/nope')).status, 404);

  assert.equal((await j(s.base, '/api/repos/one/rename', { name: 'uno' })).status, 200);
  assert.equal((await j(s.base, '/api/repos/uno')).status, 200);
  assert.equal((await j(s.base, '/api/repos/one')).status, 404);

  assert.equal((await j(s.base, '/api/repos/uno/delete', {})).status, 200);
  assert.equal((await j(s.base, '/api/repos/uno')).status, 404);
});

test('repo settings: agent config + description, validated and isolated', async () => {
  await j(s.base, '/api/repos', { name: 'cfg-a' });
  await j(s.base, '/api/repos', { name: 'cfg-b' });

  assert.equal((await j(s.base, '/api/repos/cfg-a/settings', { agentModel: 'not a model!!' })).status, 400);
  assert.equal((await j(s.base, '/api/repos/cfg-a/settings', { agentKind: 'skynet' })).status, 400);

  const saved = (await j(s.base, '/api/repos/cfg-a/settings', {
    agentKind: 'stub', agentModel: 'haiku', description: 'configured repo',
  })).body;
  assert.equal(saved.agentKind, 'stub');
  assert.equal(saved.description, 'configured repo');

  const other = (await j(s.base, '/api/repos/cfg-b/settings')).body;
  assert.equal(other.agentKind, 'auto'); // untouched

  const list = (await j(s.base, '/api/repos')).body;
  assert.equal(list.find((r) => r.name === 'cfg-a').description, 'configured repo');
});

test('user profile: read, update, caps', async () => {
  const u = (await j(s.base, '/api/user')).body;
  assert.equal(u.name, 'vibybara');
  const u2 = (await j(s.base, '/api/user', { tagline: 'tester', bio: 'b'.repeat(999) })).body;
  assert.equal(u2.tagline, 'tester');
  assert.equal(u2.bio.length, 240);
  assert.equal((await j(s.base, '/api/user', { name: '' })).status, 400);
});
