#!/usr/bin/env node
/**
 * Generate the fill-in HTML form from a UAT markdown file.
 *
 *     node generate-uat-html.mjs path/to/UAT-myapp-2026-08-23.md [-o out.html]
 *
 * No dependencies. Also normalises the markdown in place: injects any missing
 * answer/summary/findings blocks so the author only has to write the tests.
 *
 * Mirrors generate_uat_html.py exactly. See ../references/uat-file-format.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, 'assets');

export const ID_RE = /^[A-Za-z0-9._-]+$/;
const META_START = /^<!--\s*uat:meta\s*$/;
const SECTION_RE = /^<!--\s*uat:section\s+(.*?)-->\s*$/;
const TEST_RE = /^<!--\s*uat:test\s+(.*?)-->\s*$/;
const URL_RE = /^<!--\s*uat:url\s+(\S+)\s*-->\s*$/;
const ANS_START_RE = /^<!--\s*uat:answer:start\s+id=(\S+)\s*-->\s*$/;
const ANS_END_RE = /^<!--\s*uat:answer:end\s+id=(\S+)\s*-->\s*$/;
const ATTR_RE = /(\w+)=("([^"]*)"|\S+)/g;

const EMPTY_ANSWER = [
  '- [ ] **Status:** _not answered_',
  '- **Notes:**',
  '- **Look & feel concern:**',
  '- **Screenshots:**',
];
const SUMMARY_BLOCK = [
  '<!-- uat:summary:start -->',
  '_This UAT has not been run yet._',
  '<!-- uat:summary:end -->',
];
const FINDINGS_BLOCK = [
  '<!-- uat:findings:start -->',
  '## Anything else the tester noticed',
  '',
  '_No tester-reported findings yet._',
  '<!-- uat:findings:end -->',
];

export class UatError extends Error {}

/* --------------------------------------------------------------- markdown */

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const INLINE_SRC = '`([^`]+)`|\\[([^\\]]+)\\]\\(([^)\\s]+)\\)|\\*\\*([^*]+)\\*\\*|\\*([^*\\n]+)\\*';

function inline(text) {
  // a fresh regex per call: inline() recurses, and a shared /g regex would share lastIndex
  const re = new RegExp(INLINE_SRC, 'g');
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    out += escapeHtml(text.slice(last, m.index));
    if (m[1] !== undefined) out += `<code>${escapeHtml(m[1])}</code>`;
    else if (m[2] !== undefined) out += `<a href="${escapeHtml(m[3]).replace(/"/g, '&quot;')}" rel="noreferrer">${inline(m[2])}</a>`;
    else if (m[4] !== undefined) out += `<strong>${inline(m[4])}</strong>`;
    else out += `<em>${inline(m[5])}</em>`;
    last = re.lastIndex;
  }
  return out + escapeHtml(text.slice(last));
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const indentOf = (line) => line.length - line.replace(/^ +/, '').length;

function renderList(lines, i, baseIndent, out) {
  const first = LIST_ITEM.exec(lines[i]);
  const ordered = !['-', '*', '+'].includes(first[2]);
  const tag = ordered ? 'ol' : 'ul';
  out.push(`<${tag}>`);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && LIST_ITEM.test(lines[j]) && indentOf(lines[j]) >= baseIndent) { i = j; continue; }
      break;
    }
    const m = LIST_ITEM.exec(line);
    if (!m) break;
    const ind = m[1].length;
    if (ind < baseIndent) break;
    if (ind > baseIndent) { i = renderList(lines, i, ind, out); continue; }
    let text = m[3];
    i++;
    // a wrapped item continues on the next indented line — keep it inside the <li>
    while (i < lines.length && lines[i].trim() && !LIST_ITEM.test(lines[i]) && indentOf(lines[i]) > baseIndent) {
      text += ' ' + lines[i].trim();
      i++;
    }
    out.push(`<li>${inline(text)}`);
    if (i < lines.length) {
      const nm = LIST_ITEM.exec(lines[i]);
      if (nm && nm[1].length > baseIndent) i = renderList(lines, i, nm[1].length, out);
    }
    out.push('</li>');
  }
  out.push(`</${tag}>`);
  return i;
}

