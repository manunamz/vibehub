'use strict';
/* repo header + the Vibes & App page */
function repoHeader(repo, active, branches, about) {
  const bs = branches && branches.length ? branches : [curBranch];
  const showBranch = !(STATIC && bs.length === 1);
  return `
    <div class="repo-head">
      <h1><a href="${homeLink()}" title="${esc(curUser)}'s repos">${esc(curUser)}</a> <span class="dim">/</span> ${esc(repo)}</h1>
      <nav class="tabs">
        <a href="${rlink(repo)}" class="${active === 'vibes' ? 'active' : ''}">⚡ Vibes &amp; App</a>
        <a href="${rlink(repo)}/code" class="${active === 'code' ? 'active' : ''}">&lt;/&gt; Code</a>
        <a href="${rlink(repo)}/prompt" class="${active === 'prompt' ? 'active' : ''}">⚗ The Prompt</a>
      </nav>
      ${STATIC ? '' : '<button class="ghost settings-btn" title="agent models for this repo">⚙</button>'}
    </div>
    ${!showBranch && about === undefined ? '' : `
    <div class="repo-sub">
      ${showBranch ? `
      <div class="branch-switch" id="branch-switch">
        <button class="bs-btn" id="branch-btn" title="switch branch">${ICON_BRANCH} <span class="bs-name">${esc(curBranch)}</span><span class="bs-caret"></span></button>
        <div class="bs-menu" id="branch-menu" hidden>
          ${bs.map((b) => `<a class="bs-item ${b === curBranch ? 'cur' : ''}" data-branch="${esc(b)}">${esc(b)}</a>`).join('')}
          ${STATIC ? '' : `
          <div class="bs-sep"></div>
          <a class="bs-item" data-act="new">+ new branch…</a>
          ${curBranch !== 'main' ? '<a class="bs-item danger" data-act="del">🗑 delete this branch</a>' : ''}`}
        </div>
      </div>
      <span class="dim small branch-count">${ICON_BRANCH} ${bs.length} branch${bs.length === 1 ? '' : 'es'}</span>
      ${curBranch !== 'main' ? `<a class="bs-btn vc-link" href="${rlink(repo)}/check">⇄ Vibe Check</a>` : ''}` : ''}
      ${about !== undefined ? `
      <div class="about-inline">
        <span class="dim small" id="about-desc">${about ? esc(about) : 'no description — pure vibes'}</span>
        ${STATIC ? '' : '<button class="icon-btn" id="about-edit" title="edit description">✎</button>'}
      </div>` : ''}
    </div>`}`;
}

function vibeCard(repo, v) {
  const state = v.state || 'done';
  return `
    <div class="tl-cell vibe ${v.codeCommit ? 'selectable' : ''}" data-sha="${v.sha}" data-code="${v.codeCommit || ''}">
      <div class="cell-title prompt" title="${v.codeCommit ? 'click to preview the app as of this vibe' : ''}">${esc(v.prompt || v.subject)}</div>
      <div class="chip-row">
        <a class="sha-chip" title="open this vibe" href="${rlink(repo)}/vibe/${v.sha}">⚡ vibe ${v.sha.slice(0, 7)}</a>
        <a class="sha-chip" title="vibe · code · prompt side by side" href="${rlink(repo)}/vibe/${v.sha}/all">${ICON_ALL} all</a>
      </div>
      <div class="meta-line">
        ${stateBadge(v)}
        ${v.ramble ? `<span class="dim small" title="${esc(v.ramble.slice(0, 400))}">💭 from a ramble</span>` : ''}
        ${v.distill === 'running' ? '<span class="dim small">⚗ distilling…</span>'
          : v.distill === 'failed' ? `<span class="small" style="color:var(--red)" title="${esc(v.distillError || '')}">⚗ distill failed</span>` : ''}
        <span class="dim small">${timeAgo(v.createdAt || v.date)}</span>
        ${!STATIC && v.codeCommit ? `<button class="ghost branch-from" data-sha="${v.sha}" title="start a branch from this vibe">${ICON_BRANCH} branch</button>` : ''}
      </div>
      ${v.error ? `<div class="err">${esc(v.error)}</div>` : ''}
    </div>`;
}

