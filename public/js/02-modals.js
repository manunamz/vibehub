'use strict';
/* shared modal builders */

// Read an image file and return a square, downscaled data URL (center-cropped).
// Keeps the userpic tiny so it rides along inside user.json (and the export).
function downscaleToDataURL(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const s = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(
        img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      const jpeg = canvas.toDataURL('image/jpeg', 0.85);
      const png = canvas.toDataURL('image/png');
      resolve(png.length < jpeg.length ? png : jpeg); // smaller wins (graphics vs photos)
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}

// ---- agent settings (model selection, per repo) ----
async function showSettingsModal(repo) {
  document.getElementById('settings-modal')?.remove();
  const s = await api(`/api/repos/${repo}/settings`);
  const overlay = document.createElement('div');
  overlay.id = 'settings-modal';
  overlay.className = 'modal-overlay';
  const field = (id, label, value, hint, list = 'model-list') => `
    <label class="small dim" for="${id}" style="display:block;margin:12px 0 4px">${label}</label>
    <input type="text" id="${id}" list="${list}" value="${esc(value)}" spellcheck="false" autocomplete="off">
    <div class="dim small" style="margin-top:3px">${hint}</div>`;
  overlay.innerHTML = `
    <div class="modal-card modal-sm">
      <h2>⚙ Repo settings — ${esc(repo)}</h2>
      <h3 class="set-section">Details</h3>
      <label class="small dim" for="set-name" style="display:block;margin:12px 0 4px">Repository name</label>
      <input type="text" id="set-name" value="${esc(repo)}" spellcheck="false" autocomplete="off">
      <div class="dim small" style="margin-top:3px">renaming breaks old links; vibe ↔ code history is unaffected</div>
      <h3 class="set-section">Agent</h3>
      <p class="dim small" style="margin-top:0">Which models power this repo's agents. Applies to vibes committed after saving.</p>
      <datalist id="model-list">
        <option value="default"><option value="opus"><option value="sonnet"><option value="haiku">
      </datalist>
      <datalist id="agent-list">
        <option value="auto"><option value="claude"><option value="codex"><option value="stub">
      </datalist>
      ${field('set-kind', 'Coding agent', s.agentKind || 'auto', '"auto" = claude if installed, else stub · codex is experimental and needs the codex CLI', 'agent-list')}
      ${field('set-agent', 'Coding agent model', s.agentModel, '"default" uses the agent CLI\'s own default — full model ids work too')}
      ${field('set-distiller', 'Distiller / ramble model', s.distillerModel, 'always runs on claude; cheap + fast is fine — it summarizes, it does not build')}
      <div class="err" id="set-err"></div>
      <div class="modal-actions">
        <button class="ghost" id="set-cancel">Cancel</button>
        <button id="set-save">Save</button>
      </div>
      <div class="bs-sep" style="margin:16px 0 10px"></div>
      <h3 class="set-section danger">Danger zone</h3>
      <div class="small dim" style="margin-bottom:6px">Deletes this repo's vibes, code, branches, and logs. No undo.</div>
      <div style="display:flex;gap:8px">
        <input type="text" id="del-confirm" placeholder="type ${esc(repo)} to confirm" spellcheck="false" autocomplete="off">
        <button id="del-repo" style="background:var(--red);flex-shrink:0" disabled>Delete repo</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#set-cancel').onclick = close;
  const delInput = overlay.querySelector('#del-confirm');
  const delBtn = overlay.querySelector('#del-repo');
  delInput.addEventListener('input', () => { delBtn.disabled = delInput.value.trim() !== repo; });
  delBtn.onclick = async () => {
    try {
      await api(`/api/repos/${repo}/delete`, { method: 'POST' });
      close();
      navigate(homeLink());
    } catch (e) {
      overlay.querySelector('#set-err').textContent = e.message;
    }
  };
  overlay.querySelector('#set-save').onclick = async () => {
    try {
      await api(`/api/repos/${repo}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentKind: document.getElementById('set-kind').value.trim(),
          agentModel: document.getElementById('set-agent').value.trim(),
          distillerModel: document.getElementById('set-distiller').value.trim(),
        }),
      });
      const newName = document.getElementById('set-name').value.trim();
      if (newName && newName !== repo) {
        await api(`/api/repos/${repo}/rename`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName }),
        });
        close();
        navigate(`${homeLink()}/${newName}`);
        return;
      }
      close();
    } catch (e) {
      overlay.querySelector('#set-err').textContent = e.message;
    }
  };
}



