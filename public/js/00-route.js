'use strict';
/* Pure route parsing for VibeHub's GitHub-shaped clean paths (no hash).
 * Loaded as a classic script in the browser (defines globals); also required
 * by the unit tests in node via the module.exports guard at the bottom. No DOM.
 *
 *   /<user>                          profile (home)
 *   /<user>/<repo>[@branch]          repo (vibes + app)
 *   /<user>/<repo>/code[/<sha>]      code view / a code commit
 *   /<user>/<repo>/prompt[/<sha>]    prompt tab / a distill commit
 *   /<user>/<repo>/vibe/<sha>[/all]  vibe detail / the trio
 *   /<user>/<repo>/check             vibe check
 *   /<user>/<repo>/blob/<ref>/<path> file contents
 *
 * The <user> segment is cosmetic (single-user) — parsed but ignored, so a
 * profile rename never breaks a deep link. Branch rides on the repo segment
 * as `@branch`, percent-encoded so slash names (feat%2Fdark-mode) stay intact.
 */
function parseRoute(pathname) {
  const parts = String(pathname || '/').replace(/^\/+/, '').split('/').filter(Boolean);
  if (parts.length <= 1) return { view: 'home' }; // "/" or "/<user>"

  const seg = decodeURIComponent(parts[1]);
  const at = seg.indexOf('@');
  const repo = at < 0 ? seg : seg.slice(0, at);
  const branch = at < 0 ? 'main' : seg.slice(at + 1);
  const rest = parts.slice(2);
  const r = (view, extra) => Object.assign({ view, repo, branch }, extra);

  if (rest.length === 0) return r('repo');
  if (rest[0] === 'code' && !rest[1]) return r('code');
  if (rest[0] === 'code' && rest[1]) return r('commit', { sha: rest[1] });
  if (rest[0] === 'prompt' && !rest[1]) return r('prompt');
  if (rest[0] === 'prompt' && rest[1]) return r('promptCommit', { sha: rest[1] });
  if (rest[0] === 'vibe' && rest[1] && !rest[2]) return r('vibe', { sha: rest[1] });
  if (rest[0] === 'vibe' && rest[1] && rest[2] === 'all') return r('vibeAll', { sha: rest[1] });
  if (rest[0] === 'check') return r('check');
  if (rest[0] === 'blob' && rest[1] && rest[2]) {
    return r('blob', { ref: decodeURIComponent(rest[1]), path: decodeURIComponent(rest.slice(2).join('/')) });
  }
  return { view: '404' };
}

// Is this href an in-app route the client router owns (vs. an asset/API/preview)?
function isAppPath(href) {
  return typeof href === 'string' && href.startsWith('/') && !/^\/(api|preview|js)\//.test(href);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { parseRoute, isAppPath };
