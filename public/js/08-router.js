'use strict';
// ------------------------------------------------------------------ router

async function render() {
  clearTimeout(pollTimer);
  await loadUser();
  const r = parseRoute(location.pathname);
  try {
    if (r.view === 'home') return await viewHome();
    curBranch = r.branch || 'main';
    switch (r.view) {
      case 'repo': return await viewRepo(r.repo);
      case 'code': return await viewCode(r.repo);
      case 'commit': return await viewCommit(r.repo, r.sha);
      case 'prompt': return await viewPrompt(r.repo);
      case 'promptCommit': return await viewPromptCommit(r.repo, r.sha);
      case 'vibe': return await viewVibeDetail(r.repo, r.sha);
      case 'vibeAll': return await viewVibeTrio(r.repo, r.sha);
      case 'check': return await viewVibeCheck(r.repo);
      case 'blob': return await viewBlob(r.repo, r.ref, r.path);
    }
    app.innerHTML = '<p class="dim">404 — unknown route. <a href="/">home</a></p>';
  } catch (e) {
    app.innerHTML = `<div class="card"><div class="err">${esc(e.message)}</div><p><a href="/">home</a></p></div>`;
  }
}

app.addEventListener('click', (e) => {
  const route = parseRoute(location.pathname);
  if (!route.repo) return;
  const repo = route.repo;
  if (e.target.closest('#branch-btn')) {
    const menu = document.getElementById('branch-menu');
    if (menu) menu.hidden = !menu.hidden;
    return;
  }
  const bi = e.target.closest('.bs-item');
  if (bi) {
    document.getElementById('branch-menu').hidden = true;
    if (bi.dataset.act === 'new') return showBranchModal(repo);
    if (bi.dataset.act === 'del') return deleteBranchFlow(repo);
    const tab = (route.view === 'code' || route.view === 'commit') ? '/code'
      : (route.view === 'prompt' || route.view === 'promptCommit') ? '/prompt' : '';
    const b = bi.dataset.branch;
    navigate(`${homeLink()}/${repo}${b === 'main' ? '' : '@' + encodeURIComponent(b)}${tab}`);
    return;
  }
  const rr = e.target.closest('.rerun-btn');
  if (rr) {
    rr.disabled = true;
    api(`/api/repos/${repo}/vibes/${rr.dataset.sha}/rerun`, { method: 'POST' })
      .then(() => render())
      .catch((err) => { rr.disabled = false; alert(`rerun failed: ${err.message}`); });
    return;
  }
  if (e.target.closest('.settings-btn')) showSettingsModal(repo);
  if (e.target.closest('.branch-count')) return;
  const bf = e.target.closest('.branch-from');
  if (bf) showBranchModal(repo, bf.dataset.sha);
});
// close the branch menu on any outside click
document.addEventListener('click', (e) => {
  const menu = document.getElementById('branch-menu');
  if (menu && !menu.hidden && !e.target.closest('#branch-switch')) menu.hidden = true;
});

if (STATIC) {
  const bar = document.createElement('div');
  bar.className = 'static-banner';
  bar.innerHTML = `📦 running in static site mode — <a href="${REPO_URL}" target="_blank" rel="noopener">click here to use the real thing</a>`;
  document.querySelector('.topbar').after(bar);
}

// intercept internal link clicks → pushState navigation (no full page reload)
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a[href]');
  if (!a || a.target === '_blank') return;
  const href = a.getAttribute('href');
  if (!isAppPath(href)) return;
  e.preventDefault();
  if (href !== location.pathname) navigate(href); else render();
});
window.addEventListener('popstate', render);
render();
