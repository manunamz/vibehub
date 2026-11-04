'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const gitlib = require('./git');

const DATA_DIR = process.env.VIBEHUB_DATA || path.join(__dirname, '..', 'data');
const REPOS_DIR = path.join(DATA_DIR, 'repos');
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

fs.mkdirSync(REPOS_DIR, { recursive: true });

const BRANCH_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,60}$/;
// git-style branch names, slashes included — but nothing path-hostile
function validBranch(branch) {
  return (
    BRANCH_RE.test(branch) &&
    !branch.includes('..') &&
    !branch.includes('//') &&
    !branch.endsWith('/') &&
    !branch.endsWith('.lock')
  );
}

function repoDir(name) {
  if (!NAME_RE.test(name)) throw httpError(400, 'invalid repo name');
  return path.join(REPOS_DIR, name);
}
function checkBranch(branch) {
  if (!validBranch(branch)) throw httpError(400, 'invalid branch name (letters, digits, . _ - and slashes)');
  return branch;
}
const vibesDir = (name, branch = 'main') =>
  branch === 'main'
    ? path.join(repoDir(name), 'vibes')
    : path.join(repoDir(name), 'worktrees', checkBranch(branch), 'vibes');
const codeDir = (name, branch = 'main') =>
  branch === 'main'
    ? path.join(repoDir(name), 'code')
    : path.join(repoDir(name), 'worktrees', checkBranch(branch), 'code');
const logsDir = (name) => path.join(repoDir(name), 'logs');

function branchExists(name, branch) {
  if (branch === 'main') return true;
  return validBranch(branch) && fs.existsSync(vibesDir(name, branch));
}
const statusPath = (name) => path.join(repoDir(name), 'status.json');
const metaPath = (name) => path.join(repoDir(name), 'meta.json');

function httpError(code, message) {
  const e = new Error(message);
  e.statusCode = code;
  return e;
}

function exists(name) {
  return NAME_RE.test(name) && fs.existsSync(metaPath(name));
}

async function createRepo(name, description = '') {
  if (!NAME_RE.test(name)) throw httpError(400, 'invalid repo name (letters, digits, . _ -)');
  if (exists(name)) throw httpError(409, `repo "${name}" already exists`);
  const dir = repoDir(name);
  await fsp.mkdir(vibesDir(name), { recursive: true });
  await fsp.mkdir(codeDir(name), { recursive: true });
  await fsp.mkdir(logsDir(name), { recursive: true });
  await gitlib.initRepo(vibesDir(name), 'VibeHub User', 'you@vibehub.local');
  await gitlib.initRepo(codeDir(name), 'VibeHub Agent', 'agent@vibehub.local');
  const meta = { name, description, createdAt: Date.now() };
  await fsp.writeFile(metaPath(name), JSON.stringify(meta, null, 2));
  await fsp.writeFile(statusPath(name), '{}');
  return meta;
}

const LANG_BY_EXT = {
  '.html': 'HTML', '.js': 'JavaScript', '.mjs': 'JavaScript', '.css': 'CSS',
  '.ts': 'TypeScript', '.svg': 'SVG', '.py': 'Python', '.rs': 'Rust',
};
function detectLanguage(n) {
  try {
    const dir = codeDir(n);
    const score = {};
    for (const f of fs.readdirSync(dir)) {
      const lang = LANG_BY_EXT[path.extname(f).toLowerCase()];
      if (!lang) continue;
      try { score[lang] = (score[lang] || 0) + fs.statSync(path.join(dir, f)).size; } catch {}
    }
    const top = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : null;
  } catch {
    return null;
  }
}

// branches with unmerged vibes ≈ open vibe checks
async function openChecksFor(name, branchNames) {
  if (branchNames.length <= 1) return 0;
  const already = new Set((await gitlib.log(vibesDir(name), ['main'])).flatMap((c) => c.mergedVibes));
  let open = 0;
  for (const b of branchNames) {
    if (b === 'main') continue;
    const uniq = (await gitlib.log(vibesDir(name), [`main..${b}`]))
      .filter((c) => c.subject.startsWith('vibe:') && !already.has(c.sha));
    if (uniq.length) open++;
  }
  return open;
}

