'use strict';
/* HTTP layer only: routing, body parsing, static files, previews.
 * Domain logic lives in lib/pipeline.js; storage in lib/store.js.
 */
// Resolve use/demo mode (and seed demo data) before store reads VIBEHUB_DATA.
require('./lib/mode').apply(process.argv.slice(2), __dirname);
const http = require('http');
const fsp = require('fs/promises');
const path = require('path');
const store = require('./lib/store');
const gitlib = require('./lib/git');
const agentlib = require('./lib/agent');
const pipeline = require('./lib/pipeline');

const PORT = Number(process.env.PORT || 3737);
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};
const TEXT = 'text/plain; charset=utf-8';

function send(res, code, body, type = 'application/json; charset=utf-8') {
  const data = type.startsWith('application/json') ? JSON.stringify(body) : body;
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 2 * 1024 * 1024) reject(store.httpError(413, 'body too large'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(store.httpError(400, 'invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

async function serveFile(res, baseDir, relPath) {
  const full = path.normalize(path.join(baseDir, relPath));
  if (!full.startsWith(baseDir + path.sep) && full !== baseDir) {
    return send(res, 403, { error: 'forbidden' });
  }
  let target = full;
  try {
    const st = await fsp.stat(target);
    if (st.isDirectory()) target = path.join(target, 'index.html');
    const data = await fsp.readFile(target);
    send(res, 200, data, MIME[path.extname(target).toLowerCase()] || 'application/octet-stream');
  } catch {
    send(res, 404, 'not found', TEXT);
  }
}

function branchOf(repo, url) {
  const b = url.searchParams.get('branch') || 'main';
  if (!store.branchExists(repo, b)) throw store.httpError(404, `no branch "${b}"`);
  return b;
}

// ---------------------------------------------------------------- routes

const routes = [
  { m: 'GET', re: /^\/api\/user$/,
    h: async (req, res) => send(res, 200, await store.readUser()) },

  { m: 'POST', re: /^\/api\/user$/,
    h: async (req, res) => send(res, 200, await store.writeUser(await readBody(req))) },

  { m: 'GET', re: /^\/api\/repos$/,
    h: async (req, res) => send(res, 200, await store.listRepos()) },

  { m: 'POST', re: /^\/api\/repos$/,
    h: async (req, res) => {
      const body = await readBody(req);
      send(res, 201, await store.createRepo(String(body.name || ''), String(body.description || '')));
    } },

  { m: 'GET', re: /^\/api\/repos\/([^/]+)$/,
    h: async (req, res, [repo], url) => send(res, 200, await pipeline.repoDetail(repo, branchOf(repo, url))) },

  { m: 'GET', re: /^\/api\/repos\/([^/]+)\/settings$/,
    h: async (req, res, [repo]) => send(res, 200, await store.readRepoSettings(repo)) },

  { m: 'POST', re: /^\/api\/repos\/([^/]+)\/settings$/,
    h: async (req, res, [repo]) => send(res, 200, await store.writeRepoSettings(repo, await readBody(req))) },

  { m: 'POST', re: /^\/api\/repos\/([^/]+)\/rename$/,
    h: async (req, res, [repo]) => {
      const body = await readBody(req);
      send(res, 200, await store.renameRepo(repo, String(body.name || '')));
    } },

  { m: 'POST', re: /^\/api\/repos\/([^/]+)\/delete$/,
    h: async (req, res, [repo]) => {
      await store.deleteRepo(repo);
      send(res, 200, { ok: true });
    } },

  { m: 'GET', re: /^\/api\/repos\/([^/]+)\/branches$/,
    h: async (req, res, [repo]) => send(res, 200, await store.listBranchesFor(repo)) },

  { m: 'POST', re: /^\/api\/repos\/([^/]+)\/branches$/,
    h: async (req, res, [repo]) => {
      const body = await readBody(req);
      send(res, 201, await store.createBranch(repo, String(body.name || ''), body.fromVibe ? String(body.fromVibe) : undefined));
    } },

  { m: 'POST', re: /^\/api\/repos\/([^/]+)\/branches\/(.+)\/delete$/,
    h: async (req, res, [repo, branch]) => {
      const body = await readBody(req);
      await pipeline.deleteBranch(repo, branch, !!body.force);
      send(res, 200, { ok: true });
    } },

  { m: 'GET', re: /^\/api\/repos\/([^/]+)\/compare$/,
    h: async (req, res, [repo], url) => {
      await store.getMeta(repo);
      send(res, 200, await pipeline.compareBranches(repo, url.searchParams.get('with') || '', url.searchParams.get('base') || 'main'));
    } },

  { m: 'POST', re: /^\/api\/repos\/([^/]+)\/merge$/,
    h: async (req, res, [repo]) => {
      await store.getMeta(repo);
      const body = await readBody(req);
      send(res, 201, await pipeline.mergeBranch(repo, String(body.branch || ''), String(body.base || 'main')));
    } },

  { m: 'POST', re: /^\/api\/repos\/([^/]+)\/vibes$/,
    h: async (req, res, [repo]) => {
      await store.getMeta(repo);
      const body = await readBody(req);
      const branch = String(body.branch || 'main');
      if (!store.branchExists(repo, branch)) throw store.httpError(404, `no branch "${branch}"`);
      send(res, 201, await pipeline.createVibe(repo, String(body.prompt || ''), String(body.plan || ''), String(body.ramble || ''), branch));
    } },

  { m: 'POST', re: /^\/api\/repos\/([^/]+)\/vibes\/([0-9a-f]{6,40})\/rerun$/,
    h: async (req, res, [repo, sha]) => {
      await store.getMeta(repo);
      await pipeline.rerunVibe(repo, sha);
      send(res, 200, { ok: true });
    } },

  { m: 'GET', re: /^\/api\/repos\/([^/]+)\/vibes\/([0-9a-f]{6,40})\/log$/,
    h: async (req, res, [repo, sha]) => {
      await store.getMeta(repo);
      try {
        send(res, 200, await fsp.readFile(path.join(store.logsDir(repo), `${sha}.log`), 'utf8'), TEXT);
      } catch {
        send(res, 200, '(no agent log yet)', TEXT);
      }
    } },

  { m: 'POST', re: /^\/api\/repos\/([^/]+)\/prompt$/,
    h: async (req, res, [repo]) => {
      await store.getMeta(repo);
      const body = await readBody(req);
      const sha = await pipeline.editPrompt(repo, String(body.branch || 'main'), String(body.body || '').trim());
      send(res, 200, { ok: true, sha });
    } },

  { m: 'GET', re: /^\/api\/repos\/([^/]+)\/prompt$/,
    h: async (req, res, [repo], url) => {
      await store.getMeta(repo);
      const branch = branchOf(repo, url);
      const p = await pipeline.readCurrentPrompt(repo, branch);
      if (!p) return send(res, 200, { exists: false });
      const history = await gitlib.log(store.vibesDir(repo, branch), ['--', 'PROMPT.md']);
      send(res, 200, { exists: true, front: p.front, body: p.body, latest: history[0] || null });
    } },

  { m: 'GET', re: /^\/api\/repos\/([^/]+)\/prompt\/history$/,
    h: async (req, res, [repo], url) => {
      await store.getMeta(repo);
      send(res, 200, await gitlib.log(store.vibesDir(repo, branchOf(repo, url)), ['--', 'PROMPT.md']));
    } },

  { m: 'GET', re: /^\/api\/repos\/([^/]+)\/prompt\/at\/([0-9a-f]{6,40})$/,
    h: async (req, res, [repo, sha], url) => {
      await store.getMeta(repo);
      try {
        const text = await gitlib.showBlob(store.vibesDir(repo, branchOf(repo, url)), sha, 'PROMPT.md');
        send(res, 200, { exists: true, ...pipeline.parsePromptMd(text) });
      } catch {
        send(res, 404, { error: 'no PROMPT.md at that commit' });
      }
    } },

  { m: 'GET', re: /^\/api\/repos\/([^/]+)\/prompt\/commits\/([0-9a-f]{6,40})$/,
    h: async (req, res, [repo, sha], url) => {
      await store.getMeta(repo);
      send(res, 200, await pipeline.commitInfo(store.vibesDir(repo, branchOf(repo, url)), sha));
    } },

  { m: 'GET', re: /^\/api\/repos\/([^/]+)\/code\/commits$/,
    h: async (req, res, [repo], url) => {
      await store.getMeta(repo);
      send(res, 200, await gitlib.log(store.codeDir(repo, branchOf(repo, url))));
    } },

  { m: 'GET', re: /^\/api\/repos\/([^/]+)\/code\/commits\/([0-9a-f]{6,40})$/,
    h: async (req, res, [repo, sha], url) => {
      await store.getMeta(repo);
      send(res, 200, await pipeline.commitInfo(store.codeDir(repo, branchOf(repo, url)), sha));
    } },

  { m: 'GET', re: /^\/api\/repos\/([^/]+)\/code\/tree$/,
    h: async (req, res, [repo], url) => {
      await store.getMeta(repo);
      send(res, 200, await gitlib.lsTree(store.codeDir(repo, branchOf(repo, url)), url.searchParams.get('ref') || 'HEAD'));
    } },

  { m: 'GET', re: /^\/api\/repos\/([^/]+)\/code\/blob$/,
    h: async (req, res, [repo], url) => {
      await store.getMeta(repo);
      const p = url.searchParams.get('path') || '';
      if (!p || p.includes('..')) throw store.httpError(400, 'bad path');
      const content = await gitlib.showBlob(store.codeDir(repo, branchOf(repo, url)), url.searchParams.get('ref') || 'HEAD', p);
      send(res, 200, content, TEXT);
    } },
];

// ---------------------------------------------------------------- previews

// /preview/<repo>[/~branch][/@sha]/path — branch names may contain slashes,
// so the branch segment is matched greedily against existing branches.
async function servePreview(res, p) {
  const segs0 = p.split('/');
  const repo = segs0[2];
  let rest = segs0.slice(3);
  if (!store.exists(repo)) return send(res, 404, { error: 'no such repo' });
  let branch = 'main';
  if (rest[0] && rest[0].startsWith('~')) {
    const segs = [rest[0].slice(1), ...rest.slice(1)];
    let found = null;
    for (let i = segs.length; i >= 1; i--) {
      const cand = segs.slice(0, i).join('/');
      if (store.branchExists(repo, cand)) { found = cand; rest = segs.slice(i); break; }
    }
    if (!found) return send(res, 404, { error: 'no such branch' });
    branch = found;
  }
  if (rest[0] && rest[0].startsWith('@')) {
    const ref = rest.shift().slice(1);
    if (!/^[0-9a-f]{6,40}$/.test(ref)) return send(res, 404, { error: 'bad ref' });
    let rel = rest.join('/');
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    try {
      const data = await gitlib.showBlobRaw(store.codeDir(repo, branch), ref, rel);
      return send(res, 200, data, MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream');
    } catch {
      return send(res, 404, 'not found', TEXT);
    }
  }
  return serveFile(res, store.codeDir(repo, branch), rest.join('/') || 'index.html');
}

// ---------------------------------------------------------------- server

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = decodeURIComponent(url.pathname);
  try {
    for (const r of routes) {
      const m = r.m === req.method && p.match(r.re);
      if (m) return await r.h(req, res, m.slice(1), url);
    }
    if (req.method === 'GET' && p.startsWith('/preview/')) return await servePreview(res, p);
    if (req.method === 'GET') {
      if (p.startsWith('/api/')) return send(res, 404, { error: 'not found' }); // unmatched API stays JSON
      // Serve a real static file if one exists; otherwise the app shell, so
      // GitHub-shaped clean paths (/<user>/<repo>/...) survive deep links/reloads.
      const rel = p === '/' ? '' : p.slice(1);
      try {
        const full = path.normalize(path.join(PUBLIC_DIR, rel));
        if (full.startsWith(PUBLIC_DIR) && (await fsp.stat(full)).isFile()) {
          return serveFile(res, PUBLIC_DIR, rel);
        }
      } catch { /* not a file — fall through to the shell */ }
      return serveFile(res, PUBLIC_DIR, 'index.html');
    }
    send(res, 404, { error: 'not found' });
  } catch (err) {
    send(res, err.statusCode || 500, { error: String(err.message || err) });
  }
});

pipeline.recoverInterrupted();

server.listen(PORT, () => {
  console.log(`\n  ⚡ VibeHub running at http://localhost:${PORT}`);
  console.log(`  mode:       ${process.argv.slice(2).includes('--demo') ? 'demo' : 'use'}`);
  console.log(`  data dir:   ${store.DATA_DIR}`);
  console.log(`  agent mode: ${agentlib.agentMode()} (set VIBEHUB_AGENT=stub|claude to override)\n`);
});
