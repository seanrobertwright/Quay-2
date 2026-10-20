#!/usr/bin/env node
/**
 * Local helper for filling in a UAT.
 *
 *     node uat-server.mjs path/to/UAT-myapp-2026-08-23.md
 *
 * Regenerates the HTML form, serves it at http://localhost:8777, and:
 *   * Save        -> writes .uat-progress-<slug>.json so nothing is ever lost
 *   * screenshots -> saved into assets/<slug>/ and linked from the markdown
 *   * Submit      -> validates, then writes the answers back into the markdown
 *                    and drops a machine-readable <name>.results.json
 *
 * No dependencies. Binds to 127.0.0.1 (this computer only). Stop it with Ctrl+C.
 * Mirrors uat_server.py exactly.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse, generate, resolveUrl, ID_RE, UatError } from './generate-uat-html.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(HERE, 'assets');
const MAX_UPLOAD = 8 * 1024 * 1024;
const MAX_BODY = 24 * 1024 * 1024;
const EXT_BY_MIME = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif',
  'image/webp': '.webp', 'image/avif': '.avif',
};
const MIME_BY_EXT = {
  '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};
const STATUS_MD = { pass: ['x', 'PASS'], fail: ['!', 'FAIL'], notdone: ['~', 'NOT DONE'] };
const SEV_LABEL = { cosmetic: 'Cosmetic', annoying: 'Annoying', blocker: 'Blocks me' };

class Ctx {
  constructor(mdPath) {
    this.mdPath = path.resolve(mdPath);
    this.dir = path.dirname(this.mdPath);
    this.slug = path.basename(this.mdPath, path.extname(this.mdPath));
    this.htmlPath = path.join(this.dir, this.slug + '.html');
    this.progressPath = path.join(this.dir, `.uat-progress-${this.slug}.json`);
    this.resultsPath = path.join(this.dir, this.slug + '.results.json');
    this.assetsDir = path.join(this.dir, 'assets', this.slug);
    this.currentTest = '';   // set by /goto, read by the annotator
    this.annotations = [];   // parked until the checklist tab collects them
    this.port = 0;           // set once the server is bound
  }

  ownOrigins() {
    return new Set([`http://localhost:${this.port}`, `http://127.0.0.1:${this.port}`]);
  }

  ownHosts() {
    return new Set([`localhost:${this.port}`, `127.0.0.1:${this.port}`]);
  }

  // Origins of the app under test (base_url and absolute uat:url markers); the annotator runs there
  appOrigins() {
    let meta, sections;
    try { ({ meta, sections } = parse(this.loadMd())); } catch { return new Set(); }
    const base = (meta.base_url || '').trim().replace(/\/$/, '');
    const urls = [base, ...sections.flatMap((s) => s.tests.map((t) => resolveUrl(t.url, base)))];
    const own = this.ownOrigins();
    const origins = new Set();
    for (const u of urls) {
      let parsed;
      try { parsed = new URL(u); } catch { continue; }
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !own.has(parsed.origin)) {
        origins.add(parsed.origin);
      }
    }
    return origins;
  }

  urlFor(testId) {
    const lines = this.loadMd();
    const { meta, sections } = parse(lines);
    const base = (meta.base_url || '').trim().replace(/\/$/, '');
    for (const sec of sections) {
      for (const t of sec.tests) if (t.id === testId) return resolveUrl(t.url, base);
    }
    return '';
  }

  loadMd() {
    return fs.readFileSync(this.mdPath, 'utf8').replace(/\r\n/g, '\n').split('\n');
  }

  index() {
    const lines = this.loadMd();
    const { meta, sections, spans } = parse(lines);
    const info = {};
    for (const s of sections) for (const t of s.tests) info[t.id] = { title: t.title, section: s.id };
    return { lines, meta, sections, spans, info };
  }
}

/* -------------------------------------------------------------- validation */

