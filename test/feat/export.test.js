'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, j, vibe } = require('./_harness');

const ROOT = path.join(__dirname, '..', '..');
let s, out, v;

before(async () => {
  s = await startServer();
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'vibehub-dist-'));
  await j(s.base, '/api/repos', { name: 'demo', description: 'exported' });
  v = await vibe(s.base, 'demo', { prompt: 'tiny app' });
  await j(s.base, '/api/repos/demo/branches', { name: 'exp/alt' });
  await vibe(s.base, 'demo', { prompt: 'alternate take' }, 'exp/alt');
  await new Promise((resolve, reject) =>
    execFile('node', ['export.js', out], {
      cwd: ROOT,
      env: { ...process.env, VIBEHUB_URL: s.base, VIBEHUB_REPO_URL: 'https://example.com/repo' },
    }, (err, stdout, stderr) => (err ? reject(new Error(stderr || String(err))) : resolve()))
  );
});
after(() => { s.stop(); fs.rmSync(out, { recursive: true, force: true }); });

const has = (p) => fs.existsSync(path.join(out, p));

test('shell exported with static flag and repo url injected', () => {
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.match(html, /VIBEHUB_STATIC = true/);
  assert.match(html, /example\.com\/repo/);
  assert.ok(has('style.css'));
  // every script the shell references must be in the export
  for (const m of html.matchAll(/<script src="\/([^"]+)">/g)) assert.ok(has(m[1]), `missing ${m[1]}`);
});

test('api snapshot matches the static path layout the SPA expects', () => {
  for (const p of [
    'api/user.json',
    'api/repos.json',
    'api/repos/demo/index.json',
    'api/repos/demo/branches.json',
    'api/repos/demo/prompt.json',
    'api/repos/demo/prompt/history.json',
    'api/repos/demo/code/commits.json',
    'api/repos/demo/code/tree/HEAD.json',
    `api/repos/demo/vibes/${v.sha}/log.txt`,
    'api/repos/demo/branch/exp/alt/index.json',
    'api/repos/demo/compare/exp/alt.json',
  ]) assert.ok(has(p), `missing ${p}`);
});

test('previews exported live and per-commit, for main and branches', () => {
  assert.ok(has('preview/demo/index.html'));
  assert.ok(has(`preview/demo/@${v.codeCommit}/index.html`));
  assert.ok(has('preview/demo/~exp/alt/index.html'));
});

test('exported repo list marks nothing as running', () => {
  const repos = JSON.parse(fs.readFileSync(path.join(out, 'api/repos.json'), 'utf8'));
  assert.ok(repos.every((r) => r.running === false));
});