async function viewRepo(repo) {
  const d = await api(bq(`/api/repos/${repo}`));
  const previewUrl = curBranch === 'main' ? `/preview/${repo}/` : `/preview/${repo}/~${curBranch}/`;
  app.innerHTML = `
    ${repoHeader(repo, 'vibes', d.branches, d.meta.description || '')}
    ${d.agentMode === 'stub' ? '<div class="notice">claude CLI not found — running the stub agent. Install Claude Code to get a real coding agent.</div>' : ''}
    <div class="split">
      <section>
        <div class="pane-head">
          <h2>Vibes</h2>
          <span class="dim small">${d.vibes.length} committed · newest first</span>
        </div>
        <div class="card">
          <div class="prompt-head">
            <h2>Commit a vibe</h2>
            <div class="mode-toggle">
              <button class="mode-btn ${composerMode === 'vibe' ? 'active' : ''}" data-mode="vibe">prompt + plan</button>
              <button class="mode-btn ${composerMode === 'ramble' ? 'active' : ''}" data-mode="ramble">ramble</button>
            </div>
          </div>
          <div style="height:10px"></div>
          <div id="composer-vibe" ${composerMode === 'ramble' ? 'hidden' : ''}>
            <textarea id="vibe-prompt" rows="3" placeholder="Prompt — what should the app do?"></textarea>
            <div style="height:8px"></div>
            <textarea id="vibe-plan" class="mono" rows="5" placeholder="Plan (optional, markdown) — how should the agent approach it?"></textarea>
          </div>
          <textarea id="vibe-ramble" rows="7" ${composerMode === 'vibe' ? 'hidden' : ''}
            placeholder="just ramble — braindump what you want, stream-of-consciousness is fine. VibeHub tidies it into a clean prompt + plan before committing (the original ramble is kept too)."></textarea>
          <div style="margin-top:10px;display:flex;gap:10px;align-items:center">
            <button id="vibe-btn">⚡ commit the vibe</button>
            <span class="dim small">the agent picks it up and commits code in parallel</span>
          </div>
          <div class="err" id="vibe-err"></div>
        </div>
        <div id="vibe-list" class="timeline">
          ${d.vibes.length === 0
            ? '<p class="dim">No vibes yet. The timeline of prompts &amp; plans will appear here.</p>'
            : timelineHTML(d.vibes, (v) => v.createdAt || v.date, (v) => vibeCard(repo, v), 'Vibes')}
        </div>
      </section>
      <section class="preview-pane">
        <div class="pane-head">
          <h2>App</h2>
          <span class="dim small" id="preview-at">latest</span>
          <button class="ghost" id="refresh-preview" title="refresh · back to the latest version">↻</button>
          <a class="small" href="${previewUrl}" target="_blank">open ↗</a>
        </div>
        ${d.hasApp
          ? `<div class="preview-wrap" id="preview-wrap"><iframe class="preview" id="preview" src="${previewUrl}"></iframe></div>`
          : '<div class="preview-empty" id="preview-empty">no app yet — commit a vibe and the agent will build one</div>'}
      </section>
    </div>`;

  app.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.onclick = () => {
      composerMode = btn.dataset.mode;
      localStorage.setItem(COMPOSER_KEY, composerMode);
      app.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b === btn));
      document.getElementById('composer-vibe').hidden = composerMode === 'ramble';
      document.getElementById('vibe-ramble').hidden = composerMode === 'vibe';
    };
  });
  const vibeBtn = document.getElementById('vibe-btn');
  if (vibeBtn && STATIC) vibeBtn.onclick = () => showDemoModal('Committing a vibe');
  else if (vibeBtn) vibeBtn.onclick = async () => {
    const btn = document.getElementById('vibe-btn');
    const body = composerMode === 'ramble'
      ? { ramble: document.getElementById('vibe-ramble').value, branch: curBranch }
      : { prompt: document.getElementById('vibe-prompt').value, plan: document.getElementById('vibe-plan').value, branch: curBranch };
    btn.disabled = true;
    if (composerMode === 'ramble') btn.textContent = '✨ tidying the ramble…';
    try {
      await api(`/api/repos/${repo}/vibes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      render();
    } catch (e) {
      document.getElementById('vibe-err').textContent = e.message;
      btn.disabled = false;
      btn.textContent = '⚡ commit the vibe';
    }
  };
  fitPreview();
  document.getElementById('preview')?.addEventListener('load', fitPreview);
  document.getElementById('about-edit')?.addEventListener('click', () => {
    const p = document.getElementById('about-desc');
    if (!p || document.getElementById('about-input')) return;
    p.outerHTML = `
      <input type="text" id="about-input" maxlength="200" autocomplete="off" style="flex:1;min-width:180px">
      <button class="ghost" id="about-cancel">Cancel</button>
      <button id="about-save" style="padding:4px 12px;font-size:12px">Save</button>`;
    const input = document.getElementById('about-input');
    input.value = d.meta.description || '';
    input.focus();
    document.getElementById('about-cancel').onclick = () => render();
    document.getElementById('about-save').onclick = async () => {
      try {
        await api(`/api/repos/${repo}/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: input.value.trim() }),
        });
        render();
      } catch (e) { alert(`save failed: ${e.message}`); }
    };
  });
  const clearPreviewSel = () => app.querySelectorAll('.tl-cell.selected').forEach((el) => el.classList.remove('selected'));
  document.getElementById('refresh-preview')?.addEventListener('click', () => {
    const f = document.getElementById('preview');
    if (!f) return;
    f.src = previewUrl;
    document.getElementById('preview-at').textContent = 'latest';
    clearPreviewSel();
  });
  // click a vibe cell -> preview the app as of that vibe's code commit
  app.querySelectorAll('.tl-cell.selectable[data-code]').forEach((cell) => {
    cell.addEventListener('click', (e) => {
      if (e.target.closest('a,button')) return;
      const f = document.getElementById('preview');
      if (!f || !cell.dataset.code) return;
      f.src = `${previewUrl}@${cell.dataset.code}/`;
      document.getElementById('preview-at').textContent = `@ vibe ${cell.dataset.sha.slice(0, 7)}`;
      clearPreviewSel();
      cell.classList.add('selected');
    });
  });
  // Poll while agents work: re-render when any vibe changes state.
  const sig = (vibes) => vibes.map((v) => `${v.sha}:${v.state}:${v.codeCommit || ''}:${v.distill || ''}`).join('|');
  const here = () => location.pathname === rlink(repo) || location.pathname === rlink(repo) + '/';
  const baseSig = sig(d.vibes);
  if (d.vibes.some((v) => v.state === 'queued' || v.state === 'running' || v.distill === 'running')) {
    const tick = async () => {
      if (!here()) return;
      try {
        const d2 = await api(bq(`/api/repos/${repo}`));
        if (sig(d2.vibes) !== baseSig) return render();
      } catch {}
      pollTimer = setTimeout(tick, 1500);
    };
    pollTimer = setTimeout(tick, 1500);
  }
}

