'use strict';
/* vibe pages: trio (all), vibe check, vibe detail */
async function viewVibeTrio(repo, sha) {
  const d = await api(bq(`/api/repos/${repo}`));
  const v = d.vibes.find((x) => x.sha === sha || x.sha.startsWith(sha));
  if (!v) throw new Error(`no vibe ${sha.slice(0, 7)} in ${repo}`);
  const [drift, code, logText] = await Promise.all([
    v.distillSha ? api(bq(`/api/repos/${repo}/prompt/commits/${v.distillSha}`)).catch(() => null) : Promise.resolve(null),
    v.codeCommit ? api(bq(`/api/repos/${repo}/code/commits/${v.codeCommit}`)).catch(() => null) : Promise.resolve(null),
    api(`/api/repos/${repo}/vibes/${v.sha}/log`).catch(() => ''),
  ]);
  const state = v.state || 'done';
  app.innerHTML = `
    ${repoHeader(repo, 'vibes', d.branches)}
    <p><a href="${rlink(repo)}">← vibes</a></p>
    <div class="trio">
      <section>
        <h3>⚡ Vibe <a class="sha-chip" title="open this vibe" href="${rlink(repo)}/vibe/${v.sha}">vibe ${v.sha.slice(0, 7)}</a> ${stateBadge(v)}</h3>
        <div class="card" style="margin:0">
          ${v.ramble ? `
          <div class="prompt" style="margin-bottom:10px">💭 ${esc(v.ramble)}</div>
          <details class="plan" open>
            <summary>✨ tidied into prompt + plan</summary>
            <div class="plan-body small"><p style="margin-top:0"><strong>${esc(v.prompt || '')}</strong></p>${v.plan ? md(v.plan) : ''}</div>
          </details>` : `
          <div class="prompt" style="margin-bottom:10px">${esc(v.prompt || v.subject)}</div>
          ${v.plan ? `<div class="plan-body">${md(v.plan)}</div>` : '<p class="dim small">no plan — pure vibes</p>'}`}
          <details class="plan" style="margin-top:12px">
            <summary>agent log</summary>
            <pre class="log-pre" style="margin-top:6px">${esc(logText || '(no agent log yet)')}</pre>
          </details>
        </div>
      </section>
      <section>
        <h3>&lt;/&gt; Code ${v.codeCommit ? `<a class="sha-chip" href="${rlink(repo)}/code/${v.codeCommit}">${ICON_CODE} code ${v.codeCommit.slice(0, 7)}</a>` : ''}</h3>
        ${code
          ? `<div class="diff">${code.diff ? renderDiff(code.diff) : '<div class="line dim">(empty commit)</div>'}</div>`
          : `<p class="dim small">${state === 'running' || state === 'queued' ? 'agent still working…' : 'no code commit'}</p>`}
      </section>
      <section>
        <h3>⚗ Prompt change ${v.distillSha ? `<a class="sha-chip" href="${rlink(repo)}/prompt/${v.distillSha}">distill ${v.distillSha.slice(0, 7)}</a>` : ''}</h3>
        ${drift
          ? `<div class="diff">${drift.diff ? renderDiff(drift.diff) : '<div class="line dim">(no change)</div>'}</div>`
          : `<p class="dim small">${v.distill === 'running' ? 'distilling…' : v.distill === 'failed' ? `distill failed: ${esc(v.distillError || '')}` : 'no distillate yet'}</p>`}
      </section>
    </div>`;
}