function validate(state, info, partial) {
  const problems = [];
  if (!(state.tester || '').trim()) problems.push({ id: null, msg: 'No tester name was filled in.' });
  const answers = state.answers || {};
  for (const tid of Object.keys(info)) {
    const a = answers[tid] || {};
    const status = (a.status || '').trim();
    const notes = (a.notes || '').trim();
    const concern = (a.concern || '').trim();
    if (!status) {
      if (!partial) problems.push({ id: tid, msg: `Test ${tid} has no answer yet.` });
      continue;
    }
    if (!STATUS_MD[status]) {
      problems.push({ id: tid, msg: `Test ${tid} has an unknown status "${status}".` });
      continue;
    }
    if ((status === 'fail' || status === 'notdone') && notes.length < 10) {
      problems.push({ id: tid, msg: `Test ${tid} is marked ${STATUS_MD[status][1]} but has no explanation.` });
    }
    if (concern && !(a.severity || '').trim()) {
      problems.push({ id: tid, msg: `Test ${tid} has a look-and-feel comment with no severity.` });
    }
  }
  for (const f of state.findings || []) {
    const fid = f.id || '?';
    if (!(f.title || '').trim()) problems.push({ id: fid, msg: `Finding ${fid} has no title.` });
    if (!(f.description || '').trim()) problems.push({ id: fid, msg: `Finding ${fid} has no description.` });
    if (!(f.severity || '').trim()) problems.push({ id: fid, msg: `Finding ${fid} has no severity.` });
  }
  return problems;
}

function countsOf(state, info) {
  const c = { pass: 0, fail: 0, notdone: 0, unanswered: 0, concerns: 0, findings: (state.findings || []).length };
  const answers = state.answers || {};
  for (const tid of Object.keys(info)) {
    const a = answers[tid] || {};
    const st = a.status || '';
    c[STATUS_MD[st] ? st : 'unanswered']++;
    if ((a.concern || '').trim()) c.concerns++;
  }
  return c;
}

/* --------------------------------------------------------- markdown writing */

function shotLines(owner, shots) {
  const out = [];
  (shots || []).forEach((s, i) => {
    const p = typeof s === 'string' ? s : s && s.path;
    if (!p || p.startsWith('data:')) return;
    out.push(`  - ![${owner} screenshot ${i + 1}](${p})`);
  });
  return out;
}

function answerMd(tid, a) {
  a = a || {};
  const status = a.status || '';
  const notes = (a.notes || '').trim();
  const concern = (a.concern || '').trim();
  const sev = SEV_LABEL[(a.severity || '').trim()] || '';
  const lines = [];
  lines.push(STATUS_MD[status]
    ? `- [${STATUS_MD[status][0]}] **Status:** ${STATUS_MD[status][1]}`
    : '- [ ] **Status:** _not answered_');
  lines.push('- **Notes:** ' + (notes ? notes.replace(/\n/g, '\n  ') : '_none_'));
  lines.push(concern
    ? `- **Look & feel concern:** (${sev || 'unrated'}) ${concern.replace(/\n/g, '\n  ')}`
    : '- **Look & feel concern:** _none_');
  const shots = shotLines(tid, a.screenshots);
  lines.push('- **Screenshots:**' + (shots.length ? '' : ' _none_'));
  return lines.concat(shots);
}

function natural(s) {
  return String(s).split(/(\d+)/).map((p) => (/^\d+$/.test(p) ? p.padStart(9, '0') : p)).join('');
}
const byNatural = (a, b) => (natural(a) < natural(b) ? -1 : natural(a) > natural(b) ? 1 : 0);

function summaryMd(state, info, counts, partial, when) {
  const tester = (state.tester || '').trim() || 'unnamed tester';
  const answers = state.answers || {};
  const ids = Object.keys(info);
  const failed = ids.filter((t) => (answers[t] || {}).status === 'fail').sort(byNatural);
  const notdone = ids.filter((t) => (answers[t] || {}).status === 'notdone').sort(byNatural);
  const concerned = ids.filter((t) => ((answers[t] || {}).concern || '').trim()).sort(byNatural);
  const unanswered = ids.filter((t) => !(answers[t] || {}).status).sort(byNatural);
  const total = ids.length;
  const lines = [
    `> **Run status:** ${partial ? 'PARTIAL (unfinished)' : 'COMPLETE'} — submitted ${when} by ${tester}`,
    `> **Result:** ${counts.pass} of ${total} passed · ${counts.fail} failed · ${counts.notdone} not done · `
      + `${counts.concerns} look-and-feel concerns · ${counts.findings} other findings`,
    '>',
    '> | Status | Count |',
    '> |---|---|',
    `> | Pass | ${counts.pass} |`,
    `> | Fail | ${counts.fail} |`,
    `> | Not done | ${counts.notdone} |`,
    `> | Unanswered | ${counts.unanswered} |`,
    '>',
  ];
  lines.push('> **Failed tests:** ' + (failed.length ? failed.join(', ') : 'none'));
  if (notdone.length) lines.push('> **Not done:** ' + notdone.join(', '));
  lines.push('> **Tests with look-and-feel concerns:** ' + (concerned.length ? concerned.join(', ') : 'none'));
  if (unanswered.length) lines.push('> **Never answered:** ' + unanswered.join(', '));
  return lines;
}