export function renderMd(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const s = line.trim();
    if (!s) { i++; continue; }
    if (s.startsWith('<!--')) { i++; continue; }
    if (s.startsWith('```')) {
      i++;
      const buf = [];
      while (i < lines.length && !lines[i].trim().startsWith('```')) { buf.push(lines[i]); i++; }
      i++;
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if (s.startsWith('#')) {
      const level = s.length - s.replace(/^#+/, '').length;
      const tag = `h${Math.min(level + 1, 6)}`;
      out.push(`<${tag}>${inline(s.replace(/^#+\s*/, '').trim())}</${tag}>`);
      i++;
      continue;
    }
    if (s.startsWith('>')) {
      const buf = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) { buf.push(lines[i].trim().replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }
    if (LIST_ITEM.test(line)) { i = renderList(lines, i, indentOf(line), out); continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !LIST_ITEM.test(lines[i])
           && !/^(#|```|<!--|>)/.test(lines[i].trim())) { buf.push(lines[i].trim()); i++; }
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}

const ABSOLUTE_URL = /^[a-zA-Z][\w+.-]*:\/\//;

/** A uat:url may be absolute, or relative to the meta block's base_url. */
export function resolveUrl(url, base) {
  url = (url || '').trim();
  if (!url || ABSOLUTE_URL.test(url)) return url;
  if (!base) return url;
  return base + (url.startsWith('/') ? '' : '/') + url;
}

/* ------------------------------------------------------------------ parse */

function parseAttrs(raw) {
  const attrs = {};
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(raw)) !== null) attrs[m[1]] = m[3] !== undefined ? m[3] : m[2];
  return attrs;
}

export function parse(lines) {
  const meta = {}, sections = [];
  const spans = { answers: {}, summary: null, findings: null, meta: null };
  let curSection = null, curTest = null, heading = null;
  const seen = new Set();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const s = line.trim();

    if (META_START.test(s)) {
      const start = i;
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('-->')) {
        const idx = lines[i].indexOf(':');
        if (idx > -1) meta[lines[i].slice(0, idx).trim()] = lines[i].slice(idx + 1).trim();
        i++;
      }
      spans.meta = [start, i];
      i++;
      continue;
    }
    if (s === '<!-- uat:summary:start -->') {
      const start = i;
      while (i < lines.length && lines[i].trim() !== '<!-- uat:summary:end -->') i++;
      spans.summary = [start, i];
      i++;
      continue;
    }
    if (s === '<!-- uat:findings:start -->') {
      const start = i;
      while (i < lines.length && lines[i].trim() !== '<!-- uat:findings:end -->') i++;
      spans.findings = [start, i];
      i++;
      continue;
    }

    let m = ANS_START_RE.exec(s);
    if (m) {
      const aid = m[1];
      const start = i;
      while (i < lines.length && !ANS_END_RE.test(lines[i].trim())) i++;
      if (i >= lines.length) throw new UatError(`answer block for id=${aid} is never closed`);
      const endId = ANS_END_RE.exec(lines[i].trim())[1];
      if (endId !== aid) throw new UatError(`answer block id mismatch: starts as ${aid}, ends as ${endId}`);
      if (!curTest || curTest.id !== aid) throw new UatError(`answer block id=${aid} does not belong to the test above it`);
      spans.answers[aid] = [start, i];
      curTest._answer = [start, i];
      curTest = null;
      i++;
      continue;
    }

    if (s.startsWith('## ') && !s.startsWith('###')) heading = s.slice(3).trim();
    else if (s.startsWith('### ')) heading = s.slice(4).trim();

    m = SECTION_RE.exec(s);
    if (m) {
      const a = parseAttrs(m[1]);
      const sid = a.id;
      if (!sid || !ID_RE.test(sid)) throw new UatError(`line ${i + 1}: section needs a valid id`);
      let title = a.title || heading || `Section ${sid}`;
      title = (heading || title).replace(new RegExp(`^Section\\s+${sid}\\s*[—:-]\\s*`), '').trim() || title;
      curSection = { id: sid, title, tests: [], _line: i };
      sections.push(curSection);
      curTest = null;
      i++;
      continue;
    }

    m = TEST_RE.exec(s);
    if (m) {
      const a = parseAttrs(m[1]);
      const tid = a.id;
      if (!tid || !ID_RE.test(tid)) throw new UatError(`line ${i + 1}: test needs a valid id (letters, digits, . _ -)`);
      if (seen.has(tid)) throw new UatError(`duplicate test id ${tid} (line ${i + 1})`);
      seen.add(tid);
      if (!curSection) throw new UatError(`test ${tid} is not inside any section (add a <!-- uat:section --> marker)`);
      const title = (heading || tid).replace(new RegExp(`^${tid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`), '').trim() || tid;
      curTest = { id: tid, title, url: '', _body_start: i + 1, _marker: i, _answer: null };
      curSection.tests.push(curTest);
      i++;
      continue;
    }

    m = URL_RE.exec(s);
    if (m) {
      if (!curTest) throw new UatError(`line ${i + 1}: uat:url must sit inside a test`);
      curTest.url = m[1];
      i++;
      continue;
    }

    if (curTest && (s.startsWith('## ') || s.startsWith('### '))) {
      curTest._body_end = i;
      curTest = null;
      continue;
    }
    i++;
  }
  return { meta, sections, spans };
}

function bodyLines(lines, test) {
  const end = test._answer ? test._answer[0] : (test._body_end ?? lines.length);
  return lines.slice(test._body_start, end);
}

/* -------------------------------------------------------------- normalise */

function normalise(lines, sections, spans) {
  const inserts = [];
  for (const sec of sections) {
    for (const t of sec.tests) {
      if (t._answer) continue;
      let end = t._body_end ?? lines.length;
      while (end > t._body_start && !lines[end - 1].trim()) end--;
      inserts.push([end, ['', `<!-- uat:answer:start id=${t.id} -->`, ...EMPTY_ANSWER,
                          `<!-- uat:answer:end id=${t.id} -->`, '']]);
    }
  }
  if (!spans.summary) inserts.push([spans.meta ? spans.meta[1] + 1 : 1, ['', ...SUMMARY_BLOCK]]);
  if (!spans.findings) inserts.push([lines.length, ['', ...FINDINGS_BLOCK, '']]);
  if (!inserts.length) return { lines, changed: false };
  inserts.sort((a, b) => b[0] - a[0]);
  for (const [at, block] of inserts) lines.splice(at, 0, ...block);
  return { lines, changed: true };
}

/* -------------------------------------------------------------- build html */

function buildModel(mdPath, lines, meta, sections, spans) {
  const slug = path.basename(mdPath, path.extname(mdPath));
  const base = (meta.base_url || '').trim().replace(/\/$/, '');
  let title = meta.app || slug;
  let introStart = 0;
  for (let idx = 0; idx < lines.length; idx++) {
    if (lines[idx].startsWith('# ')) { title = lines[idx].slice(2).trim(); introStart = idx + 1; break; }
  }

  let first = sections.length ? sections[0]._line : lines.length;
  let probe = first - 1;
  while (probe > 0 && !lines[probe].trim()) probe--;
  if (probe > 0 && lines[probe].trim().startsWith('## ')) first = probe;

  const hidden = new Set();
  for (const key of ['meta', 'summary']) {
    if (spans[key]) for (let n = spans[key][0]; n <= spans[key][1]; n++) hidden.add(n);
  }
  const introLines = [];
  for (let idx = introStart; idx < first; idx++) {
    if (hidden.has(idx) || lines[idx].trim().startsWith('<!--')) continue;
    introLines.push(lines[idx]);
  }

  let lastEnd = 0;
  for (const sec of sections) {
    for (const t of sec.tests) {
      const e = t._answer ? t._answer[1] : (t._body_end ?? 0);
      if (e > lastEnd) lastEnd = e;
    }
  }
  const fspan = spans.findings;
  const outroLines = [];
  for (let idx = lastEnd + 1; idx < lines.length; idx++) {
    if (fspan && idx >= fspan[0] && idx <= fspan[1]) continue;
    if (lines[idx].trim().startsWith('<!--')) continue;
    outroLines.push(lines[idx]);
  }

  const hasUrls = sections.some((sec) => sec.tests.some((t) => t.url));
  return {
    file: path.basename(mdPath),
    slug,
    title,
    app: meta.app || '',
    level: (meta.tester_level || '').trim().toLowerCase(),
    generated: meta.generated || '',
    intro: renderMd(introLines),
    outro: renderMd(outroLines),
    annotator: hasUrls ? readAsset('annotate.js') : '',
    sections: sections.map((s) => ({
      id: s.id,
      title: s.title,
      tests: s.tests.map((t) => ({
        id: t.id, title: t.title, url: resolveUrl(t.url, base), body: renderMd(bodyLines(lines, t)),
      })),
    })),
  };
}

function readAsset(name) {
  return fs.readFileSync(path.join(ASSETS, name), 'utf8').replace(/\r\n/g, '\n');
}

function buildHtml(model) {
  const BS = String.fromCharCode(92);
  const payload = JSON.stringify(model)
    .split('<').join(BS + 'u003c')
    .split(String.fromCharCode(0x2028)).join(BS + 'u2028')
    .split(String.fromCharCode(0x2029)).join(BS + 'u2029');
  // normalise newlines: a git checkout with core.autocrlf turns these into CRLF,
  // and Python's text read strips them — inline them the same way in both runtimes
  const css = readAsset('uat.css');
  const js = readAsset('uat.js');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(model.title)}</title>
<style>
${css}
</style>
</head>
<body>
<noscript><p style="padding:20px">This checklist form needs JavaScript switched on.</p></noscript>
<script id="uat-model" type="application/json">${payload}</script>
<script>
${js}
</script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------- main */

export function generate(mdPath, outPath = null, quiet = false) {
  let lines = fs.readFileSync(mdPath, 'utf8').replace(/\r\n/g, '\n').split('\n');
  let { meta, sections, spans } = parse(lines);
  if (!sections.length) {
    throw new UatError('no sections found — every section needs a <!-- uat:section id=N title="..." --> marker');
  }
  const total = sections.reduce((n, s) => n + s.tests.length, 0);
  if (!total) throw new UatError('no tests found — every test needs a <!-- uat:test id=N.M --> marker');

  const res = normalise(lines, sections, spans);
  lines = res.lines;
  if (res.changed) {
    fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');
    ({ meta, sections, spans } = parse(lines));
    if (!quiet) console.log(`normalised ${mdPath} (added missing answer/summary/findings blocks)`);
  }

  const model = buildModel(mdPath, lines, meta, sections, spans);
  const out = outPath || mdPath.replace(/\.md$/i, '') + '.html';
  fs.writeFileSync(out, buildHtml(model), 'utf8');
  if (!quiet) console.log(`wrote ${out}  (${sections.length} sections, ${total} tests)`);
  return out;
}

function main(argv) {
  const args = argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) {
    console.log('usage: node generate-uat-html.mjs <UAT.md> [-o out.html] [-q]');
    return args.length ? 0 : 2;
  }
  const quiet = args.includes('-q') || args.includes('--quiet');
  const oi = Math.max(args.indexOf('-o'), args.indexOf('--out'));
  const out = oi > -1 ? args[oi + 1] : null;
  const md = args.find((a, i) => !a.startsWith('-') && (oi === -1 || i !== oi + 1));
  try {
    generate(md, out, quiet);
  } catch (err) {
    if (err instanceof UatError) { console.error(`UAT file problem: ${err.message}`); return 2; }
    if (err.code === 'ENOENT') { console.error(`No such file: ${md}`); return 2; }
    throw err;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv));
}
