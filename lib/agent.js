'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const AGENT_TIMEOUT_MS = Number(process.env.VIBEHUB_AGENT_TIMEOUT_MS || 10 * 60 * 1000);
const DISTILLER_MODEL = process.env.VIBEHUB_DISTILLER_MODEL || 'haiku';

const cliCache = {};
function cliAvailable(bin) {
  if (cliCache[bin] === undefined) {
    try {
      execFileSync(bin, ['--version'], { stdio: 'ignore', timeout: 10000 });
      cliCache[bin] = true;
    } catch {
      cliCache[bin] = false;
    }
  }
  return cliCache[bin];
}
const claudeAvailable = () => cliAvailable('claude');

// Memoized `<bin> --version` (or 'unknown') — recorded as the harness version.
const versionCache = {};
function versionOf(bin) {
  if (versionCache[bin] === undefined) {
    try { versionCache[bin] = execFileSync(bin, ['--version'], { timeout: 10000 }).toString().trim(); }
    catch { versionCache[bin] = 'unknown'; }
  }
  return versionCache[bin];
}
const claudeVersion = () => versionOf('claude');

function agentMode() {
  const forced = (process.env.VIBEHUB_AGENT || '').toLowerCase();
  if (forced === 'stub') return 'stub';
  if (forced === 'claude') return 'claude';
  return claudeAvailable() ? 'claude' : 'stub';
}

// Which coding agent runs a vibe: repo setting ('auto'|'claude'|'codex'|'stub'),
// env override wins, 'auto' falls back to claude-else-stub.
function resolveKind(kind) {
  const forced = (process.env.VIBEHUB_AGENT || '').toLowerCase();
  if (forced === 'stub') return 'stub';
  if (kind && kind !== 'auto') return kind;
  return claudeAvailable() ? 'claude' : 'stub';
}

function buildPrompt(vibe) {
  return [
    'You are the VibeHub coding agent. You are working inside the app directory of a VibeHub repo.',
    'A user just committed the following vibe (prompt + plan). Implement it by creating or editing files in the current directory.',
    '',
    'Rules:',
    '- Only create/edit files. Do not run shell commands, do not run git.',
    '- Unless the vibe clearly asks for something else, build a self-contained static web app with an index.html entry point (inline CSS/JS is fine) so it can be previewed in a browser.',
    '- If files already exist, evolve them to incorporate this vibe instead of starting over.',
    '- Keep it working end to end; no placeholders.',
    '',
    '## Prompt',
    vibe.prompt,
    vibe.plan ? '\n## Plan\n' + vibe.plan : '',
  ].join('\n');
}

function buildDistillPrompt(ctx) {
  return [
    'You are the VibeHub distiller. A VibeHub repo is built incrementally from "vibes" (prompts + plans) that a coding agent implements one by one.',
    'Your job: write ONE self-contained prompt that would make a fresh coding agent build approximately the CURRENT state of the app from an empty directory.',
    '',
    'You are in the app\'s code directory — read the files to ground yourself in what actually got built, including decisions the vibes never mentioned.',
    '',
    '## Previous distilled prompt (approximates the app before the latest vibe)',
    ctx.prev ? ctx.prev : '(none — this is the first vibe)',
    '',
    '## Latest vibe',
    'Prompt: ' + ctx.prompt,
    ctx.plan ? 'Plan:\n' + ctx.plan : '',
    '',
    'Rules:',
    '- Respond with ONLY the new distilled prompt text (markdown is fine). No preamble, no commentary, no surrounding code fence.',
    '- It must be self-contained: a fresh agent given only this prompt should recreate the app\'s features, layout, and key behaviors approximately.',
    '- Be specific about features and behaviors; stay concise (aim for under 400 words).',
  ].join('\n');
}

function briefInput(input = {}) {
  return input.file_path || input.path || input.pattern || input.command || '';
}

