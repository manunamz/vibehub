#!/usr/bin/env node
/*
 * seed.js — reconstruct a runnable data dir from the committed ./demo seed.
 *
 *   node seed.js                       # → ./data-demo  (refuses if it has repos)
 *   node seed.js --data some/dir       # → a specific dir
 *   node seed.js --force               # wipe target first, then seed
 *
 * Each repo's code/ and vibes/ histories are rebuilt from their bundles (all
 * branches restored, default branch checked out). Also exported as seed() so
 * `--demo` mode (lib/mode.js) and the static build can seed programmatically.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT_DEMO = path.join(__dirname, 'demo');

// git identities, mirroring how the live app attributes each history.
const IDENTITY = {
  code: { name: 'VibeHub Agent', email: 'agent@vibehub.local' },
  vibes: { name: 'VibeHub User', email: 'you@vibehub.local' },
};

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'inherit'] });

function restoreHistory(bundle, dest, who) {
  fs.mkdirSync(dest, { recursive: true });
  // Init on a throwaway unborn branch so the fetch below never targets a
  // checked-out ref; it vanishes once we check out the real default branch.
  git(dest, 'init', '-q', '-b', '__seeding__');
  git(dest, 'config', 'user.name', who.name);
  git(dest, 'config', 'user.email', who.email);
  git(dest, 'config', 'commit.gpgsign', 'false');
  // Pull every branch out of the bundle without leaving an `origin` remote.
  git(dest, 'fetch', '-q', bundle, 'refs/heads/*:refs/heads/*');
  const heads = execFileSync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], { cwd: dest })
    .toString().trim().split('\n').filter(Boolean);
  const def = heads.includes('main') ? 'main' : heads[0];
  git(dest, 'checkout', '-q', '-f', def);
}

// Branches are served from per-branch git worktrees. The bundles restore only
// the refs, so recreate a worktree for every non-main branch (in both the code
// and vibes histories) — otherwise branchExists() is false and the app 404s on
// that branch, which aborts the static export.
function materializeBranches(repoOut) {
  const vibesPath = path.join(repoOut, 'vibes');
  if (!fs.existsSync(vibesPath)) return;
  const heads = execFileSync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], { cwd: vibesPath })
    .toString().trim().split('\n').filter(Boolean).filter((b) => b !== 'main');
  for (const b of heads) {
    git(path.join(repoOut, 'code'), 'worktree', 'add', path.join(repoOut, 'worktrees', b, 'code'), b);
    git(vibesPath, 'worktree', 'add', path.join(repoOut, 'worktrees', b, 'vibes'), b);
  }
}

// Reconstruct `dataDir` from the bundle seed at `demoDir`. Returns repo names.
function seed({ dataDir, demoDir = DEFAULT_DEMO, force = false } = {}) {
  dataDir = path.resolve(dataDir);
  demoDir = path.resolve(demoDir);
  if (!fs.existsSync(demoDir)) throw new Error(`no demo seed at ${demoDir}`);

  const reposDir = path.join(dataDir, 'repos');
  if (fs.existsSync(reposDir) && fs.readdirSync(reposDir).length) {
    if (!force) throw new Error(`${reposDir} already has repos — pass { force: true } to overwrite`);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  fs.mkdirSync(reposDir, { recursive: true });

  for (const f of ['user.json', 'settings.json']) {
    const src = path.join(demoDir, f);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(dataDir, f));
  }

  const demoRepos = path.join(demoDir, 'repos');
  const repos = fs.existsSync(demoRepos)
    ? fs.readdirSync(demoRepos, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    : [];

  for (const name of repos.sort()) {
    const src = path.join(demoRepos, name);
    const out = path.join(reposDir, name);
    fs.mkdirSync(out, { recursive: true });
    for (const f of ['meta.json', 'status.json', 'logs']) {
      const s = path.join(src, f);
      if (fs.existsSync(s)) fs.cpSync(s, path.join(out, f), { recursive: true });
    }
    for (const hist of ['code', 'vibes']) {
      const bundle = path.join(src, `${hist}.bundle`);
      if (fs.existsSync(bundle)) restoreHistory(bundle, path.join(out, hist), IDENTITY[hist]);
    }
    materializeBranches(out);
  }
  return repos.sort();
}

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const dataDir = flag(argv, '--data') || process.env.VIBEHUB_DATA || path.join(__dirname, 'data-demo');
  const demoDir = flag(argv, '--demo-dir') || DEFAULT_DEMO;
  const force = argv.includes('--force');
  const repos = seed({ dataDir, demoDir, force });
  for (const r of repos) console.log(`seeded ${r}`);
  console.log(`\nseeded ${repos.length} repo(s) → ${path.relative(process.cwd(), path.resolve(dataDir))}/`);
}

module.exports = { seed };