function findingsMd(state) {
  const fs_ = state.findings || [];
  const head = ['## Anything else the tester noticed', ''];
  if (!fs_.length) return head.concat(['_No tester-reported findings._']);
  const out = head.slice();
  for (const f of fs_) {
    const fid = f.id || 'F?';
    out.push(`### ${fid} — ${(f.title || '').trim() || '(no title)'}`);
    const sec = (f.section || '').trim();
    out.push('- **Reported from:** ' + (sec ? `Section ${sec}` : 'the end of the checklist'));
    out.push('- **Severity:** ' + (SEV_LABEL[(f.severity || '').trim()] || 'unrated'));
    out.push('- **What happened:** ' + (f.description || '').trim().replace(/\n/g, '\n  '));
    const shots = shotLines(fid, f.screenshots);
    out.push('- **Screenshots:**' + (shots.length ? '' : ' _none_'));
    out.push(...shots);
    out.push('');
  }
  out.pop();
  return out;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function writeMarkdown(ctx, state, partial) {
  const { lines, spans, info } = ctx.index();
  const counts = countsOf(state, info);
  const when = stamp();
  const answers = state.answers || {};

  const edits = [];
  for (const [tid, span] of Object.entries(spans.answers)) {
    edits.push([span[0] + 1, span[1] - 1, answerMd(tid, answers[tid])]);
  }
  if (spans.summary) edits.push([spans.summary[0] + 1, spans.summary[1] - 1, summaryMd(state, info, counts, partial, when)]);
  if (spans.findings) edits.push([spans.findings[0] + 1, spans.findings[1] - 1, findingsMd(state)]);

  edits.sort((a, b) => b[0] - a[0]);
  for (const [start, end, repl] of edits) lines.splice(start, end - start + 1, ...repl);

  if (spans.meta) {
    const [ms, me] = spans.meta;
    let block = lines.slice(ms, me + 1).filter((l) => !/^\s*(tester:|last_run:)/.test(l));
    block = block.slice(0, -1)
      .concat([`tester: ${(state.tester || '').trim()}`, `last_run: ${when}`])
      .concat(block.slice(-1));
    lines.splice(ms, me - ms + 1, ...block);
  }

  fs.writeFileSync(ctx.mdPath, lines.join('\n'), 'utf8');

  const results = {
    uat: path.basename(ctx.mdPath),
    tester: (state.tester || '').trim(),
    submitted: new Date().toISOString().slice(0, 19),
    partial: Boolean(partial),
    counts,
    answers: {},
    findings: state.findings || [],
  };
  for (const [tid, m] of Object.entries(info)) {
    const a = answers[tid] || {};
    results.answers[tid] = {
      status: a.status || 'unanswered',
      title: m.title,
      section: m.section,
      notes: (a.notes || '').trim(),
      concern: (a.concern || '').trim(),
      severity: (a.severity || '').trim(),
      screenshots: (a.screenshots || [])
        .filter((s) => s && typeof s.path === 'string' && s.path.startsWith('assets/'))
        .map((s) => s.path),
    };
  }
  fs.writeFileSync(ctx.resultsPath, JSON.stringify(results, null, 2), 'utf8');
  return counts;
}

/* ------------------------------------------------------------------ server */

// routes the annotator calls from the app's origin; every other route is same-origin only
const ANNOTATOR_ROUTES = new Set(['/api/current-test', '/api/annotate', '/annotate.js', '/receive']);

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Refuses requests from any page but the checklist itself (and the app, on annotator routes).
 * The Host check stops DNS rebinding; the Origin check stops another site in the same browser
 * reading the run or posting to save/submit, which would rewrite the checklist.
 * Sets res.corsOrigin when the response may carry CORS headers; returns false once it has replied.
 */
function guard(ctx, req, res, urlPath) {
  res.corsOrigin = null;
  if (!ctx.ownHosts().has(String(req.headers.host || '').toLowerCase())) {
    sendJson(res, { error: 'forbidden host' }, 403);
    return false;
  }
  const origin = String(req.headers.origin || '').toLowerCase();
  const annotator = ANNOTATOR_ROUTES.has(urlPath) || urlPath.startsWith('/vendor/');
  if (annotator && origin && ctx.appOrigins().has(origin)) {
    res.corsOrigin = origin;
    return true;
  }
  if (origin && !ctx.ownOrigins().has(origin)) {
    sendJson(res, { error: 'forbidden origin' }, 403);
    return false;
  }
  if (!origin && (req.method === 'POST' || req.method === 'OPTIONS')) {
    // browsers always send Origin on these; a request without one is not from the checklist
    sendJson(res, { error: 'missing origin' }, 403);
    return false;
  }
  return true;
}

// Only the app's own origin, and only on annotator routes (see guard)
function corsHeaders(res) {
  if (!res.corsOrigin) return { Vary: 'Origin' };
  return {
    Vary: 'Origin',
    'Access-Control-Allow-Origin': res.corsOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function sendJson(res, obj, code = 200) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...corsHeaders(res),
  });
  res.end(body);
}

