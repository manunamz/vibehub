'use strict';
/* Feature-test harness: boots a real VibeHub server in stub-agent mode on a
 * scratch data dir, and exposes tiny HTTP helpers. Stub agents are instant and
 * free, so these tests exercise the full pipeline end to end.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibehub-feat-'));
  const port = 4100 + Math.floor(Math.random() * 3000);
  const child = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, VIBEHUB_DATA: dataDir, PORT: String(port), VIBEHUB_AGENT: 'stub' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const base = `http://localhost:${port}`;
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      const r = await fetch(`${base}/api/repos`);
      if (r.ok) break;
    } catch {}
    if (Date.now() > deadline) {
      child.kill();
      throw new Error('server did not come up');
    }
    await sleep(100);
  }
  return {
    base,
    dataDir,
    stop() {
      child.kill();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function j(base, p, body, method) {
  const res = await fetch(base + p, body !== undefined
    ? { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
  const ct = res.headers.get('content-type') || '';
  const out = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, body: out };
}

// wait until a vibe has fully settled (agent + distill), or timeout
async function waitVibe(base, repo, sha, branch = 'main') {
  const q = branch === 'main' ? '' : `?branch=${encodeURIComponent(branch)}`;
  const deadline = Date.now() + 10000;
  for (;;) {
    const { body } = await j(base, `/api/repos/${repo}${q}`);
    const v = (body.vibes || []).find((x) => x.sha === sha);
    if (v && (v.state === 'failed' || (v.state === 'done' && (v.distill === 'done' || v.distill === 'failed')))) {
      return v;
    }
    if (Date.now() > deadline) throw new Error(`vibe ${sha.slice(0, 7)} never settled`);
    await sleep(100);
  }
}

// convenience: commit a vibe and wait for it to settle
async function vibe(base, repo, payload, branch = 'main') {
  const { status, body } = await j(base, `/api/repos/${repo}/vibes`, { ...payload, branch });
  if (status !== 201) throw new Error(`vibe failed: ${JSON.stringify(body)}`);
  return waitVibe(base, repo, body.vibeSha, branch);
}

module.exports = { startServer, j, waitVibe, vibe, sleep };