// Core: run `claude -p` with stream-json so the log fills in live.
// Resolves {summary, model}; rejects on nonzero exit.
function streamClaude({ prompt, extraArgs, cwd, logPath, tag }) {
  return new Promise((resolve, reject) => {
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    const child = spawn(
      'claude',
      ['-p', prompt, '--output-format', 'stream-json', '--verbose', ...extraArgs],
      {
        cwd,
        env: { ...process.env, CLAUDECODE: undefined, CLAUDE_CODE_ENTRYPOINT: undefined },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    let summary = '';
    let model = '';
    const handleEvent = (line) => {
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        logStream.write(line + '\n');
        return;
      }
      if (ev.type === 'system' && ev.subtype === 'init') {
        model = ev.model || '';
        logStream.write(`[${tag}] session started (${model || 'claude'})\n`);
      } else if (ev.type === 'assistant') {
        for (const c of ev.message?.content || []) {
          if (c.type === 'text' && c.text?.trim()) logStream.write(c.text.trim() + '\n');
          if (c.type === 'tool_use') logStream.write(`[${c.name}] ${briefInput(c.input)}\n`);
        }
      } else if (ev.type === 'user') {
        for (const c of ev.message?.content || []) {
          if (c.type === 'tool_result' && c.is_error) {
            const t = Array.isArray(c.content) ? c.content.map((x) => x.text || '').join(' ') : String(c.content || '');
            logStream.write(`[tool error] ${t.slice(0, 300)}\n`);
          }
        }
      } else if (ev.type === 'result') {
        summary = (ev.result || '').trim();
        logStream.write(`[${tag}] finished (${ev.subtype || 'done'})\n`);
      }
    };

    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) handleEvent(line);
      }
    });
    child.stderr.on('data', (d) => logStream.write(d));

    const timer = setTimeout(() => {
      logStream.write(`\n[vibehub] ${tag} timed out, killing\n`);
      child.kill('SIGKILL');
    }, AGENT_TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      logStream.end();
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (buf.trim()) handleEvent(buf.trim());
      logStream.end();
      if (code === 0) resolve({ summary, model });
      else reject(new Error(`claude (${tag}) exited with code ${code}`));
    });
  });
}

// Deterministic fallback used when the claude CLI is unavailable (or VIBEHUB_AGENT=stub):
// appends the vibe to a simple log-style page so the pipeline is still demonstrable.
function runStub(vibe, cwd, logPath) {
  const file = path.join(cwd, 'index.html');
  let html;
  if (fs.existsSync(file)) {
    html = fs.readFileSync(file, 'utf8');
  } else {
    html = `<!doctype html><html><head><meta charset="utf-8"><title>VibeHub stub app</title>
<style>body{font-family:system-ui;max-width:720px;margin:3rem auto;padding:0 1rem}article{border:1px solid #ddd;border-radius:8px;padding:1rem;margin:1rem 0}</style>
</head><body><h1>Stub agent output</h1>
<p>The claude CLI was not used; each vibe is appended below.</p>
<!-- vibes --></body></html>`;
  }
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const entry = `<article><h2>${esc(vibe.prompt).slice(0, 120)}</h2><pre>${esc(vibe.plan || '(no plan)')}</pre></article>\n<!-- vibes -->`;
  html = html.includes('<!-- vibes -->') ? html.replace('<!-- vibes -->', entry) : html + entry;
  fs.writeFileSync(file, html);
  fs.appendFileSync(logPath, '[vibehub] stub agent wrote index.html\n');
  return Promise.resolve({ summary: 'stub agent updated index.html', model: 'stub' });
}

// Experimental adapter: OpenAI's codex CLI in non-interactive JSONL mode.
const codexVersion = () => versionOf('codex');
function runCodex(vibe, cwd, logPath, opts = {}) {
  return new Promise((resolve, reject) => {
    if (!cliAvailable('codex')) {
      return reject(new Error('codex CLI not found — install it, or set this repo\'s agent back to auto/claude'));
    }
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    const args = ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'workspace-write'];
    if (opts.model && opts.model !== 'default') args.push('-m', opts.model);
    args.push(buildPrompt(vibe));
    const child = spawn('codex', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let summary = '';
    const handleEvent = (line) => {
      let ev;
      try { ev = JSON.parse(line); } catch { logStream.write(line + '\n'); return; }
      const item = ev.item || {};
      if (ev.type === 'item.completed') {
        if (item.type === 'agent_message' && item.text) { summary = item.text.trim(); logStream.write(item.text.trim() + '\n'); }
        else if (item.type === 'command_execution') logStream.write(`[exec] ${item.command || ''}\n`);
        else if (item.type === 'file_change') logStream.write(`[edit] ${(item.changes || []).map((c) => c.path).join(', ')}\n`);
      } else if (ev.type === 'turn.completed') logStream.write('[codex] turn completed\n');
    };
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) handleEvent(line);
      }
    });
    child.stderr.on('data', (d) => logStream.write(d));
    const timer = setTimeout(() => { logStream.write('\n[vibehub] codex timed out, killing\n'); child.kill('SIGKILL'); }, AGENT_TIMEOUT_MS);
    child.on('error', (err) => { clearTimeout(timer); logStream.end(); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (buf.trim()) handleEvent(buf.trim());
      logStream.end();
      if (code === 0) resolve({ summary: summary || 'agent finished', model: opts.model && opts.model !== 'default' ? opts.model : 'codex default', harness: codexVersion() });
      else reject(new Error(`codex exited with code ${code}`));
    });
  });
}

