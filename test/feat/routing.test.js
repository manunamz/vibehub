'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startServer } = require('./_harness');

let S;
before(async () => { S = await startServer(); });
after(() => S.stop());

async function get(p) {
  const res = await fetch(S.base + p);
  return { status: res.status, ctype: res.headers.get('content-type') || '', body: await res.text() };
}

test('GET / serves the app shell', async () => {
  const r = await get('/');
  assert.strictEqual(r.status, 200);
  assert.match(r.ctype, /text\/html/);
  assert.match(r.body, /id="app"/);
});

test('clean-path app routes fall back to the shell', async () => {
  const paths = [
    '/vibybara',
    '/vibybara/hacktube',
    '/vibybara/hacktube/code',
    '/vibybara/hacktube/code/deadbeef',
    '/vibybara/hacktube/prompt/abc123',
    '/vibybara/hacktube/vibe/sha1/all',
    '/vibybara/hacktube@dev/prompt',
  ];
  for (const p of paths) {
    const r = await get(p);
    assert.strictEqual(r.status, 200, `${p} status`);
    assert.match(r.ctype, /text\/html/, `${p} ctype`);
    assert.match(r.body, /id="app"/, `${p} shell`);
  }
});

test('real assets and APIs are not shadowed by the fallback', async () => {
  const route = await get('/js/00-route.js');
  assert.strictEqual(route.status, 200);
  assert.match(route.ctype, /javascript/);

  const css = await get('/style.css');
  assert.strictEqual(css.status, 200);
  assert.match(css.ctype, /css/);

  const api = await get('/api/repos');
  assert.strictEqual(api.status, 200);
  assert.match(api.ctype, /json/);
});

test('unmatched API routes stay JSON 404 (never the HTML shell)', async () => {
  const r = await get('/api/bogus');
  assert.strictEqual(r.status, 404);
  assert.match(r.ctype, /json/);
  assert.doesNotMatch(r.body, /id="app"/);
});