// Vibe Check: review a branch against main in three altitudes — how the idea
// changed (distillate diff), how the apps feel (side-by-side previews), what
// shipped (vibes + code diff) — then intent-replay merge.
async function viewVibeCheck(repo) {
  if (curBranch === 'main') { navigate(rlink(repo)); return; }
  const branch = curBranch;
  const [cmp, d] = await Promise.all([
    api(`/api/repos/${repo}/compare?with=${encodeURIComponent(branch)}&base=main`),
    api(bq(`/api/repos/${repo}`)),
  ]);
  app.innerHTML = `
    ${repoHeader(repo, 'vibes', d.branches)}
    <p><a href="${rlink(repo)}">← vibes</a></p>
    <div class="pane-head">
      <h2>⇄ Vibe Check <span class="dim small">${esc(branch)} → main</span></h2>
      ${STATIC ? '<span class="dim small">read-only demo — merging happens in the local app</span>' : `<button id="merge-btn" ${cmp.vibes.length ? '' : 'disabled'}>✓ passes the vibe check — merge</button>`}
    </div>
    ${cmp.vibes.length === 0
      ? '<p class="dim">This branch has no vibes of its own yet — nothing to check.</p>'
      : `
    <div class="split">
      <section>
        <h2>⚗ How the idea changed</h2>
        <div class="diff">${cmp.promptDiff ? renderDiff(cmp.promptDiff) : '<div class="line dim">(no distilled-prompt difference yet)</div>'}</div>
        <h2 style="margin-top:18px">⚡ Vibes being merged <span class="dim small">${cmp.vibes.length}</span></h2>
        <div class="tl-box">
          ${cmp.vibes.map((v) => `
            <div class="tl-cell">
              <a class="cell-title" style="font-size:13px" href="${rlink(repo)}/vibe/${v.sha}">${esc(v.prompt || v.subject)}</a>
              <div class="meta-line"><span class="dim small">${timeAgo(v.createdAt || v.date)}</span></div>
            </div>`).join('')}
        </div>
        <details class="plan" style="margin-top:18px">
          <summary>&lt;/&gt; full code diff</summary>
          <div class="diff" style="margin-top:8px;max-height:60vh;overflow:auto">${cmp.codeDiff ? renderDiff(cmp.codeDiff) : '<div class="line dim">(no code difference)</div>'}</div>
        </details>
      </section>
      <section>
        <div class="pane-head"><h2>main</h2><a class="small" href="/preview/${repo}/" target="_blank">open ↗</a></div>
        <iframe class="preview" style="height:36vh" src="/preview/${repo}/"></iframe>
        <div class="pane-head" style="margin-top:14px"><h2>${esc(branch)}</h2><a class="small" href="/preview/${repo}/~${branch}/" target="_blank">open ↗</a></div>
        <iframe class="preview" style="height:36vh" src="/preview/${repo}/~${branch}/"></iframe>
      </section>
    </div>`}
  `;
  document.getElementById('merge-btn')?.addEventListener('click', () => {
    document.getElementById('merge-modal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'merge-modal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card modal-sm">
        <h2>Merge ${esc(branch)} into main</h2>
        <p class="dim small" style="margin-top:0">This commits one <strong>merge vibe</strong> on main: an agent replays the branch's intent onto main's code (reading the branch's code as reference). The branch itself is untouched — delete it later if the merge lands well.</p>
        <div class="err" id="merge-err"></div>
        <div class="modal-actions">
          <button class="ghost" id="merge-cancel">Cancel</button>
          <button id="merge-go">⇄ merge</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#merge-cancel').onclick = close;
    overlay.querySelector('#merge-go').onclick = async () => {
      try {
        await api(`/api/repos/${repo}/merge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ branch, base: 'main' }),
        });
        close();
        navigate(`${homeLink()}/${repo}`); // watch the merge vibe land on main
      } catch (e) {
        overlay.querySelector('#merge-err').textContent = e.message;
      }
    };
  });
}

// A vibe's own page — like a commit page: prompt, plan, ramble, live agent log.
async function viewVibeDetail(repo, sha) {
  const d = await api(bq(`/api/repos/${repo}`));
  const v = d.vibes.find((x) => x.sha === sha || x.sha.startsWith(sha));
  if (!v) throw new Error(`no vibe ${sha.slice(0, 7)} in ${repo}`);
  const state = v.state || 'done';
  const live = state === 'running' || state === 'queued' || v.distill === 'running';
  const logText = await api(`/api/repos/${repo}/vibes/${v.sha}/log`);
  app.innerHTML = `
    ${repoHeader(repo, 'vibes', d.branches)}
    <p><a href="${rlink(repo)}">← vibes</a></p>
    <div class="card">
      <div class="prompt">${v.ramble ? '💭 ' + esc(v.ramble) : esc(v.prompt || v.subject)}</div>
      <div class="chip-row">
        <span class="sha-chip" title="vibe commit">⚡ vibe ${v.sha.slice(0, 7)}</span>
        ${v.codeCommit ? `<a class="sha-chip" title="the agent's code commit" href="${rlink(repo)}/code/${v.codeCommit}">${ICON_CODE} code ${v.codeCommit.slice(0, 7)}</a>` : ''}
        ${v.distillSha ? `<a class="sha-chip" title="the change to the distilled prompt" href="${rlink(repo)}/prompt/${v.distillSha}">⚗ distill ${v.distillSha.slice(0, 7)}</a>` : ''}
        <a class="sha-chip" title="vibe · code · prompt side by side" href="${rlink(repo)}/vibe/${v.sha}/all">${ICON_ALL} all</a>
      </div>
      <div class="meta-line">
        ${stateBadge(v)}
        ${v.ramble ? `<span class="dim small">💭 from a ramble</span>` : ''}
        ${v.distill === 'running' ? '<span class="dim small">⚗ distilling…</span>'
          : v.distill === 'failed' ? `<span class="small" style="color:var(--red)" title="${esc(v.distillError || '')}">⚗ distill failed</span>` : ''}
        <span class="dim small">${timeAgo(v.createdAt || v.date)}</span>
        ${!STATIC && v.codeCommit ? `<button class="ghost branch-from" data-sha="${v.sha}" title="start a branch from this vibe">${ICON_BRANCH} branch</button>` : ''}
      </div>
      ${v.error ? `<div class="err">${esc(v.error)}</div>` : ''}
    </div>
    ${v.ramble ? `
    <h2>✨ Tidied prompt + plan <span class="dim small">what the agent was actually given</span></h2>
    <div class="plan-body plan-full"><p style="margin-top:0"><strong>${esc(v.prompt || '')}</strong></p>${v.plan ? md(v.plan) : ''}</div>` : `
    <h2>Plan</h2>
    <div class="plan-body plan-full">${v.plan ? md(v.plan) : '<span class="dim">no plan — pure vibes</span>'}</div>`}
    <h2 style="margin-top:18px">Agent log ${live ? '<span class="badge running"><span class="dot">●</span> live</span>' : ''}</h2>
    <pre class="log-full">${esc(logText)}</pre>`;
  if (live) {
    const tick = async () => {
      if (!location.pathname.includes(`/vibe/${v.sha}`)) return;
      try {
        const text = await api(`/api/repos/${repo}/vibes/${v.sha}/log`);
        const pre = document.querySelector('pre.log-full');
        if (pre && pre.textContent !== text) {
          const stick = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
          pre.textContent = text;
          if (stick) pre.scrollTop = pre.scrollHeight;
        }
        const d2 = await api(bq(`/api/repos/${repo}`));
        const v2 = d2.vibes.find((x) => x.sha === v.sha);
        if (v2 && v2.state !== 'running' && v2.state !== 'queued' && v2.distill !== 'running') return render();
      } catch {}
      pollTimer = setTimeout(tick, 1500);
    };
    pollTimer = setTimeout(tick, 1500);
  }
}

