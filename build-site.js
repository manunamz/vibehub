#!/usr/bin/env node
/*
 * build-site.js — build the static demo site (what the `net` branch deploys).
 *
 *   node build-site.js [outDir]        # default ./dist
 *
 * export.js scrapes a *running* server over HTTP, so a one-shot build has to
 * stand one up: boot the server in demo mode (which seeds ./data-demo from the
 * committed ./demo bundles), wait for it, snapshot it, then shut it down. This
 * is the Netlify build command.
 */
'use strict';
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3737);
const BASE = `http://localhost:${PORT}`;
const OUT = process.argv.slice(2).find((a) => !a.startsWith('-')) || 'dist';

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} → exit ${code}`))));
    p.on('error', reject);
  });
}

async function waitFor(url, tries = 100) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server never became ready at ${url}`);
}

(async () => {
  const server = spawn('node', ['server.js', '--demo'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, PORT: String(PORT), VIBEHUB_AGENT: 'stub' },
  });
  const stop = () => { try { server.kill('SIGTERM'); } catch { /* already gone */ } };
  process.on('exit', stop);

  try {
    await waitFor(`${BASE}/api/user`);
    await run('node', ['export.js', OUT], { VIBEHUB_URL: BASE });
  } finally {
    stop();
  }
})().catch((e) => {
  console.error('build-site failed:', e.message);
  process.exit(1);
});