// In static mode, API calls map onto the exported JSON snapshot.
function showProfileModal() {
  document.getElementById('profile-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'profile-modal';
  overlay.className = 'modal-overlay';
  const f = (id, label, value, max) => `
    <label class="small dim" for="${id}" style="display:block;margin:10px 0 4px">${label}</label>
    <input type="text" id="${id}" value="${esc(value || '')}" maxlength="${max}" autocomplete="off">`;
  let avatarVal = curProfile.avatar || '';
  const previewSrc = () => avatarVal || '/vibybara-spring.svg';
  overlay.innerHTML = `
    <div class="modal-card modal-sm">
      <h2>Edit profile</h2>
      <div class="pf-avatar-row">
        <img id="pf-avatar-preview" class="pf-avatar${avatarVal ? ' avatar-photo' : ''}" src="${previewSrc()}" alt="">
        <div class="pf-avatar-ctl">
          <label class="ghost pf-avatar-btn" for="pf-avatar-file">Upload photo</label>
          <input type="file" id="pf-avatar-file" accept="image/png,image/jpeg,image/gif,image/webp" hidden>
          <button type="button" class="link-btn pf-avatar-clear" id="pf-avatar-clear" ${avatarVal ? '' : 'hidden'}>Remove</button>
        </div>
      </div>
      ${f('pf-name', 'Name', curProfile.name, 40)}
      ${f('pf-tagline', 'Tagline', curProfile.tagline, 60)}
      <label class="small dim" for="pf-bio" style="display:block;margin:10px 0 4px">Bio</label>
      <textarea id="pf-bio" rows="3" maxlength="240">${esc(curProfile.bio || '')}</textarea>
      ${f('pf-location', 'Location', curProfile.location, 60)}
      ${f('pf-link', 'Link', curProfile.link, 140)}
      <div class="err" id="pf-err"></div>
      <div class="modal-actions">
        <button class="ghost" id="pf-cancel">Cancel</button>
        <button id="pf-save">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#pf-cancel').onclick = close;

  const preview = overlay.querySelector('#pf-avatar-preview');
  const clearBtn = overlay.querySelector('#pf-avatar-clear');
  const setAvatar = (val) => {
    avatarVal = val;
    preview.src = previewSrc();
    preview.classList.toggle('avatar-photo', !!val);
    clearBtn.hidden = !val;
  };
  overlay.querySelector('#pf-avatar-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const err = overlay.querySelector('#pf-err');
    err.textContent = '';
    try {
      setAvatar(await downscaleToDataURL(file, 256));
    } catch {
      err.textContent = "couldn't read that image";
    }
    e.target.value = ''; // allow re-picking the same file
  };
  clearBtn.onclick = () => setAvatar('');

  overlay.querySelector('#pf-save').onclick = async () => {
    try {
      curProfile = await api('/api/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: document.getElementById('pf-name').value,
          tagline: document.getElementById('pf-tagline').value,
          bio: document.getElementById('pf-bio').value,
          location: document.getElementById('pf-location').value,
          link: document.getElementById('pf-link').value,
          avatar: avatarVal,
        }),
      });
      curUser = curProfile.name;
      close();
      render();
    } catch (e) {
      overlay.querySelector('#pf-err').textContent = e.message;
    }
  };
}

function showNewRepoModal() {
  document.getElementById('newrepo-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'newrepo-modal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card modal-sm">
      <h2>New repository</h2>
      <p class="dim small" style="margin-top:0">A repo starts empty — your first vibe builds the app.</p>
      <label class="small dim" style="display:block;margin:10px 0 4px">Name</label>
      <input type="text" id="new-name" placeholder="my-next-idea" spellcheck="false" autocomplete="off">
      <label class="small dim" style="display:block;margin:10px 0 4px">Description <span class="dim">(optional)</span></label>
      <input type="text" id="new-desc" autocomplete="off">
      <div class="err" id="new-err"></div>
      <div class="modal-actions">
        <button class="ghost" id="new-cancel">Cancel</button>
        <button id="new-go">Create repository</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#new-cancel').onclick = close;
  const input = overlay.querySelector('#new-name');
  input.focus();
  const go = async () => {
    const name = input.value.trim();
    if (!name) return;
    try {
      await api('/api/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: overlay.querySelector('#new-desc').value.trim() }),
      });
      close();
      navigate(`${homeLink()}/${name}`);
    } catch (e) {
      overlay.querySelector('#new-err').textContent = e.message;
    }
  };
  overlay.querySelector('#new-go').onclick = go;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); if (e.key === 'Escape') close(); });
}

function showBranchModal(repo, fromVibe) {
  document.getElementById('branch-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'branch-modal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card modal-sm">
      <h2>New branch</h2>
      <p class="dim small" style="margin-top:0">${fromVibe
        ? `Branching from vibe <span class="sha-chip">${fromVibe.slice(0, 7)}</span> — vibes, code, and the distilled prompt all fork there, in tandem.`
        : 'Branching from the tip of <strong>main</strong> — a parallel timeline for the idea.'}</p>
      <input type="text" id="branch-input" placeholder="feat/my-idea" spellcheck="false" autocomplete="off">
      <details class="plan" style="margin-top:10px">
        <summary>ℹ branch naming conventions</summary>
        <div class="plan-body small">
          <p>Coders prefix branch names by purpose, with a slash:</p>
          <ul>
            <li><code>feat/…</code> / <code>feature/…</code> — new functionality (<code>feat/dark-mode</code>)</li>
            <li><code>fix/…</code> / <code>bugfix/…</code> — bug fixes (<code>fix/timer-drift</code>)</li>
            <li><code>exp/…</code> / <code>spike/…</code> — experiments you might throw away</li>
            <li><code>refactor/…</code> / <code>chore/…</code> / <code>docs/…</code> — cleanups that don't change behavior</li>
            <li><code>release/v1.2</code> / <code>hotfix/…</code> — shipping, and emergency fixes to shipped things</li>
          </ul>
          <p class="dim">After the prefix: short, lowercase, kebab-case — <code>feat/spin-the-wheel</code>, not <code>feat/MyNewIdea2</code>.</p>
        </div>
      </details>
      <div class="err" id="branch-err"></div>
      <div class="modal-actions">
        <button class="ghost" id="branch-cancel">Cancel</button>
        <button id="branch-go">Create branch</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#branch-cancel').onclick = close;
  const input = overlay.querySelector('#branch-input');
  input.focus();
  const go = async () => {
    const name = input.value.trim();
    if (!name) return;
    try {
      await api(`/api/repos/${repo}/branches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, fromVibe }),
      });
      close();
      navigate(`${homeLink()}/${repo}@${encodeURIComponent(name)}`);
    } catch (e) {
      overlay.querySelector('#branch-err').textContent = e.message;
    }
  };
  overlay.querySelector('#branch-go').onclick = go;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go();
    if (e.key === 'Escape') close();
  });
}

function deleteBranchFlow(repo) {
  const branch = curBranch;
  document.getElementById('branch-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'branch-modal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card modal-sm">
      <h2>Delete branch</h2>
      <p class="dim small" style="margin-top:0">Delete <strong>${esc(branch)}</strong>? Its vibes, code, and distilled prompt go with it. <strong>main</strong> is untouched.</p>
      <div class="err" id="branch-err"></div>
      <div class="modal-actions">
        <button class="ghost" id="branch-cancel">Cancel</button>
        <button id="branch-go" style="background:var(--red)">Delete branch</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#branch-cancel').onclick = close;
  let force = false;
  overlay.querySelector('#branch-go').onclick = async () => {
    try {
      await api(`/api/repos/${repo}/branches/${encodeURIComponent(branch)}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      close();
      navigate(`${homeLink()}/${repo}`);
    } catch (e) {
      overlay.querySelector('#branch-err').textContent = e.message;
      if (/unmerged/.test(e.message)) {
        force = true;
        overlay.querySelector('#branch-go').textContent = 'Delete anyway';
      }
    }
  };
}
