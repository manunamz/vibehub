'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startServer, j, vibe } = require('./_harness');

let s, v1;
before(async () => {
  s = await startServer();
  await j(s.base, '/api/repos', { name: 'tree' });
  v1 = await vibe(s.base, 'tree', { prompt: 'base app' });
  await vibe(s.base, 'tree', { prompt: 'second on main' });
});
after(() => s.stop());

test('branch from a vibe: histories fork in tandem, distillate travels', async () => {
  const r = await j(s.base, '/api/repos/tree/branches', { name: 'feat/retro', fromVibe: v1.sha });
  assert.equal(r.status, 201);

  const d = (await j(s.base, '/api/repos/tree?branch=feat%2Fretro')).body;
  assert.deepEqual(d.vibes.map((v) => v.prompt), ['base app']); // not "second on main"
  assert.equal(d.branch, 'feat/retro');
  assert.ok(d.branches.includes('feat/retro'));

  // the fork point's distillate came along (fork at the distill commit)
  const p = (await j(s.base, '/api/repos/tree/prompt?branch=feat%2Fretro')).body;
  assert.match(p.body, /Then: base app/);
  assert.ok(!p.body.includes('second on main'));
});

test('branch vibes stay on the branch; previews resolve slash names', async () => {
  const bv = await vibe(s.base, 'tree', { prompt: 'go retro' }, 'feat/retro');
  assert.equal(bv.state, 'done');

  const main = (await j(s.base, '/api/repos/tree')).body;
  assert.ok(!main.vibes.some((v) => v.prompt === 'go retro'));

  assert.equal((await fetch(`${s.base}/preview/tree/~feat/retro/`)).status, 200);
  assert.equal((await fetch(`${s.base}/preview/tree/~feat/retro/@${bv.codeCommit}/`)).status, 200);
  assert.equal((await fetch(`${s.base}/preview/tree/~ghost/`)).status, 404);
});

test('branch name validation', async () => {
  for (const bad of ['../up', 'a//b', 'end/', 'x.lock', 'main']) {
    const r = await j(s.base, '/api/repos/tree/branches', { name: bad });
    assert.ok(r.status === 400 || r.status === 409, `${bad} -> ${r.status}`);
  }
});

test('unmerged branches refuse deletion unless forced; worktrees cleaned', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const r1 = await j(s.base, '/api/repos/tree/branches/feat%2Fretro/delete', {});
  assert.equal(r1.status, 409);
  assert.match(r1.body.error, /unmerged/);

  const r2 = await j(s.base, '/api/repos/tree/branches/feat%2Fretro/delete', { force: true });
  assert.equal(r2.status, 200);
  assert.deepEqual((await j(s.base, '/api/repos/tree')).body.branches, ['main']);
  // nested worktree dirs swept (slash name leaves no empty parents)
  assert.ok(!fs.existsSync(path.join(s.dataDir, 'repos', 'tree', 'worktrees', 'feat')));
});
