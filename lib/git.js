'use strict';
const { execFile } = require('child_process');

const SEP = '\x1f';
const EOL = '\x1e';

function git(args, cwd, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args.join(' ')}: ${(stderr || err.message).trim()}`));
      else resolve(stdout);
    });
  });
}

async function initRepo(dir, name, email) {
  await git(['init', '-b', 'main'], dir);
  await git(['config', 'user.name', name], dir);
  await git(['config', 'user.email', email], dir);
  await git(['config', 'commit.gpgsign', 'false'], dir);
}

async function commitAll(dir, message, author) {
  await git(['add', '-A'], dir);
  const args = ['commit', '--allow-empty', '-m', message];
  if (author) args.push(`--author=${author}`);
  await git(args, dir);
  return (await git(['rev-parse', 'HEAD'], dir)).trim();
}

// Returns [] for a repo with no commits yet.
async function log(dir, extra = []) {
  let out;
  try {
    out = await git(
      ['log', `--pretty=format:%H${SEP}%at${SEP}%an${SEP}%s${SEP}%(trailers:key=Vibe-Commit,valueonly,separator=%x2C)${SEP}%(trailers:key=Distills,valueonly,separator=%x2C)${SEP}%(trailers:key=Merged-Vibe,valueonly,separator=%x2C)${EOL}`, ...extra],
      dir
    );
  } catch {
    return [];
  }
  const list = (s) => (s ? s.split(',').map((v) => v.trim()).filter(Boolean) : []);
  return out
    .split(EOL)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, at, author, subject, vibes, distills, merged] = line.split(SEP);
      return {
        sha,
        date: Number(at) * 1000,
        author,
        subject,
        vibeCommits: list(vibes),
        distills: list(distills),
        mergedVibes: list(merged),
      };
    });
}

async function showDiff(dir, sha) {
  return git(['show', sha, '--patch', '--stat', '--no-color', '--format=%H%n%an%n%at%n%B%x1e'], dir);
}

async function changedFiles(dir, sha) {
  const out = await git(['show', sha, '--name-status', '--format='], dir);
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [status, ...rest] = l.split('\t');
      return { status: status[0], path: rest[rest.length - 1] };
    });
}

async function lsTree(dir, ref = 'HEAD') {
  let out;
  try {
    out = await git(['ls-tree', '-r', '--format=%(objecttype)\t%(path)', ref], dir);
  } catch {
    return [];
  }
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [type, p] = l.split('\t');
      return { type, path: p };
    });
}

// binary-safe file read at a ref (for serving historical previews)
function showBlobRaw(dir, ref, filePath) {
  return new Promise((resolve, reject) => {
    execFile('git', ['show', `${ref}:${filePath}`], { cwd: dir, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' },
      (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

async function showBlob(dir, ref, filePath) {
  return git(['show', `${ref}:${filePath}`], dir);
}

async function listBranches(dir) {
  const out = await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], dir);
  return out.split('\n').filter(Boolean);
}

// Create branch at startPoint and check it out into a new worktree.
async function addWorktree(dir, wtPath, branch, startPoint) {
  await git(['worktree', 'add', '-b', branch, wtPath, startPoint], dir);
}

async function removeWorktreeAndBranch(dir, wtPath, branch) {
  try {
    await git(['worktree', 'remove', '--force', wtPath], dir);
  } catch { /* worktree may already be gone */ }
  try {
    await git(['branch', '-D', branch], dir);
  } catch { /* branch may already be gone */ }
}

async function repairWorktrees(dir, wtPaths) {
  try {
    await git(['worktree', 'repair', ...wtPaths], dir);
  } catch { /* best effort after a repo dir rename */ }
}

module.exports = {
  git, initRepo, commitAll, log, showDiff, changedFiles, lsTree, showBlob, showBlobRaw,
  listBranches, addWorktree, removeWorktreeAndBranch, repairWorktrees,
};
