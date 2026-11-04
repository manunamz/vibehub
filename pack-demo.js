#!/usr/bin/env node
/*
 * pack-demo.js — snapshot the demo instance (./data-demo) into ./demo.
 *
 *   node pack-demo.js
 *
 * ./demo is the committed seed. The runtime dirs (data/, data-demo/) are
 * gitignored because each repo holds two real nested git repos (code/ +
 * vibes/) that git can't track as files. So each history is packed into a
 * `git bundle` (all refs), and the flat files (meta.json, status.json,
 * logs/) are copied verbatim. `seed.js` reverses this back into a runnable
 * data dir (data-demo/ for --demo mode).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DATA = path.resolve(process.env.VIBEHUB_DATA || path.join(__dirname, 'data-demo'));
const DEMO = path.resolve(path.join(__dirname, 'demo'));

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'inherit'] });

function copyIfExists(src, dest) {
  if (fs.existsSync(src)) fs.cpSync(src, dest, { recursive: true });
}

function main() {
  if (!fs.existsSync(DATA)) {
    console.error(`no data dir at ${DATA} — nothing to pack`);
    process.exit(1);
  }
  fs.rmSync(DEMO, { recursive: true, force: true });
  fs.mkdirSync(path.join(DEMO, 'repos'), { recursive: true });

  copyIfExists(path.join(DATA, 'user.json'), path.join(DEMO, 'user.json'));
  copyIfExists(path.join(DATA, 'settings.json'), path.join(DEMO, 'settings.json'));

  const reposDir = path.join(DATA, 'repos');
  const repos = fs.existsSync(reposDir)
    ? fs.readdirSync(reposDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    : [];

  for (const name of repos.sort()) {
    const src = path.join(reposDir, name);
    const out = path.join(DEMO, 'repos', name);
    fs.mkdirSync(out, { recursive: true });

    copyIfExists(path.join(src, 'meta.json'), path.join(out, 'meta.json'));
    copyIfExists(path.join(src, 'status.json'), path.join(out, 'status.json'));
    copyIfExists(path.join(src, 'logs'), path.join(out, 'logs'));

    for (const hist of ['code', 'vibes']) {
      const repoPath = path.join(src, hist);
      if (!fs.existsSync(path.join(repoPath, '.git'))) continue;
      git(repoPath, 'bundle', 'create', path.join(out, `${hist}.bundle`), '--all');
    }
    console.log(`packed ${name}`);
  }

  fs.writeFileSync(
    path.join(DEMO, 'MANIFEST.json'),
    JSON.stringify({ repos: repos.sort(), histories: ['code', 'vibes'] }, null, 2) + '\n'
  );
  console.log(`\npacked ${repos.length} repo(s) → ${path.relative(process.cwd(), DEMO)}/`);
}

if (require.main === module) main();