function sendHtml(res, markup, code = 200) {
  const body = Buffer.from(markup, 'utf8');
  res.writeHead(code, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.length,
    ...corsHeaders(res),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function safePath(ctx, urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  if (!rel) return ctx.htmlPath;
  const full = path.resolve(ctx.dir, rel);
  const base = ctx.dir.endsWith(path.sep) ? ctx.dir : ctx.dir + path.sep;
  if (!full.startsWith(base)) return null;
  return full;
}

/** Write a base64 data: URL into the assets folder. Returns {path} or {error}. */
function saveDataUrl(ctx, owner, dataUrl) {
  if (!owner || !ID_RE.test(owner)) return { error: 'bad owner id' };
  const m = /^data:([\w/+.-]+);base64,([\s\S]*)$/.exec(dataUrl || '');
  if (!m) return { error: 'that file was not an image' };
  const [, mime, b64] = m;
  const ext = EXT_BY_MIME[mime];
  if (!ext) return { error: `unsupported image type ${mime}` };
  let raw;
  try { raw = Buffer.from(b64, 'base64'); } catch { return { error: 'the image could not be decoded' }; }
  if (!raw.length) return { error: 'the image could not be decoded' };
  if (raw.length > MAX_UPLOAD) return { error: 'that image is larger than 8 MB' };
  fs.mkdirSync(ctx.assetsDir, { recursive: true });
  let n = 1;
  while (fs.existsSync(path.join(ctx.assetsDir, `${owner}-${n}${ext}`))) n++;
  const name = `${owner}-${n}${ext}`;
  fs.writeFileSync(path.join(ctx.assetsDir, name), raw);
  const rel = `assets/${ctx.slug}/${name}`;
  console.log(`  saved image ${rel} (${Math.round(raw.length / 1024)} KB)`);
  return { path: rel };
}

function handleUpload(ctx, payload, res) {
  const r = saveDataUrl(ctx, String(payload.owner || '').trim(), payload.dataUrl);
  if (r.error) return sendJson(res, { error: r.error }, 400);
  return sendJson(res, { ok: true, path: r.path });
}

function stamp2() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function storeAnnotation(ctx, data) {
  const test = String(data.test || '').trim();
  let info;
  try { ({ info } = ctx.index()); }
  catch (err) { return { ok: false, error: `the checklist file has a problem: ${err.message}` }; }
  if (!info[test]) return { ok: false, error: `no test called ${test} in this checklist` };
  const pins = (data.pins || []).filter((p) => (p.comment || '').trim());
  if (!pins.length) return { ok: false, error: 'every pin needs a comment' };

  let image = '';
  if (data.image) {
    const saved = saveDataUrl(ctx, `${test}-annot`, data.image);
    if (saved.error) return { ok: false, error: saved.error };
    image = saved.path;
  }

  const record = {
    test,
    title: info[test].title,
    pins: pins.map((p) => ({
      n: p.n, comment: (p.comment || '').trim(), selector: p.selector || '',
      tag: p.tag || '', text: p.text || '',
    })),
    image,
    url: data.url || '',
    viewport: data.viewport || '',
    browser: data.browser || '',
    consoleErrors: (data.consoleErrors || []).map(String).slice(0, 5),
    at: stamp2(),
  };
  ctx.annotations.push(record);
  console.log(`  annotation for test ${test}: ${pins.length} pin(s)${image ? ' + image' : ' (no image)'}`);
  return { ok: true, index: ctx.annotations.length };
}

function handleSubmit(ctx, payload, res) {
  const state = payload.state || {};
  const partial = Boolean(payload.partial);
  let info;
  try { ({ info } = ctx.index()); }
  catch (err) { return sendJson(res, { error: `the checklist file has a problem: ${err.message}` }, 500); }

  const problems = validate(state, info, partial);
  if (problems.length) return sendJson(res, { ok: false, error: 'Some answers are missing.', problems });

  state.updatedAt = Date.now();
  fs.writeFileSync(ctx.progressPath, JSON.stringify(state, null, 2), 'utf8');

  let counts;
  try { counts = writeMarkdown(ctx, state, partial); }
  catch (err) { return sendJson(res, { error: `could not write the checklist: ${err.message}` }, 500); }

  try { generate(ctx.mdPath, ctx.htmlPath, true); } catch { /* the markdown is already written */ }

  let summary = `${counts.pass} passed, ${counts.fail} failed, ${counts.notdone} not done, `
    + `${counts.concerns} look-and-feel concerns, ${counts.findings} other findings.`;
  if (partial) summary += ` ${counts.unanswered} test(s) were left unanswered — the report is marked as unfinished.`;
  console.log(`\n  SUBMITTED — ${summary}`);
  console.log(`  wrote ${ctx.mdPath}`);
  console.log(`  wrote ${ctx.resultsPath}\n`);
  return sendJson(res, {
    ok: true, partial, summary,
    mdPath: ctx.mdPath,
    mdRel: path.basename(ctx.mdPath),
    results: ctx.resultsPath,
  });
}

function makeServer(ctx) {
  return http.createServer(async (req, res) => {
    const [urlPath, rawQuery] = (req.url || '/').split('?');
    const query = new URLSearchParams(rawQuery || '');
    try {
      if (!guard(ctx, req, res, urlPath)) return;
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { ...corsHeaders(res), 'Content-Length': 0 });
        return res.end();
      }
      if (req.method === 'GET') {
        if (urlPath === '/goto') {
          const test = query.get('test') || '';
          let sections;
          try { ({ sections } = ctx.index()); }
          catch (err) { return sendHtml(res, `<p>The checklist file has a problem: ${escHtml(err.message)}</p>`, 500); }
          const hit = sections.flatMap((sec) => sec.tests).find((t) => t.id === test);
          if (!hit) return sendHtml(res, `<p>No test called ${escHtml(test)} in this checklist.</p>`, 404);
          const target = ctx.urlFor(test);
          if (!target) {
            return sendHtml(res,
              `<p>Test ${escHtml(test)} has no <code>uat:url</code> marker, so there is nothing to open.</p>`, 404);
          }
          ctx.currentTest = test;
          console.log(`  tester is now on test ${test} -> ${target}`);
          res.writeHead(302, { Location: target, 'Cache-Control': 'no-store' });
          return res.end();
        }
        if (urlPath === '/api/current-test') {
          let sections = [];
          try { ({ sections } = ctx.index()); } catch { sections = []; }
          const listing = sections.flatMap((sec) => sec.tests.map((t) => ({ id: t.id, title: t.title })));
          const cur = ctx.currentTest;
          const hit = listing.find((t) => t.id === cur);
          return sendJson(res, { test: cur, title: hit ? hit.title : '', tests: listing });
        }
        if (urlPath === '/api/annotations') {
          const after = Number(query.get('after') || 0) || 0;
          return sendJson(res, { items: ctx.annotations.slice(after), cursor: ctx.annotations.length });
        }
        if (urlPath === '/annotate.js') {
          // the bookmarklet carries this inline (so a strict CSP cannot block it);
          // this route is the same code, for diagnostics and for pages without a CSP
          const data = fs.readFileSync(path.join(ASSETS_DIR, 'annotate.js'));
          res.writeHead(200, {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Content-Length': data.length, 'X-Content-Type-Options': 'nosniff', ...corsHeaders(res),
          });
          return res.end(data);
        }
        if (urlPath.startsWith('/vendor/')) {
          const name = path.basename(urlPath);
          const full = path.join(ASSETS_DIR, 'vendor', name);
          if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
            return sendJson(res, { error: 'not found' }, 404);
          }
          const data = fs.readFileSync(full);
          res.writeHead(200, {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Content-Length': data.length, 'X-Content-Type-Options': 'nosniff', ...corsHeaders(res),
          });
          return res.end(data);
        }
        if (urlPath === '/api/state') {
          let state = {};
          if (fs.existsSync(ctx.progressPath)) {
            try { state = JSON.parse(fs.readFileSync(ctx.progressPath, 'utf8')); } catch { state = {}; }
          }
          return sendJson(res, { state });
        }
        const full = safePath(ctx, urlPath);
        if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
          return sendJson(res, { error: 'not found' }, 404);
        }
        const data = fs.readFileSync(full);
        res.writeHead(200, {
          'Content-Type': MIME_BY_EXT[path.extname(full).toLowerCase()] || 'application/octet-stream',
          'Content-Length': data.length,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        return res.end(data);
      }

      if (req.method === 'POST') {
        if (urlPath === '/receive') {
          // CSP fallback: the annotator submits a form into a popup instead of fetching
          let data;
          try { data = JSON.parse(new URLSearchParams(await readBody(req)).get('payload') || '{}'); }
          catch { return sendHtml(res, '<p>That did not arrive in one piece. Please try again.</p>', 400); }
          const result = storeAnnotation(ctx, data);
          if (!result.ok) return sendHtml(res, `<p>Could not save: ${escHtml(result.error)}</p>`, 400);
          return sendHtml(res,
            '<title>Saved</title><body style="font:16px system-ui;padding:28px;text-align:center">'
            + `<h2>Saved to test ${escHtml(data.test)}</h2>`
            + '<p>You can close this window and go back to the checklist.</p>'
            + '<script>setTimeout(function(){window.close()},1500)</script>');
        }

        let payload;
        try { payload = await readJson(req); }
        catch (err) { return sendJson(res, { error: `bad request: ${err.message}` }, 400); }

        if (urlPath === '/api/annotate') return sendJson(res, storeAnnotation(ctx, payload));

        if (urlPath === '/api/save') {
          const state = payload.state || {};
          state.updatedAt = Date.now();
          fs.writeFileSync(ctx.progressPath, JSON.stringify(state, null, 2), 'utf8');
          console.log(`  saved progress (${Object.keys(state.answers || {}).length} answers)`);
          return sendJson(res, { ok: true });
        }
        if (urlPath === '/api/upload') return handleUpload(ctx, payload, res);
        if (urlPath === '/api/submit') return handleSubmit(ctx, payload, res);
      }
      return sendJson(res, { error: 'unknown endpoint' }, 404);
    } catch (err) {
      return sendJson(res, { error: String(err && err.message || err) }, 500);
    }
  });
}

