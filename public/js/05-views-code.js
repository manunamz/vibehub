'use strict';
/* Code tab: commits, diffs, blobs */
async function viewCode(repo) {
  const [d, tree] = await Promise.all([api(bq(`/api/repos/${repo}`)), api(bq(`/api/repos/${repo}/code/tree`))]);
  const vibeBySha = {};
  d.vibes.forEach((v) => { vibeBySha[v.sha] = v; });
  const treeHTML = (items, ref) => `
    <ul class="filetree">
      ${items.length === 0 ? '<li class="dim">empty</li>' : ''}
      ${items.map((t) => `<li>📄 <a href="${rlink(repo)}/blob/${ref}/${encodeURIComponent(t.path)}">${esc(t.path)}</a></li>`).join('')}
    </ul>`;
  app.innerHTML = `
    ${repoHeader(repo, 'code', d.branches)}
    <div class="split">
      <section>
        <h2>Agent commits</h2>
        <div class="timeline">
          ${d.codeCommits.length === 0
            ? '<p class="dim">No code commits yet.</p>'
            : timelineHTML(d.codeCommits, (c) => c.date, (c) => {
                const vibe = c.vibeCommits.map((vs) => vibeBySha[vs]).find(Boolean);
                return `
                  <div class="tl-cell selectable" data-sha="${c.sha}">
                    <span class="cell-title" title="click to browse files at this commit">${esc(c.subject)}</span>
                    <div class="chip-row">
                      <a class="sha-chip" href="${rlink(repo)}/code/${c.sha}" title="code commit">${ICON_CODE} code ${c.sha.slice(0, 7)}</a>
                      ${vibe ? `<a class="sha-chip" title="vibe · code · prompt side by side" href="${rlink(repo)}/vibe/${vibe.sha}/all">${ICON_ALL} all</a>` : ''}
                    </div>
                    <div class="meta-line">
                      <span class="dim small">${esc(c.author)} · ${timeAgo(c.date)}</span>
                    </div>
                  </div>`;
              }, 'Commits')}
        </div>
      </section>
      <section class="files-pane">
        <h2>Files <span class="dim small" id="files-at">@ HEAD</span></h2>
        <div class="card" id="file-list">${treeHTML(tree, 'HEAD')}</div>
      </section>
    </div>`;
  app.querySelectorAll('.tl-cell.selectable').forEach((cell) => {
    cell.addEventListener('click', async (e) => {
      if (e.target.closest('a,button')) return;
      const sha = cell.dataset.sha;
      try {
        const t = await api(bq(`/api/repos/${repo}/code/tree?ref=${sha}`));
        document.getElementById('file-list').innerHTML = treeHTML(t, sha);
        document.getElementById('files-at').textContent = `@ ${sha.slice(0, 7)}`;
        app.querySelectorAll('.tl-cell.selectable').forEach((el) => el.classList.toggle('selected', el === cell));
      } catch {}
    });
  });
}

function renderDiff(diff) {
  return diff.split('\n').map((line) => {
    if (line.startsWith('diff --git')) return `<div class="line file">${esc(line.replace(/^diff --git a\/.* b\//, ''))}</div>`;
    if (line.startsWith('@@')) return `<div class="line hunk">${esc(line)}</div>`;
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file'))
      return `<div class="line dim">${esc(line)}</div>`;
    if (line.startsWith('+')) return `<div class="line add">${esc(line)}</div>`;
    if (line.startsWith('-')) return `<div class="line del">${esc(line)}</div>`;
    return `<div class="line">${esc(line)}</div>`;
  }).join('');
}

async function viewCommit(repo, sha) {
  const [c, d] = await Promise.all([api(bq(`/api/repos/${repo}/code/commits/${sha}`)), api(bq(`/api/repos/${repo}`))]);
  const vibeSha = (c.message.match(/Vibe-Commit:\s*([0-9a-f]+)/) || [])[1];
  const vibe = vibeSha && d.vibes.find((v) => v.sha === vibeSha);
  app.innerHTML = `
    ${repoHeader(repo, 'code', d.branches)}
    <p><a href="${rlink(repo)}/code">← all commits</a></p>
    <div class="card">
      <h2>${esc(c.message.split('\n')[0])}</h2>
      <div class="meta-line">
        <span class="sha-chip">${c.sha.slice(0, 12)}</span>
        <span class="dim small">${esc(c.author)} · ${timeAgo(c.date)}</span>
      </div>
      ${vibe ? `
        <details class="plan" open>
          <summary>⚡ linked vibe ${vibeSha.slice(0, 7)}</summary>
          <div class="plan-body">
            <strong>${esc(vibe.prompt)}</strong>
            ${vibe.plan ? md('\n' + vibe.plan) : ''}
          </div>
        </details>` : ''}
    </div>
    <h2>Diff <span class="dim small">${c.files.length} file${c.files.length === 1 ? '' : 's'} changed</span></h2>
    <div class="diff">${c.diff ? renderDiff(c.diff) : '<div class="line dim">(empty commit)</div>'}</div>`;
}

async function viewBlob(repo, ref, filePath) {
  const content = await api(bq(`/api/repos/${repo}/code/blob?path=${encodeURIComponent(filePath)}&ref=${encodeURIComponent(ref)}`));
  app.innerHTML = `
    ${repoHeader(repo, 'code')}
    <p><a href="${rlink(repo)}/code">← files</a></p>
    <h2 class="mono">${esc(filePath)} <span class="dim small">@ ${ref === 'HEAD' ? 'HEAD' : esc(ref.slice(0, 7))}</span></h2>
    <pre class="blob">${esc(content)}</pre>`;
}