// activity sparkline: vibe commit times bucketed across the repo's lifetime
function activitySparkline(times, buckets = 24) {
  const out = Array(buckets).fill(0);
  const ts = times.filter(Boolean).sort((a, b) => a - b);
  if (!ts.length) return out;
  const start = ts[0];
  const end = Math.max(ts[ts.length - 1], start + 3600e3);
  for (const t of ts) out[Math.min(buckets - 1, Math.floor(((t - start) / (end - start)) * buckets))]++;
  return out;
}

async function listRepos() {
  const names = (await fsp.readdir(REPOS_DIR, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter(exists);
  const out = [];
  for (const n of names) {
    const meta = JSON.parse(await fsp.readFile(metaPath(n), 'utf8'));
    const status = await readStatus(n);
    const vibes = Object.values(status);
    meta.vibeCount = vibes.length;
    meta.hasApp = fs.existsSync(path.join(codeDir(n), 'index.html'));
    meta.running = vibes.some((v) => v.state === 'queued' || v.state === 'running');
    meta.lastActivity = vibes.reduce((m, v) => Math.max(m, v.createdAt || 0), meta.createdAt);
    meta.language = detectLanguage(n);
    meta.failedCount = vibes.filter((v) => v.state === 'failed').length;
    try {
      const code = fs.readdirSync(codeDir(n));
      meta.license = code.find((f) => /^licen[cs]e/i.test(f)) ? 'MIT' : null;
    } catch { meta.license = null; }
    // branches ≈ forks; branches with unmerged vibes ≈ open vibe checks
    let branchNames = ['main'];
    try { branchNames = await gitlib.listBranches(vibesDir(n)); } catch {}
    meta.branchCount = branchNames.length;
    meta.openChecks = await openChecksFor(n, branchNames);
    meta.activity = activitySparkline(vibes.map((v) => v.createdAt));
    out.push(meta);
  }
  return out.sort((a, b) => b.lastActivity - a.lastActivity);
}

async function getMeta(name) {
  if (!exists(name)) throw httpError(404, `no repo "${name}"`);
  return JSON.parse(await fsp.readFile(metaPath(name), 'utf8'));
}

async function readStatus(name) {
  try {
    return JSON.parse(await fsp.readFile(statusPath(name), 'utf8'));
  } catch {
    return {};
  }
}

// Serialize status writes per repo to avoid clobbering.
const statusLocks = new Map();
async function updateStatus(name, vibeSha, patch) {
  const prev = statusLocks.get(name) || Promise.resolve();
  const next = prev.then(async () => {
    const status = await readStatus(name);
    status[vibeSha] = { ...(status[vibeSha] || {}), ...patch };
    await fsp.writeFile(statusPath(name), JSON.stringify(status, null, 2));
    return status[vibeSha];
  });
  statusLocks.set(name, next.catch(() => {}));
  return next;
}

async function saveMeta(name, meta) {
  await fsp.writeFile(metaPath(name), JSON.stringify(meta, null, 2));
}

async function listBranchesFor(name) {
  if (!exists(name)) throw httpError(404, `no repo "${name}"`);
  const meta = await getMeta(name);
  const names = await gitlib.listBranches(vibesDir(name));
  if (!names.length) names.push('main'); // unborn branch: no refs until the first commit
  return names
    .sort((a, b) => (a === 'main' ? -1 : b === 'main' ? 1 : a.localeCompare(b)))
    .map((b) => ({ name: b, isDefault: b === 'main', ...((meta.branches || {})[b] || {}) }));
}

// Branch both histories in tandem. fromVibe (optional) is a vibe sha whose
// linked code commit becomes the code branch point; default is main HEAD.
async function createBranch(name, branch, fromVibe) {
  if (!exists(name)) throw httpError(404, `no repo "${name}"`);
  checkBranch(branch);
  if (branch === 'main' || branchExists(name, branch)) throw httpError(409, `branch "${branch}" already exists`);
  let vibePoint = 'main';
  let codePoint = 'main';
  if (fromVibe) {
    const status = await readStatus(name);
    const v = status[fromVibe];
    if (!v) throw httpError(404, `no vibe ${fromVibe.slice(0, 7)}`);
    if (!v.codeCommit) throw httpError(400, 'that vibe has no linked code commit — pick one that shipped');
    // the vibe's distill commit (if any) is its descendant and carries PROMPT.md
    // as of that vibe — fork there so the distillate travels with the branch
    vibePoint = v.distillSha || fromVibe;
    codePoint = v.codeCommit;
  }
  await fsp.mkdir(path.join(repoDir(name), 'worktrees', branch), { recursive: true });
  await gitlib.addWorktree(vibesDir(name), vibesDir(name, branch), branch, vibePoint);
  try {
    await gitlib.addWorktree(codeDir(name), codeDir(name, branch), branch, codePoint);
  } catch (err) {
    await gitlib.removeWorktreeAndBranch(vibesDir(name), vibesDir(name, branch), branch);
    throw err;
  }
  const meta = await getMeta(name);
  meta.branches = meta.branches || {};
  meta.branches[branch] = { from: fromVibe || 'main', createdAt: Date.now() };
  await saveMeta(name, meta);
  return meta.branches[branch];
}

async function deleteBranch(name, branch) {
  if (branch === 'main') throw httpError(400, 'cannot delete main');
  if (!branchExists(name, branch)) throw httpError(404, `no branch "${branch}"`);
  const status = await readStatus(name);
  if (Object.values(status).some((v) => v.branch === branch && (v.state === 'queued' || v.state === 'running'))) {
    throw httpError(409, 'agent is working on that branch — try again when it is idle');
  }
  await gitlib.removeWorktreeAndBranch(vibesDir(name), vibesDir(name, branch), branch);
  await gitlib.removeWorktreeAndBranch(codeDir(name), codeDir(name, branch), branch);
  await fsp.rm(path.join(repoDir(name), 'worktrees', branch), { recursive: true, force: true });
  const stop = path.join(repoDir(name), 'worktrees');
  let parent = path.dirname(path.join(stop, branch));
  while (parent !== stop) {
    try { await fsp.rmdir(parent); } catch { break; } // not empty — done
    parent = path.dirname(parent);
  }
  const meta = await getMeta(name);
  if (meta.branches) delete meta.branches[branch];
  await saveMeta(name, meta);
}

async function deleteRepo(name) {
  if (!exists(name)) throw httpError(404, `no repo "${name}"`);
  const status = await readStatus(name);
  if (Object.values(status).some((v) => v.state === 'queued' || v.state === 'running' || v.distill === 'running')) {
    throw httpError(409, 'an agent is working in this repo — try again when it is idle');
  }
  await fsp.rm(repoDir(name), { recursive: true, force: true });
  statusLocks.delete(name);
}

async function renameRepo(oldName, newName) {
  if (!exists(oldName)) throw httpError(404, `no repo "${oldName}"`);
  if (!NAME_RE.test(newName)) throw httpError(400, 'invalid repo name (letters, digits, . _ -)');
  if (newName === oldName) return getMeta(oldName);
  if (exists(newName)) throw httpError(409, `repo "${newName}" already exists`);
  const status = await readStatus(oldName);
  if (Object.values(status).some((v) => v.state === 'queued' || v.state === 'running')) {
    throw httpError(409, 'agent is working — try again when the queue is idle');
  }
  await fsp.rename(repoDir(oldName), repoDir(newName));
  statusLocks.delete(oldName);
  const meta = JSON.parse(await fsp.readFile(metaPath(newName), 'utf8'));
  meta.name = newName;
  await fsp.writeFile(metaPath(newName), JSON.stringify(meta, null, 2));
  // git worktree metadata stores absolute paths — repair after the move
  const branchNames = Object.keys(meta.branches || {});
  if (branchNames.length) {
    await gitlib.repairWorktrees(vibesDir(newName), branchNames.map((b) => vibesDir(newName, b)));
    await gitlib.repairWorktrees(codeDir(newName), branchNames.map((b) => codeDir(newName, b)));
  }
  return meta;
}

// persistent user profile (single-user for now)
const USER_PATH = path.join(DATA_DIR, 'user.json');
const USER_DEFAULTS = {
  name: process.env.VIBEHUB_USER || 'vibybara',
  tagline: 'the vibing capybara',
  bio: 'Ships software by committing vibes — prompts, plans, and rambles. The agents commit all the code.',
  location: 'the hot spring',
  link: '#/r/vibybara.dev',
  avatar: '', // data: URL of an uploaded userpic; empty ⇒ default artwork
};
async function readUser() {
  try {
    return { ...USER_DEFAULTS, ...JSON.parse(await fsp.readFile(USER_PATH, 'utf8')) };
  } catch {
    return { ...USER_DEFAULTS };
  }
}
async function writeUser(patch) {
  const cur = await readUser();
  const limits = { name: 40, tagline: 60, bio: 240, location: 60, link: 140 };
  for (const [k, max] of Object.entries(limits)) {
    if (patch[k] !== undefined) cur[k] = String(patch[k]).trim().slice(0, max);
  }
  if (patch.avatar !== undefined) {
    const a = String(patch.avatar);
    if (!a) {
      cur.avatar = ''; // cleared ⇒ fall back to default artwork
    } else if (!/^data:image\/(png|jpeg|gif|webp);base64,/.test(a)) {
      throw httpError(400, 'avatar must be an image data URL');
    } else if (a.length > 1_500_000) {
      throw httpError(400, 'avatar too large — pick a smaller image');
    } else {
      cur.avatar = a;
    }
  }
  if (!cur.name) throw httpError(400, 'name is required');
  await fsp.writeFile(USER_PATH, JSON.stringify(cur, null, 2));
  return cur;
}

const SETTINGS_DEFAULTS = {
  agentKind: 'auto',
  agentModel: 'default',
  distillerModel: process.env.VIBEHUB_DISTILLER_MODEL || 'haiku',
};
// Per-repo agent settings, stored in the repo's meta.json
async function readRepoSettings(name) {
  const meta = await getMeta(name);
  return { ...SETTINGS_DEFAULTS, ...(meta.settings || {}), description: meta.description || '' };
}
async function writeRepoSettings(name, patch) {
  const MODEL_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
  const meta = await getMeta(name);
  const cur = { ...SETTINGS_DEFAULTS, ...(meta.settings || {}) };
  for (const k of ['agentModel', 'distillerModel']) {
    if (patch[k] !== undefined) {
      if (!MODEL_RE.test(String(patch[k]))) throw httpError(400, `invalid model for ${k}`);
      cur[k] = String(patch[k]);
    }
  }
  if (patch.agentKind !== undefined) {
    if (!/^(auto|claude|codex|stub)$/.test(String(patch.agentKind))) {
      throw httpError(400, 'agent must be auto, claude, codex, or stub');
    }
    cur.agentKind = String(patch.agentKind);
  }
  meta.settings = cur;
  if (patch.description !== undefined) {
    meta.description = String(patch.description).slice(0, 200);
  }
  await saveMeta(name, meta);
  return { ...cur, description: meta.description || '' };
}

module.exports = {
  DATA_DIR,
  readUser,
  writeUser,
  deleteRepo,
  readRepoSettings,
  writeRepoSettings,
  renameRepo,
  branchExists,
  createBranch,
  deleteBranch,
  listBranchesFor,
  vibesDir,
  codeDir,
  logsDir,
  exists,
  createRepo,
  listRepos,
  getMeta,
  readStatus,
  updateStatus,
  httpError,
};