function listen(server, port, attempt = 0) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      if (err.code === 'EADDRINUSE' && attempt < 19) {
        server.removeListener('error', onError);
        resolve(listen(server, port + 1, attempt + 1));
      } else reject(err);
    };
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError);
      resolve(port);
    });
  });
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
      : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref(); } catch { /* not important */ }
}

async function main(argv) {
  const args = argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) {
    console.log('usage: node uat-server.mjs <UAT.md> [-p PORT] [--no-browser]');
    return args.length ? 0 : 2;
  }
  const pi = Math.max(args.indexOf('-p'), args.indexOf('--port'));
  const port = pi > -1 ? Number(args[pi + 1]) : 8777;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Port must be a whole number between 1 and 65535, got ${args[pi + 1]}.`);
    return 2;
  }
  const noBrowser = args.includes('--no-browser');
  const md = args.find((a, i) => !a.startsWith('-') && (pi === -1 || i !== pi + 1));

  if (!md || !fs.existsSync(md)) { console.error(`No such file: ${md}`); return 2; }
  const ctx = new Ctx(md);
  try { generate(ctx.mdPath, ctx.htmlPath, true); }
  catch (err) {
    if (err instanceof UatError) { console.error(`UAT file problem: ${err.message}`); return 2; }
    throw err;
  }

  const server = makeServer(ctx);
  const actual = await listen(server, port);
  ctx.port = actual;
  const url = `http://localhost:${actual}/`;
  console.log('');
  console.log('  UAT helper is running.');
  console.log(`  Checklist : ${ctx.mdPath}`);
  console.log(`  Open this in your web browser:  ${url}`);
  console.log('  Leave this window open while you work. Press Ctrl+C here when you are finished.');
  console.log('');
  if (!noBrowser) setTimeout(() => openBrowser(url), 600);
  process.on('SIGINT', () => {
    console.log(`\n  Stopped. Your answers are in ${ctx.progressPath}`);
    process.exit(0);
  });
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv).then((code) => { if (code) process.exit(code); });
}