// The coding agent: writes files in cwd. Returns {summary, model, harness}.
async function runAgent(vibe, cwd, logPath, opts = {}) {
  const mode = resolveKind(opts.kind);
  fs.appendFileSync(logPath, `[vibehub] coding agent: ${mode}\n`);
  if (mode === 'codex') return runCodex(vibe, cwd, logPath, opts);
  if (mode !== 'claude' && mode !== 'stub') throw new Error(`unknown agent "${mode}" — pick auto, claude, codex, or stub`);
  if (mode === 'claude') {
    const r = await streamClaude({
      prompt: buildPrompt(vibe),
      extraArgs: [
        '--allowed-tools', 'Write,Edit,Read,Glob,Grep',
        '--disallowed-tools', 'Bash,WebFetch,WebSearch,Task,NotebookEdit',
        '--permission-mode', 'acceptEdits',
        ...(opts.model && opts.model !== 'default' ? ['--model', opts.model] : []),
      ],
      cwd,
      logPath,
      tag: 'agent',
    });
    return { summary: r.summary || 'agent finished', model: r.model, harness: claudeVersion() };
  }
  const r = await runStub(vibe, cwd, logPath);
  return { ...r, harness: 'vibehub-stub' };
}

// The distiller: read-only pass that produces one prompt approximating the
// current app. ctx = {prev, prompt, plan}. Returns {text, model}.
async function runDistiller(ctx, cwd, logPath, opts = {}) {
  const mode = agentMode();
  const model = opts.model && opts.model !== 'default' ? opts.model : DISTILLER_MODEL;
  fs.appendFileSync(logPath, `\n[vibehub] distiller mode: ${mode}\n`);
  if (mode === 'claude') {
    const r = await streamClaude({
      prompt: buildDistillPrompt(ctx),
      extraArgs: [
        '--allowed-tools', 'Read,Glob,Grep',
        '--disallowed-tools', 'Bash,Write,Edit,WebFetch,WebSearch,Task,NotebookEdit',
        '--model', model,
      ],
      cwd,
      logPath,
      tag: 'distiller',
    });
    if (!r.summary) throw new Error('distiller returned no text');
    return { text: r.summary, model: r.model || model };
  }
  const base = ctx.prev
    ? ctx.prev.trim()
    : 'Build a self-contained static web app with an index.html entry point.';
  const step = `Then: ${ctx.prompt}${ctx.plan ? ` (plan: ${ctx.plan.replace(/\s+/g, ' ')})` : ''}`;
  return { text: `${base}\n${step}`, model: 'stub' };
}

// Ramble cleanup: turn stream-of-consciousness into a crisp {prompt, plan}.
async function runRambleCleanup(text, cwd, logPath, opts = {}) {
  const mode = agentMode();
  const model = opts.model && opts.model !== 'default' ? opts.model : DISTILLER_MODEL;
  fs.appendFileSync(logPath, `[vibehub] ramble cleanup mode: ${mode}\n`);
  if (mode === 'claude') {
    const r = await streamClaude({
      prompt: [
        'You clean up stream-of-consciousness app ideas into a crisp VibeHub vibe.',
        'Rewrite the ramble below in EXACTLY this format, nothing else:',
        '',
        'PROMPT: <1-3 sentences: what to build or change>',
        'PLAN:',
        '<short markdown bullets: how to approach it>',
        '',
        'Keep the user\'s intent and all concrete details they mention; do not invent major features they did not hint at.',
        '',
        '## Ramble',
        text,
      ].join('\n'),
      extraArgs: [
        '--disallowed-tools', 'Bash,Write,Edit,Read,Glob,Grep,WebFetch,WebSearch,Task,NotebookEdit',
        '--model', model,
      ],
      cwd,
      logPath,
      tag: 'ramble',
    });
    const m = (r.summary || '').match(/PROMPT:\s*([\s\S]*?)\n\s*PLAN:\s*\n?([\s\S]*)/);
    if (m) return { prompt: m[1].trim(), plan: m[2].trim() };
    if (r.summary) return { prompt: r.summary.trim(), plan: '' };
    throw new Error('ramble cleanup returned no text');
  }
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).filter(Boolean);
  return {
    prompt: sentences[0] || text.slice(0, 120),
    plan: sentences.slice(1).map((s) => `- ${s}`).join('\n'),
  };
}

module.exports = { runAgent, runDistiller, runRambleCleanup, agentMode, claudeVersion };
