'use strict';
// ------------------------------------------------------------------ views

async function viewHome() {
  const repos = await api('/api/repos');
  const totalVibes = repos.reduce((s, r) => s + (r.vibeCount || 0), 0);
  app.innerHTML = `
    <div class="profile-layout">
      <aside class="profile-side">
        <img class="avatar-lg${curProfile.avatar ? ' avatar-photo' : ''}" src="${curProfile.avatar || '/vibybara-spring.svg'}" alt="">
        <h1 class="profile-name">${esc(curProfile.name)}</h1>
        ${curProfile.tagline ? `<div class="dim profile-login">${esc(curProfile.tagline)}</div>` : ''}
        ${curProfile.bio ? `<p class="small profile-bio">${esc(curProfile.bio)}</p>` : ''}
        ${STATIC ? '' : '<button class="ghost profile-edit" id="profile-edit">Edit profile</button>'}
        <div class="dim small profile-facts">
          ${curProfile.location ? `<div>📍 ${esc(curProfile.location)}</div>` : ''}
          ${curProfile.link ? `<div>🔗 <a href="${esc(safeUrl(curProfile.link))}">${esc(curProfile.link.replace(/^#\/r\//, ''))}</a></div>` : ''}
          <div>${ICON_BRANCH} ${repos.length} repositories &nbsp;·&nbsp; ⚡ ${totalVibes} vibes</div>
        </div>
      </aside>
      <section class="profile-main">
    ${localStorage.getItem(INTRO_KEY) ? '' : `
    <div class="card" id="intro-card">${INFO_HTML}
      <div style="text-align:right"><button class="ghost" id="intro-dismiss">got it — don't show again</button></div>
    </div>`}
    ${STATIC && !localStorage.getItem('vibehub-demo-dismissed') ? `
    <div class="card demo-note" id="demo-note">
      <p class="dim" style="margin:0;flex:1">📦 read-only demo — every repo below was vibed locally with VibeHub; the agents committed all the code. Click any repo to explore its prompts, plans, diffs, and the app itself.</p>
      <button class="icon-btn" id="demo-dismiss" title="dismiss">✕</button>
    </div>` : ''}
    <div class="repo-toolbar">
      <input type="text" id="repo-filter" placeholder="Find a repository…" autocomplete="off" spellcheck="false">
      <button id="new-btn" title="create a repository">New</button>
    </div>
    <div id="repo-list">
      ${repos.length === 0 ? '<p class="dim">No repos yet — create one above.</p>' : ''}
      ${repos.map((r) => `
        <div class="repo-row" data-search="${esc((r.name + ' ' + (r.description || '')).toLowerCase())}">
          <a class="repo-thumb" href="${homeLink()}/${esc(r.name)}" tabindex="-1" aria-hidden="true">
            ${r.hasApp
              ? `<iframe src="/preview/${esc(r.name)}/" loading="lazy" scrolling="no" tabindex="-1"></iframe>`
              : `<img class="themed-mark" src="${markSrc()}" alt="">`}
          </a>
          <div style="flex:1;min-width:0">
            <h2 class="repo-title">
              <a href="${homeLink()}/${esc(r.name)}">${esc(r.name)}</a>
              <span class="pill">Public</span>
              ${r.running ? '<span class="badge running"><span class="dot">●</span> agent working</span>' : ''}
            </h2>
            ${r.description ? `<div class="dim small repo-desc">${esc(r.description)}</div>` : ''}
            <div class="repo-meta dim small">
              ${r.language ? `<span><span class="lang-dot" style="background:${LANG_COLORS[r.language] || '#8b949e'}"></span>${esc(r.language)}</span>` : ''}
              <span title="vibes">⚡ ${r.vibeCount}</span>
              ${r.license ? `<span title="license">⚖ ${esc(r.license)}</span>` : ''}
              <span title="branches">${ICON_BRANCH} ${r.branchCount || 1}</span>
              ${r.failedCount ? `<span title="failed vibes awaiting rerun" style="color:var(--red)">⊙ ${r.failedCount}</span>` : ''}
              ${r.openChecks ? `<span title="branches with unmerged vibes">⇄ ${r.openChecks}</span>` : ''}
              <span>Updated ${timeAgo(r.lastActivity)}</span>
            </div>
          </div>
          <div class="repo-activity">${sparkline(r.activity)}</div>
        </div>`).join('')}
    </div>
    <p id="no-match" class="dim small" hidden>No repositories match your search.</p>
      </section>
    </div>`;
  document.getElementById('intro-dismiss')?.addEventListener('click', () => {
    localStorage.setItem(INTRO_KEY, '1');
    document.getElementById('intro-card').remove();
  });
  document.getElementById('profile-edit')?.addEventListener('click', showProfileModal);
  document.getElementById('demo-dismiss')?.addEventListener('click', () => {
    localStorage.setItem('vibehub-demo-dismissed', '1');
    document.getElementById('demo-note').remove();
  });
  document.getElementById('repo-filter')?.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    let shown = 0;
    app.querySelectorAll('#repo-list .repo-row').forEach((row) => {
      const hit = !q || row.dataset.search.includes(q);
      row.hidden = !hit;
      if (hit) shown++;
    });
    document.getElementById('no-match').hidden = shown > 0;
  });
  const newBtn = document.getElementById('new-btn');
  if (newBtn) newBtn.onclick = () => (STATIC ? showDemoModal('Creating a repository') : showNewRepoModal());
}

