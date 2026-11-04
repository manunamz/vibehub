/* VibeHub frontend — split into ordered classic scripts sharing one top-level
 * scope (no build step, no module-state rewrite). Load order matters and is
 * defined by index.html. This file: state, helpers, icons, theme, api. */
'use strict';

const app = document.getElementById('app');
// read-only static export (set by export.js in the deployed bundle)
const STATIC = !!window.VIBEHUB_STATIC;
const REPO_URL = window.VIBEHUB_REPO_URL || 'https://github.com/manunamz/vibehub';

// HTML-escape for safe text interpolation — the most-used helper.
const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Keep only benign URL schemes in hrefs (blocks javascript:/data: etc.).
const safeUrl = (u) => /^(https?:|mailto:|[#/])/i.test(String(u ?? '')) ? u : '';
const timeAgo = (ts) => {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
};

// Static demo: write actions open this instead of hiding entirely.
function showDemoModal(action) {
  document.getElementById('demo-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'demo-modal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card modal-sm">
      <h2>⚡ that works in the live app</h2>
      <p class="dim small" style="margin-top:0">${action || 'This'} needs a coding agent, so it only runs in the real VibeHub — a tiny local app with no dependencies. Clone it and this exact button works for real:</p>
      <pre class="blob" style="font-size:12px;user-select:all">git clone ${REPO_URL}.git
cd vibehub && node server.js</pre>
      <div class="modal-actions">
        <button class="ghost" id="demo-close">got it</button>
        <a href="${REPO_URL}" target="_blank" rel="noopener"><button>VibeHub on GitHub →</button></a>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#demo-close').onclick = () => overlay.remove();
}
let curUser = 'vibybara';
let curProfile = { name: 'vibybara' };
let userLoaded = false;
async function loadUser() {
  if (userLoaded) return;
  userLoaded = true;
  try {
    curProfile = await api('/api/user');
    curUser = curProfile.name || curUser;
  } catch {}
}
let pollTimer = null;
// current branch, parsed from the /<user>/<repo>@branch path each render
let curBranch = 'main';
// cosmetic URL handle for the single user (display name → url-safe slug)
const userSlug = () => (curUser || 'user').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'user';
// link to the user's profile (home), and to a repo under it
const homeLink = () => '/' + userSlug();
const rlink = (repo) => homeLink() + '/' + esc(repo) + (curBranch === 'main' ? '' : '@' + encodeURIComponent(curBranch));
// clean-path navigation: push a new URL and re-render (no full page reload).
// Reset to the top like a real page load would — otherwise the previous page's
// scroll offset carries over and a freshly opened page looks nudged downward.
// Back/forward (popstate) keeps the browser's native scroll restoration.
function navigate(path) { history.pushState(null, '', path); window.scrollTo(0, 0); render(); }
const bq = (p) => p + (p.includes('?') ? '&' : '?') + 'branch=' + encodeURIComponent(curBranch);

// git-commit mark: empty circle, line stub either side
const ICON_COMMIT = '<svg class="octicon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="3.25"/><line x1="0.75" y1="8" x2="4.75" y2="8"/><line x1="11.25" y1="8" x2="15.25" y2="8"/></svg>';
const ICON_COPY = '<svg class="octicon" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>';
// three side-by-side panes: the "all" view (vibe | code | prompt)
const ICON_ALL = '<svg class="octicon" viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><rect x="1" y="2" width="3.4" height="12" rx="1"/><rect x="6.3" y="2" width="3.4" height="12" rx="1"/><rect x="11.6" y="2" width="3.4" height="12" rx="1"/></svg>';
const ICON_CODE = '<svg class="octicon" viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="m11.28 3.22 4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L13.94 8l-3.72-3.72a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215Zm-6.56 0a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L2.06 8l3.72 3.72a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L.47 8.53a.75.75 0 0 1 0-1.06Z"/></svg>';
const ICON_BRANCH = '<svg class="octicon" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/></svg>';

const LANG_COLORS = {
  HTML: '#e34c26', JavaScript: '#f1e05a', CSS: '#563d7c',
  TypeScript: '#3178c6', SVG: '#ff9900', Python: '#3572A5', Rust: '#dea584',
};

// GitHub-org-page style commit-activity sparkline
function sparkline(counts) {
  if (!counts || !counts.some((c) => c > 0)) return '';
  const W = 130, H = 36, max = Math.max(...counts);
  const pts = counts.map((c, i) => {
    const x = (i / (counts.length - 1)) * W;
    const y = H - 3 - (c / max) * (H - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
    <polygon points="0,${H} ${pts.join(' ')} ${W},${H}" fill="rgba(64,196,99,.18)"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="#40c463" stroke-width="1.8" stroke-linejoin="round"/>
  </svg>`;
}

// GitHub-commits-page grouping: one rounded box of cells per calendar day
function groupByDay(items, ts) {
  const groups = [];
  let cur = null;
  for (const it of items) {
    const d = new Date(ts(it) || Date.now());
    const key = d.toDateString();
    if (!cur || cur.key !== key) {
      cur = { key, label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }), items: [] };
      groups.push(cur);
    }
    cur.items.push(it);
  }
  return groups;
}
function timelineHTML(items, ts, cellFn, label) {
  return groupByDay(items, ts).map((g) => `
    <div class="tl-group">
      <div class="tl-date"><span class="tl-badge">${ICON_COMMIT}</span>${esc(label)} on ${esc(g.label)}</div>
      <div class="tl-box">${g.items.map(cellFn).join('')}</div>
    </div>`).join('');
}

// Preview renders at natural size; only if the app overflows horizontally is it
// scaled down — by exactly enough to fit, so it never feels needlessly small.
function fitPreview() {
  const wrap = document.getElementById('preview-wrap');
  const f = document.getElementById('preview');
  if (!wrap || !f) return;
  f.style.width = '100%';
  f.style.transform = 'none';
  f.style.height = '100%';
  let contentW = 0;
  try { contentW = f.contentDocument.documentElement.scrollWidth; } catch {}
  const paneW = wrap.clientWidth;
  if (contentW > paneW + 8) {
    const scale = paneW / contentW;
    f.style.width = contentW + 'px';
    f.style.transform = `scale(${scale})`;
    f.style.height = wrap.clientHeight / scale + 'px';
  }
}
window.addEventListener('resize', fitPreview);

// ---- theme (GitHub octicon sun/moon) ----
const ICON_SUN = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-1.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM8 0a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0V.75A.75.75 0 0 1 8 0ZM8 13a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 8 13ZM2.343 2.343a.75.75 0 0 1 1.061 0l1.06 1.061a.75.75 0 0 1-1.06 1.06L2.343 3.404a.75.75 0 0 1 0-1.06Zm9.193 9.193a.75.75 0 0 1 1.06 0l1.061 1.06a.75.75 0 0 1-1.06 1.061l-1.061-1.06a.75.75 0 0 1 0-1.061ZM16 8a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 16 8ZM3 8a.75.75 0 0 1-.75.75H.75a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 3 8Zm10.657-5.657a.75.75 0 0 1 0 1.061l-1.061 1.06a.75.75 0 1 1-1.06-1.06l1.06-1.06a.75.75 0 0 1 1.06 0Zm-9.193 9.193a.75.75 0 0 1 0 1.06l-1.06 1.061a.75.75 0 1 1-1.061-1.06l1.06-1.061a.75.75 0 0 1 1.061 0Z"/></svg>';
const ICON_MOON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M9.598 1.591a.749.749 0 0 1 .785-.175 7.001 7.001 0 1 1-8.967 8.967.75.75 0 0 1 .961-.96 5.5 5.5 0 0 0 7.046-7.046.75.75 0 0 1 .175-.786Zm1.616 1.945a7 7 0 0 1-7.678 7.678 5.499 5.499 0 1 0 7.678-7.678Z"/></svg>';
const COMPOSER_KEY = 'vibehub-composer';
let composerMode = localStorage.getItem(COMPOSER_KEY) || 'vibe';
const THEME_KEY = 'vibehub-theme';
// PNG (512px, alpha) rather than SVG: the marks use an SVG <mask>, which
// browsers rasterize at CSS resolution — soft on retina. A big PNG downscales crisp.
const markSrc = (t) =>
  (t || document.documentElement.dataset.theme) === 'light' ? '/logo-mark-light.png' : '/logo-mark-dark.png';
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.innerHTML = t === 'light' ? ICON_MOON : ICON_SUN;
  document.getElementById('favicon')?.setAttribute('href', markSrc(t));
  document.querySelectorAll('img.themed-mark').forEach((img) => { img.src = markSrc(t); });
}
applyTheme(
  localStorage.getItem(THEME_KEY) ||
    (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
);
document.getElementById('theme-toggle').onclick = () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
};

// ---- "what is this?" explainer ----
const INTRO_KEY = 'vibehub-intro-dismissed';
const INFO_HTML = `
  <div class="info-copy">
    <h2>🧑‍🎨 What's going on here?</h2>
    <p>Coders build software <strong>incrementally</strong>: on GitHub they save their work as a
    chain of small recorded changes called <em>commits</em>, so a project grows step by step and
    no step is ever lost.</p>
    <p><strong>VibeHub works exactly the same way — except you never write code.</strong></p>
    <ol>
      <li><strong>You commit a vibe</strong> — a short prompt saying what you want, plus an
      optional plan for how to go about it.</li>
      <li><strong>An AI agent picks it up</strong> — it writes the actual code and saves its own
      commit alongside yours, permanently linked to the vibe that caused it.</li>
      <li><strong>Your app updates</strong> — watch it change in the live preview, then commit the
      next vibe. Each one layers on the last, just like coders do.</li>
    </ol>
    <p>So every project keeps two parallel histories: <em>your trail of ideas</em> and <em>the
    agent's trail of code</em>. Curious what the agent actually did? Every vibe links to the
    agent's commit, and the Code tab is the full engine room — just like GitHub.</p>
  </div>`;
function showInfoModal() {
  let overlay = document.getElementById('info-modal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'info-modal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card">${INFO_HTML}
        <div style="text-align:right;margin-top:14px"><button id="info-close">got it</button></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.hidden = true; });
    overlay.querySelector('#info-close').onclick = () => { overlay.hidden = true; };
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') overlay.hidden = true; });
  }
  overlay.hidden = false;
}
document.getElementById('info-btn').onclick = showInfoModal;

function staticPath(p) {
  const [base, qs] = p.split('?');
  const q = new URLSearchParams(qs || '');
  const br = q.get('branch');
  const bseg = br && br !== 'main' ? `/branch/${br}` : '';
  let m;
  if (base === '/api/user') return '/api/user.json';
  if (base === '/api/repos') return '/api/repos.json';
  if ((m = base.match(/^\/api\/repos\/([^/]+)$/))) return `/api/repos/${m[1]}${bseg}/index.json`;
  if ((m = base.match(/^\/api\/repos\/([^/]+)\/branches$/))) return `/api/repos/${m[1]}/branches.json`;
  if ((m = base.match(/^\/api\/repos\/([^/]+)\/compare$/))) return `/api/repos/${m[1]}/compare/${q.get('with')}.json`;
  if ((m = base.match(/^\/api\/repos\/([^/]+)\/code\/tree$/))) return `/api/repos/${m[1]}${bseg}/code/tree/${q.get('ref') || 'HEAD'}.json`;
  if ((m = base.match(/^\/api\/repos\/([^/]+)\/code\/blob$/))) return `/api/repos/${m[1]}${bseg}/code/blob/${q.get('ref') || 'HEAD'}/${q.get('path')}`;
  if (base.endsWith('/log')) return base + '.txt';
  if (bseg && (m = base.match(/^\/api\/repos\/([^/]+)\/(prompt|code)((\/.*)?)$/))) {
    return `/api/repos/${m[1]}${bseg}/${m[2]}${m[3] || ''}.json`;
  }
  if (base.startsWith('/api/')) return base + '.json';
  return p;
}

async function api(path, opts) {
  if (STATIC) {
    if (opts && opts.method && opts.method !== 'GET') throw new Error('this is a read-only demo');
    path = staticPath(path);
  }
  const res = await fetch(path, opts);
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

// Minimal markdown for plans: headings, fences, inline code, bold, lists.
function md(src) {
  const lines = esc(src).split('\n');
  let out = '', inCode = false, inList = false;
  const closeList = () => { if (inList) { out += '</ul>'; inList = false; } };
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      closeList();
      out += inCode ? '</code></pre>' : '<pre><code>';
      inCode = !inCode;
      continue;
    }
    if (inCode) { out += line + '\n'; continue; }
    const inline = (t) => t
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) { closeList(); out += `<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`; continue; }
    const li = line.match(/^\s*[-*]\s+(.*)/);
    if (li) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${inline(li[1])}</li>`; continue; }
    closeList();
    out += line.trim() ? `<p>${inline(line)}</p>` : '';
  }
  closeList();
  if (inCode) out += '</code></pre>';
  return out;
}

function stateBadge(v) {
  const state = v.state || 'done';
  if (state === 'failed') {
    if (STATIC) return '<span class="badge failed">✕ failed</span>';
    return `<button class="badge failed rerun-btn" data-sha="${v.sha}" title="${esc(v.error || 'failed')} — click to rerun"><span class="df">✕ failed</span><span class="rr">↻ rerun</span></button>`;
  }
  return `<span class="badge ${state}">${STATE_LABEL[state] || esc(state)}</span>`;
}

const STATE_LABEL = {
  queued: '⏳ queued',
  running: '<span class="dot">●</span> agent coding…',
  done: '✓ shipped',
  failed: '✕ failed',
};

