'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const gitlib = require('../../lib/git');

let dir;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibehub-git-'));
  await gitlib.initRepo(dir, 'Test', 'test@test.local');
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('log returns [] for an empty repo', async () => {
  assert.deepEqual(await gitlib.log(dir), []);
});

test('commitAll commits files and returns a sha', async () => {
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');
  const sha = await gitlib.commitAll(dir, 'first: hello');
  assert.match(sha, /^[0-9a-f]{40}$/);
});

test('commitAll allows empty commits', async () => {
  const sha = await gitlib.commitAll(dir, 'empty: nothing changed');
  assert.match(sha, /^[0-9a-f]{40}$/);
});

test('log parses subject, author, and trailer lists', async () => {
  fs.writeFileSync(path.join(dir, 'b.txt'), 'x');
  await gitlib.commitAll(
    dir,
    'agent: did a thing\n\nbody\n\nVibe-Commit: aaa111\nMerged-Vibe: bbb222\nMerged-Vibe: ccc333'
  );
  const [head] = await gitlib.log(dir);
  assert.equal(head.subject, 'agent: did a thing');
  assert.equal(head.author, 'Test');
  assert.deepEqual(head.vibeCommits, ['aaa111']);
  assert.deepEqual(head.mergedVibes, ['bbb222', 'ccc333']);
  assert.deepEqual(head.distills, []);
  assert.ok(head.date > 0);
});

test('lsTree and showBlob read committed content', async () => {
  const tree = await gitlib.lsTree(dir);
  assert.ok(tree.some((t) => t.path === 'a.txt'));
  assert.equal(await gitlib.showBlob(dir, 'HEAD', 'a.txt'), 'hello');
});

test('changedFiles reports a commit\'s files with status', async () => {
  fs.writeFileSync(path.join(dir, 'c.txt'), 'new');
  const sha = await gitlib.commitAll(dir, 'add c');
  const files = await gitlib.changedFiles(dir, sha);
  assert.deepEqual(files, [{ status: 'A', path: 'c.txt' }]);
});

test('worktree add/remove round-trips a branch', async () => {
  const wt = path.join(path.dirname(dir), path.basename(dir) + '-wt');
  await gitlib.addWorktree(dir, wt, 'side', 'main');
  assert.ok((await gitlib.listBranches(dir)).includes('side'));
  fs.writeFileSync(path.join(wt, 'side.txt'), 'branch work');
  await gitlib.commitAll(wt, 'side: work');
  assert.ok((await gitlib.log(dir, ['main..side'])).length === 1);
  await gitlib.removeWorktreeAndBranch(dir, wt, 'side');
  assert.ok(!(await gitlib.listBranches(dir)).includes('side'));
});
