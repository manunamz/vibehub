'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseRoute, isAppPath } = require('../../public/js/00-route.js');

// URLs mirror GitHub: /<user>/<repo>[@branch]/<section>[/<id>]. The <user>
// segment is cosmetic (single-user) and ignored when resolving the route.

test('parseRoute: home — "/" or a bare user segment', () => {
  assert.deepStrictEqual(parseRoute('/'), { view: 'home' });
  assert.deepStrictEqual(parseRoute(''), { view: 'home' });
  assert.deepStrictEqual(parseRoute('/vibybara'), { view: 'home' });
});

test('parseRoute: repo (default branch main)', () => {
  assert.deepStrictEqual(parseRoute('/vibybara/hacktube'),
    { view: 'repo', repo: 'hacktube', branch: 'main' });
});

test('parseRoute: code view + code commit', () => {
  assert.deepStrictEqual(parseRoute('/vibybara/hacktube/code'),
    { view: 'code', repo: 'hacktube', branch: 'main' });
  assert.deepStrictEqual(parseRoute('/vibybara/hacktube/code/abc123'),
    { view: 'commit', repo: 'hacktube', branch: 'main', sha: 'abc123' });
});

test('parseRoute: prompt tab + distill commit', () => {
  assert.deepStrictEqual(parseRoute('/vibybara/hacktube/prompt'),
    { view: 'prompt', repo: 'hacktube', branch: 'main' });
  assert.deepStrictEqual(parseRoute('/vibybara/hacktube/prompt/def456'),
    { view: 'promptCommit', repo: 'hacktube', branch: 'main', sha: 'def456' });
});

test('parseRoute: vibe detail + trio (all)', () => {
  assert.deepStrictEqual(parseRoute('/vibybara/hacktube/vibe/sha1'),
    { view: 'vibe', repo: 'hacktube', branch: 'main', sha: 'sha1' });
  assert.deepStrictEqual(parseRoute('/vibybara/hacktube/vibe/sha1/all'),
    { view: 'vibeAll', repo: 'hacktube', branch: 'main', sha: 'sha1' });
});

test('parseRoute: vibe check', () => {
  assert.deepStrictEqual(parseRoute('/vibybara/hacktube/check'),
    { view: 'check', repo: 'hacktube', branch: 'main' });
});

test('parseRoute: blob paths keep nested slashes', () => {
  assert.deepStrictEqual(parseRoute('/vibybara/hacktube/blob/HEAD/index.html'),
    { view: 'blob', repo: 'hacktube', branch: 'main', ref: 'HEAD', path: 'index.html' });
  assert.deepStrictEqual(parseRoute('/vibybara/hacktube/blob/HEAD/src/app.js'),
    { view: 'blob', repo: 'hacktube', branch: 'main', ref: 'HEAD', path: 'src/app.js' });
});

test('parseRoute: branch via @, slash-safe (percent-encoded)', () => {
  assert.deepStrictEqual(parseRoute('/vibybara/myrepo@dev'),
    { view: 'repo', repo: 'myrepo', branch: 'dev' });
  assert.deepStrictEqual(parseRoute('/vibybara/myrepo@dev/code'),
    { view: 'code', repo: 'myrepo', branch: 'dev' });
  assert.deepStrictEqual(parseRoute('/vibybara/myrepo@feat%2Fdark-mode'),
    { view: 'repo', repo: 'myrepo', branch: 'feat/dark-mode' });
});

test('parseRoute: unknown routes → 404', () => {
  assert.strictEqual(parseRoute('/vibybara/hacktube/bogus').view, '404');
  assert.strictEqual(parseRoute('/vibybara/hacktube/vibe').view, '404');
});

test('isAppPath: internal routes yes; server-reserved prefixes no', () => {
  assert.strictEqual(isAppPath('/'), true);
  assert.strictEqual(isAppPath('/vibybara'), true);
  assert.strictEqual(isAppPath('/vibybara/hacktube'), true);
  assert.strictEqual(isAppPath('/vibybara/hacktube/vibe/x/all'), true);
  assert.strictEqual(isAppPath('/api/repos'), false);
  assert.strictEqual(isAppPath('/preview/hacktube/'), false);
  assert.strictEqual(isAppPath('/js/01-core.js'), false);
  assert.strictEqual(isAppPath('https://github.com/x'), false);
});
