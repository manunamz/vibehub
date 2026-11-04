'use strict';
/* The Prompt tab: distillate master-detail + change views */
async function viewPrompt(repo) {
  const [p, hist, d] = await Promise.all([
    api(bq(`/api/repos/${repo}/prompt`)),
    api(bq(`/api/repos/${repo}/prompt/history`)),
    api(bq(`/api/repos/${repo}`)),
  ]);
  const vibeBySha = {};
  d.vibes.forEach((v) => { vibeBySha[v.sha] = v; });
  if (!p.exists) {
    app.innerHTML = `
      ${repoHeader(repo, 'prompt', d.branches)}
      <p class="dim">No distilled prompt yet. After each vibe ships, a distiller agent writes the one
      prompt that would approximately rebuild the current app from scratch — it will appear here.</p>`;
    return;
  }
  app.innerHTML = `
    ${repoHeader(repo, 'prompt', d.branches)}
    <div class="split">
      <section>
        <div class="pane-head">
          <h2>Prompt history</h2>
          <span class="dim small">one distill per vibe — select to view that version</span>
        </div>
        <div class="timeline" id="prompt-hist">
          ${timelineHTML(hist, (c) => c.date, (c) => {
            const vibe = c.distills.map((s) => vibeBySha[s]).find(Boolean);
            return `
              <div class="tl-cell selectable" data-sha="${c.sha}">
                <span class="cell-title">${esc(c.subject.replace(/^distill: /, ''))}</span>
                <div class="chip-row">
                  <span class="sha-chip" title="distill commit — click the row to view this version">⚗ distill ${c.sha.slice(0, 7)}</span>
                  ${vibe ? `<a class="sha-chip" title="vibe · code · prompt side by side" href="${rlink(repo)}/vibe/${vibe.sha}/all">${ICON_ALL} all</a>` : ''}
                </div>
                <div class="meta-line">
                  <span class="dim small">${timeAgo(c.date)}</span>
                  <a class="small" href="${rlink(repo)}/prompt/${c.sha}" title="the change this vibe made to the distilled prompt">change →</a>
                </div>
              </div>`;
          }, 'Distills')}
        </div>
      </section>
      <section class="preview-pane">
        <div class="pane-head">
          <h2>⚗ The Prompt</h2>
          <span class="dim small" id="prompt-at"></span>
        </div>
        <div class="card">
          <div class="copy-wrap">
            ${STATIC ? '' : '<button class="icon-copy" id="edit-prompt" title="edit the distilled prompt (commits to its history)" style="right:46px">✎</button>'}
            <button class="icon-copy" id="copy-prompt" title="copy this prompt">${ICON_COPY}</button>
            <div class="plan-body prompt-body" id="prompt-body"></div>
          </div>
          <details class="plan">
            <summary>generator settings</summary>
            <pre class="blob" id="prompt-front" style="margin-top:6px"></pre>
          </details>
        </div>
      </section>
    </div>`;

  const cache = new Map();
  let shownBody = '';
  const show = (sha, front, body) => {
    shownBody = body;
    document.getElementById('prompt-body').innerHTML = md(body);
    document.getElementById('prompt-front').textContent = front;
    document.getElementById('prompt-at').textContent =
      sha === hist[0]?.sha ? 'latest' : `as of distill ${sha.slice(0, 7)}`;
    app.querySelectorAll('#prompt-hist .tl-cell').forEach((el) =>
      el.classList.toggle('selected', el.dataset.sha === sha));
  };
  if (hist[0]) {
    cache.set(hist[0].sha, { front: p.front, body: p.body });
    show(hist[0].sha, p.front, p.body);
  }
  app.querySelectorAll('#prompt-hist .tl-cell').forEach((el) => {
    el.addEventListener('click', async (e) => {
      if (e.target.closest('a')) return; // drift link navigates
      const sha = el.dataset.sha;
      if (!cache.has(sha)) {
        try { cache.set(sha, await api(bq(`/api/repos/${repo}/prompt/at/${sha}`))); }
        catch { return; }
      }
      const v = cache.get(sha);
      show(sha, v.front, v.body);
    });
  });
  const editBtn = document.getElementById('edit-prompt');
  if (editBtn) editBtn.onclick = () => {
    // editing always starts from the latest version
    if (hist[0] && cache.has(hist[0].sha)) {
      const v = cache.get(hist[0].sha);
      show(hist[0].sha, v.front, v.body);
    }
    const bodyEl = document.getElementById('prompt-body');
    const current = shownBody;
    bodyEl.innerHTML = `
      <textarea id="prompt-edit" class="mono" rows="18" style="font-size:13px"></textarea>
      <div class="modal-actions" style="margin-top:10px">
        <button class="ghost" id="edit-cancel">Cancel</button>
        <button id="edit-save">Save — commit to prompt history</button>
      </div>`;
    const ta = document.getElementById('prompt-edit');
    ta.value = current;
    ta.focus();
    document.getElementById('edit-cancel').onclick = () => render();
    document.getElementById('edit-save').onclick = async () => {
      try {
        await api(`/api/repos/${repo}/prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: ta.value, branch: curBranch }),
        });
        render();
      } catch (e) {
        alert(`save failed: ${e.message}`);
      }
    };
  };
  const copyBtn = document.getElementById('copy-prompt');
  copyBtn.onclick = async () => {
    await navigator.clipboard.writeText(shownBody);
    copyBtn.innerHTML = '✓';
    copyBtn.classList.add('copied');
    setTimeout(() => { copyBtn.innerHTML = ICON_COPY; copyBtn.classList.remove('copied'); }, 1200);
  };
}

async function viewPromptCommit(repo, sha) {
  const [c, d] = await Promise.all([api(bq(`/api/repos/${repo}/prompt/commits/${sha}`)), api(bq(`/api/repos/${repo}`))]);
  const vibeSha = (c.message.match(/Distills:\s*([0-9a-f]+)/) || [])[1];
  const vibe = vibeSha && d.vibes.find((v) => v.sha === vibeSha);
  app.innerHTML = `
    ${repoHeader(repo, 'prompt', d.branches)}
    <p><a href="${rlink(repo)}/prompt">← the prompt</a></p>
    <div class="card">
      <h2>${esc(c.message.split('\n')[0])}</h2>
      <div class="meta-line">
        <span class="sha-chip">${c.sha.slice(0, 12)}</span>
        <span class="dim small">${timeAgo(c.date)}</span>
      </div>
      ${vibe ? `
        <details class="plan" open>
          <summary>⚡ caused by vibe ${vibeSha.slice(0, 7)}</summary>
          <div class="plan-body"><strong>${esc(vibe.prompt)}</strong></div>
        </details>` : ''}
    </div>
    <h2>Prompt change <span class="dim small">how this vibe changed the distilled prompt</span></h2>
    <div class="diff">${c.diff ? renderDiff(c.diff) : '<div class="line dim">(no change)</div>'}</div>`;
}
