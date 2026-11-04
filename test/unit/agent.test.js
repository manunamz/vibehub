'use strict';
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const agent = require('../../lib/agent');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vibehub-agent-'));
let n = 0;
let cwd, logPath;
beforeEach(() => {
  cwd = path.join(tmp, `run-${n++}`);
  fs.mkdirSync(cwd, { recursive: true });
  logPath = path.join(cwd, 'agent.log');
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('stub agent writes index.html and reports itself', async () => {
  const r = await agent.runAgent({ prompt: 'a page', plan: '' }, cwd, logPath, { kind: 'stub' });
  assert.equal(r.model, 'stub');
  assert.ok(fs.existsSync(path.join(cwd, 'index.html')));
  assert.match(fs.readFileSync(logPath, 'utf8'), /coding agent: stub/);
});

test('stub agent appends on later vibes instead of restarting', async () => {
  await agent.runAgent({ prompt: 'first', plan: '' }, cwd, logPath, { kind: 'stub' });
  await agent.runAgent({ prompt: 'second', plan: '' }, cwd, logPath, { kind: 'stub' });
  const html = fs.readFileSync(path.join(cwd, 'index.html'), 'utf8');
  assert.ok(html.includes('first') && html.includes('second'));
});

test('VIBEHUB_AGENT=stub overrides any requested kind', async () => {
  process.env.VIBEHUB_AGENT = 'stub';
  try {
    const r = await agent.runAgent({ prompt: 'x', plan: '' }, cwd, logPath, { kind: 'claude' });
    assert.equal(r.model, 'stub');
  } finally {
    delete process.env.VIBEHUB_AGENT;
  }
});

test('unknown agent kind throws a helpful error', async () => {
  await assert.rejects(
    agent.runAgent({ prompt: 'x', plan: '' }, cwd, logPath, { kind: 'skynet' }),
    /unknown agent "skynet"/
  );
});

test('codex kind without the CLI rejects cleanly (vibe becomes failed, rerunnable)', async (t) => {
  const { execSync } = require('node:child_process');
  try { execSync('command -v codex', { stdio: 'ignore' }); t.skip('codex installed here'); return; } catch {}
  await assert.rejects(
    agent.runAgent({ prompt: 'x', plan: '' }, cwd, logPath, { kind: 'codex' }),
    /codex CLI not found/
  );
});

test('stub distiller accumulates the previous distillate', async () => {
  process.env.VIBEHUB_AGENT = 'stub'; // distiller follows global mode, not opts.kind
  try {
    const d1 = await agent.runDistiller({ prev: '', prompt: 'a todo list', plan: '' }, cwd, logPath, { model: 'default' });
    assert.match(d1.text, /Then: a todo list/);
    const d2 = await agent.runDistiller({ prev: d1.text, prompt: 'dark mode', plan: '' }, cwd, logPath, {});
    assert.ok(d2.text.includes('Then: a todo list') && d2.text.includes('Then: dark mode'));
  } finally {
    delete process.env.VIBEHUB_AGENT;
  }
});

test('stub ramble cleanup: first sentence becomes prompt, rest becomes plan', async () => {
  process.env.VIBEHUB_AGENT = 'stub';
  try {
    const r = await agent.runRambleCleanup('build me a thing. it should glow. maybe sparkle too.', cwd, logPath);
    assert.equal(r.prompt, 'build me a thing.');
    assert.match(r.plan, /- it should glow\./);
    assert.match(r.plan, /- maybe sparkle too\./);
  } finally {
    delete process.env.VIBEHUB_AGENT;
  }
});
