'use strict';
/* Static exporter: snapshots a running VibeHub into a deployable directory.
 *
 *   node server.js            # in one terminal
 *   node export.js [outDir]   # default ./dist
 *   netlify deploy --dir dist # or any static host
 *
 * The exported site is the full read-only experience: repo list, vibe
 * timelines, trio pages, prompt history with drift diffs, code commits,
 * file browsing, and app previews at every commit (time travel included).
 * No agents, no accounts, no server — it's just files.
 */
const fsp = require('fs/promises');
const path = require('path');

const BASE = process.env.VIBEHUB_URL || 'http://localhost:3737';
const OUT = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('-')) || 'dist');

async function jget(p) {
  const r = await fetch(BASE + p);
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return r.json();
}
async function tget(p) {
  const r = await fetch(BASE + p);
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return r.text();
}
async function bget(p) {
  const r = await fetch(BASE + p);
  if (!r.ok) return null;
  return Buffer.from(await r.arrayBuffer());
}
async function write(rel, data) {
  const f = path.join(OUT, rel);
  await fsp.mkdir(path.dirname(f), { recursive: true });
  await fsp.writeFile(f, data);
}
const J = JSON.stringify;

(async () => {
  await fsp.rm(OUT, { recursive: true, force: true });

  // app shell (recursive), with the static flag injected into the html
  async function copyPublic(rel) {
    const abs = path.join(__dirname, 'public', rel);
    for (const entry of await fsp.readdir(abs, { withFileTypes: true })) {
      const r = path.join(rel, entry.name);
      if (entry.isDirectory()) { await copyPublic(r); continue; }
      let data = await fsp.readFile(path.join(__dirname, 'public', r));
      if (r === 'index.html') {
        data = data
          .toString()
          .replace('<script src="/js/01-core.js">', `<script>window.VIBEHUB_STATIC = true; window.VIBEHUB_REPO_URL = ${JSON.stringify(process.env.VIBEHUB_REPO_URL || 'https://github.com/manunamz/vibehub')};</script>\n  <script src="/js/01-core.js">`);
      }
      await write(r, data);
    }
  }
  await copyPublic('');

  // SPA fallback for clean (hash-free) paths: any non-file URL → the app shell.
  await write('_redirects', '/*    /index.html    200\n');

  await write('api/user.json', J(await jget('/api/user')));
  const repos = await jget('/api/repos');
  await write('api/repos.json', J(repos.map((r) => ({ ...r, running: false }))));

  async function exportBranch(n, branch) {
    const isMain = branch === 'main';
    const A = isMain ? `api/repos/${n}` : `api/repos/${n}/branch/${branch}`;
    const P = isMain ? `preview/${n}` : `preview/${n}/~${branch}`;
    const bq = (p) => p + (p.includes('?') ? '&' : '?') + 'branch=' + encodeURIComponent(branch);
    const d = await jget(bq(`/api/repos/${n}`));
    await write(`${A}/index.json`, J(d));

    // prompt side
    const prompt = await jget(bq(`/api/repos/${n}/prompt`));
    await write(`${A}/prompt.json`, J(prompt));
    const hist = await jget(bq(`/api/repos/${n}/prompt/history`));
    await write(`${A}/prompt/history.json`, J(hist));
    for (const c of hist) {
      await write(`${A}/prompt/commits/${c.sha}.json`, J(await jget(bq(`/api/repos/${n}/prompt/commits/${c.sha}`))));
      try {
        await write(`${A}/prompt/at/${c.sha}.json`, J(await jget(bq(`/api/repos/${n}/prompt/at/${c.sha}`))));
      } catch {}
    }

    // code side: commits, trees + blobs at every ref, diffs
    const commits = await jget(bq(`/api/repos/${n}/code/commits`));
    await write(`${A}/code/commits.json`, J(commits));
    for (const c of commits) {
      await write(`${A}/code/commits/${c.sha}.json`, J(await jget(bq(`/api/repos/${n}/code/commits/${c.sha}`))));
    }
    for (const ref of ['HEAD', ...commits.map((c) => c.sha)]) {
      const tree = await jget(bq(`/api/repos/${n}/code/tree?ref=${ref}`));
      await write(`${A}/code/tree/${ref}.json`, J(tree));
      for (const t of tree) {
        const blob = await bget(bq(`/api/repos/${n}/code/blob?path=${encodeURIComponent(t.path)}&ref=${ref}`));
        if (blob) await write(`${A}/code/blob/${ref}/${t.path}`, blob);
      }
    }

    // agent logs (repo-global path)
    for (const v of d.vibes) {
      await write(`api/repos/${n}/vibes/${v.sha}/log.txt`, await tget(`/api/repos/${n}/vibes/${v.sha}/log`).catch(() => '(no log)'));
    }

    // previews: current app + a snapshot at every code commit (time travel)
    const pbase = isMain ? `/preview/${n}` : `/preview/${n}/~${branch}`;
    const head = await jget(bq(`/api/repos/${n}/code/tree?ref=HEAD`));
    for (const t of head) {
      const b = await bget(`${pbase}/${t.path}`);
      if (b) await write(`${P}/${t.path}`, b);
    }
    for (const c of commits) {
      const tree = await jget(bq(`/api/repos/${n}/code/tree?ref=${c.sha}`));
      for (const t of tree) {
        const b = await bget(`${pbase}/@${c.sha}/${t.path}`);
        if (b) await write(`${P}/@${c.sha}/${t.path}`, b);
      }
    }
  }

  for (const r of repos) {
    const n = r.name;
    const branches = (await jget(`/api/repos/${n}/branches`));
    await write(`api/repos/${n}/branches.json`, J(branches));
    for (const b of branches.map((x) => x.name)) {
      await exportBranch(n, b);
      if (b !== 'main') {
        try {
          await write(`api/repos/${n}/compare/${b}.json`, J(await jget(`/api/repos/${n}/compare?with=${encodeURIComponent(b)}&base=main`)));
        } catch {}
      }
    }
    console.log(`  exported ${n} (${branches.length} branch${branches.length === 1 ? '' : 'es'})`);
  }

  console.log(`\n  📦 static VibeHub written to ${OUT}`);
  console.log(`  deploy: netlify deploy --dir ${path.relative(process.cwd(), OUT)} --prod  (or any static host)\n`);
})().catch((e) => {
  console.error('export failed:', e.message);
  process.exit(1);
});
