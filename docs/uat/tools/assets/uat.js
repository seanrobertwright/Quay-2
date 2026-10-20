/* UAT form runtime. Shared by the Python and Node generators (inlined into the HTML).
   Talks to the local helper server: GET api/state, POST api/save, api/upload, api/submit.
   If no server is present (file:// or server stopped) it degrades to localStorage-only
   and disables Submit, telling the tester exactly what to run. */
(function () {
  'use strict';

  var MODEL = JSON.parse(document.getElementById('uat-model').textContent);
  var LS_KEY = 'uat:' + MODEL.file;
  var SEVERITIES = [['', '— pick one —'], ['cosmetic', 'Cosmetic — it just looks off'],
                    ['annoying', 'Annoying — it works but it bugs me'],
                    ['blocker', 'Blocks me — I could not carry on because of it']];
  var STATUS_LABEL = { '': 'Not answered yet', pass: 'Pass', fail: 'Fail', notdone: 'Not done' };
  var LEVEL_LABEL = {
    novice: 'written for a first-time tester',
    intermediate: 'written for a confident computer user',
    expert: 'written for a developer or QA engineer'
  };

  var state = { tester: '', answers: {}, findings: [], nextFinding: 1, annotCursor: 0 };
  var online = false, dirty = false, lastOwner = null, filter = 'all';
  var els = {};
  var TESTS = [];
  MODEL.sections.forEach(function (s) { s.tests.forEach(function (t) { TESTS.push({ t: t, s: s }); }); });

  /* ------------------------------------------------------------------ utils */

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'html') e.innerHTML = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function ans(id) {
    if (!state.answers[id]) state.answers[id] = { status: '', notes: '', concern: '', severity: '', screenshots: [] };
    if (!state.answers[id].screenshots) state.answers[id].screenshots = [];
    return state.answers[id];
  }
  function post(path, body) {
    return fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, data: j }; }); });
  }

  /* ------------------------------------------------------------- persistence */

  function markDirty() {
    dirty = true;
    els.savestate.textContent = 'unsaved changes';
    els.savestate.className = 'savestate dirty';
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* quota — server save still works */ }
  }
  function markSaved(msg) {
    dirty = false;
    els.savestate.textContent = msg || 'saved';
    els.savestate.className = 'savestate saved';
  }

  function save(silent) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {}
    if (!online) { markSaved('saved in browser'); return Promise.resolve(); }
    return post('api/save', { state: state }).then(function (r) {
      if (r.ok) markSaved('saved ' + new Date().toLocaleTimeString());
      else if (!silent) alert('Could not save: ' + (r.data.error || 'unknown error'));
    }).catch(function () {
      online = false; offlineBanner();
      if (!silent) alert('Lost contact with the helper program. Your work is still stored in this browser.\n' +
                         'Restart the helper and click Save again.');
    });
  }

  /* -------------------------------------------------------------- validation */

  function validate(partial) {
    var problems = [];
    if (!state.tester.trim()) problems.push({ id: null, msg: 'Type your name in the "Tester" box at the bottom.' });
    TESTS.forEach(function (row) {
      var id = row.t.id, a = ans(id);
      if (!a.status) {
        if (!partial) problems.push({ id: id, msg: 'Test ' + id + ' has no answer yet (Pass, Fail or Not done).' });
        return;
      }
      if (a.status === 'fail' && a.notes.trim().length < 10)
        problems.push({ id: id, msg: 'Test ' + id + ' is marked Fail — describe what happened in "What happened" (at least a sentence).' });
      if (a.status === 'notdone' && a.notes.trim().length < 10)
        problems.push({ id: id, msg: 'Test ' + id + ' is marked Not done — say why you could not do it.' });
      if (a.concern.trim() && !a.severity)
        problems.push({ id: id, msg: 'Test ' + id + ' has a look-and-feel comment — choose how much it bothers you.' });
    });
    state.findings.forEach(function (f) {
      if (!f.title.trim()) problems.push({ id: f.id, msg: 'Finding ' + f.id + ' needs a short title.' });
      if (!f.description.trim()) problems.push({ id: f.id, msg: 'Finding ' + f.id + ' needs a description of what you saw.' });
      if (!f.severity) problems.push({ id: f.id, msg: 'Finding ' + f.id + ' needs a severity.' });
    });
    return problems;
  }

  /* ------------------------------------------------------------------ counts */

  function counts() {
    var c = { pass: 0, fail: 0, notdone: 0, unanswered: 0, concerns: 0 };
    TESTS.forEach(function (row) {
      var a = ans(row.t.id);
      if (a.status) c[a.status]++; else c.unanswered++;
      if (a.concern.trim()) c.concerns++;
    });
    return c;
  }

  function refresh() {
    var c = counts(), total = TESTS.length, done = total - c.unanswered;
    els.cPass.textContent = c.pass + ' pass';
    els.cFail.textContent = c.fail + ' fail';
    els.cSkip.textContent = c.notdone + ' not done';
    els.cConcern.textContent = c.concerns + ' concern' + (c.concerns === 1 ? '' : 's');
    els.cLeft.textContent = c.unanswered + ' left';
    els.bar.style.width = total ? Math.round(done / total * 100) + '%' : '0%';
    els.progressLabel.textContent = done + ' of ' + total + ' answered';
    document.querySelectorAll('.dot[data-for]').forEach(function (d) {
      var a = ans(d.getAttribute('data-for'));
      d.className = 'dot' + (a.status ? ' ' + a.status : '');
    });
    applyFilter();
  }

  function applyFilter() {
    document.querySelectorAll('.test').forEach(function (card) {
      var a = ans(card.getAttribute('data-id')), show = true;
      if (filter === 'unanswered') show = !a.status;
      else if (filter === 'fail') show = a.status === 'fail';
      else if (filter === 'concern') show = !!a.concern.trim();
      card.classList.toggle('hidden', !show);
    });
  }

  /* ------------------------------------------------------------- screenshots */

  function addShots(ownerId, files, render) {
    var list = Array.prototype.slice.call(files).filter(function (f) { return f && /^image\//.test(f.type); });
    if (!list.length) return;
    var bucket = ownerScreens(ownerId);
    if (bucket.length + list.length > 6) { alert('You can attach up to 6 pictures here.'); return; }
    list.forEach(function (file) {
      if (file.size > 8 * 1024 * 1024) { alert('That picture is bigger than 8 MB — please use a smaller one.'); return; }
      var fr = new FileReader();
      fr.onload = function () {
        var dataUrl = fr.result;
        if (!online) {
          bucket.push({ path: dataUrl, name: file.name || 'pasted image', local: true });
          markDirty(); render();
          return;
        }
        post('api/upload', { owner: ownerId, dataUrl: dataUrl, filename: file.name || 'pasted.png' })
          .then(function (r) {
            if (r.ok && r.data.path) { bucket.push({ path: r.data.path, name: r.data.path.split('/').pop() }); markDirty(); render(); }
            else alert('Could not save that picture: ' + (r.data.error || 'unknown error'));
          }).catch(function () { alert('Could not save that picture — is the helper program still running?'); });
      };
      fr.readAsDataURL(file);
    });
  }

  function ownerScreens(ownerId) {
    if (ownerId.charAt(0) === 'F') {
      var f = state.findings.filter(function (x) { return x.id === ownerId; })[0];
      if (!f.screenshots) f.screenshots = [];
      return f.screenshots;
    }
    return ans(ownerId).screenshots;
  }

  function shotWidget(ownerId) {
    var wrap = h('div', { class: 'shots' });
    var thumbs = h('div', { class: 'thumbs' });
    var input = h('input', { type: 'file', accept: 'image/*', multiple: 'multiple', style: 'display:none' });
    var zone = h('div', {
      class: 'dropzone', tabindex: '0',
      text: 'Add a picture — click here to choose a file, drag one in, or copy a screenshot and press Ctrl+V (Cmd+V on a Mac)'
    });
    function render() {
      thumbs.innerHTML = '';
      ownerScreens(ownerId).forEach(function (s, i) {
        var img = h('img', { src: s.path, alt: 'screenshot ' + (i + 1), loading: 'lazy',
          onclick: function () { lightbox(s.path); } });
        thumbs.appendChild(h('div', { class: 'thumb' }, [
          img,
          h('div', { class: 'cap', text: s.name || ('image ' + (i + 1)) }),
          h('button', { class: 'rm', title: 'Remove this picture', type: 'button', text: '×',
            onclick: function () { ownerScreens(ownerId).splice(i, 1); markDirty(); render(); } })
        ]));
      });
    }
    zone.addEventListener('click', function () { input.click(); });
    zone.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', function () { zone.classList.remove('over'); });
    zone.addEventListener('drop', function (e) {
      e.preventDefault(); zone.classList.remove('over');
      addShots(ownerId, e.dataTransfer.files, render);
    });
    input.addEventListener('change', function () { addShots(ownerId, input.files, render); input.value = ''; });
    wrap.appendChild(h('label', { text: 'Pictures (optional)', style: 'display:block;font-size:13px;font-weight:700;color:var(--ink-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px' }));
    wrap.appendChild(zone); wrap.appendChild(thumbs); wrap.appendChild(input);
    wrap._render = render;
    render();
    return wrap;
  }

  function lightbox(src) {
    var box = h('div', { class: 'lightbox', onclick: function () { box.remove(); } }, [h('img', { src: src, alt: '' })]);
    document.body.appendChild(box);
  }

  /* ------------------------------------------------------------------- cards */

  function field(labelText, hint, node) {
    return h('div', { class: 'field' }, [
      h('label', {}, [document.createTextNode(labelText), hint ? h('span', { class: 'hint', text: '  ' + hint }) : null]),
      node
    ]);
  }

  function testCard(t, section) {
    var a = ans(t.id);
    var card = h('div', { class: 'test', id: 'test-' + t.id, 'data-id': t.id, 'data-status': a.status || '' });

    card.appendChild(h('h3', {}, [h('span', { class: 'tid', text: t.id }), document.createTextNode(t.title)]));
    card.appendChild(h('div', { class: 'body', html: t.body }));

    if (t.url) {
      card.appendChild(h('div', { class: 'openrow' }, [
        h('a', {
          class: 'openbtn', href: 'goto?test=' + encodeURIComponent(t.id), target: '_blank',
          rel: 'noopener', text: 'Open this screen and annotate it ↗'
        }),
        h('span', { class: 'openurl', text: t.url })
      ]));
    }

    var answer = h('div', { class: 'answer' });

    // status — '' is the starting state and is shown as its own chip, so an
    // untouched test reads as "not answered yet" rather than as a blank row
    var row = h('div', { class: 'statusrow' }, [h('span', { class: 'lbl', text: 'Result' })]);
    ['', 'pass', 'fail', 'notdone'].forEach(function (v) {
      var input = h('input', {
        type: 'radio', name: 'st-' + t.id, value: v, checked: a.status === v,
        title: v ? null : 'I have not got to this test yet'
      });
      input.addEventListener('change', function () {
        a.status = v; card.setAttribute('data-status', v); markDirty(); refresh(); syncRequired();
      });
      row.appendChild(h('label', { class: 'radio' }, [
        input, h('span', { class: v || 'unanswered', text: STATUS_LABEL[v] })
      ]));
    });
    answer.appendChild(row);

    // notes
    var notes = h('textarea', { placeholder: 'If it failed, write down exactly what you saw — the wording of any error message helps most.' });
    notes.value = a.notes;
    notes.addEventListener('input', function () { a.notes = notes.value; markDirty(); syncRequired(); });
    var notesField = field('What happened', '(required if you chose Fail or Not done)', notes);
    answer.appendChild(notesField);

    // look and feel concern
    var concern = h('textarea', { placeholder: 'Anything about how this looks or feels that you are not happy with? Wording, colours, layout, speed, confusing labels...' });
    concern.value = a.concern;
    var sev = h('select', {});
    SEVERITIES.forEach(function (s) { sev.appendChild(h('option', { value: s[0], text: s[1], selected: a.severity === s[0] })); });
    sev.addEventListener('change', function () { a.severity = sev.value; markDirty(); refresh(); syncRequired(); });
    concern.addEventListener('input', function () { a.concern = concern.value; markDirty(); refresh(); syncRequired(); });
    var cbox = h('div', { class: 'concernbox' }, [
      h('label', { text: 'Look & feel comment (optional — a test can pass and still bother you)' }),
      concern,
      h('div', { class: 'concernrow' }, [h('label', { text: 'How much does it bother you?' }), sev])
    ]);
    answer.appendChild(cbox);

    answer.appendChild(shotWidget(t.id));
    card.appendChild(answer);

    function syncRequired() {
      var needNotes = (a.status === 'fail' || a.status === 'notdone') && a.notes.trim().length < 10;
      notesField.classList.toggle('required-miss', needNotes);
      cbox.classList.toggle('required-miss', !!a.concern.trim() && !a.severity);
    }
    syncRequired();
    return card;
  }

  function findingCard(f) {
    var card = h('div', { class: 'finding', id: 'test-' + f.id });
    var title = h('input', { type: 'text', placeholder: 'One line: what is wrong? e.g. "The menu disappears when the window is narrow"' });
    title.value = f.title;
    title.addEventListener('input', function () { f.title = title.value; markDirty(); });
    var desc = h('textarea', { placeholder: 'What were you doing, what did you expect, and what happened instead?' });
    desc.value = f.description;
    desc.addEventListener('input', function () { f.description = desc.value; markDirty(); });
    var sev = h('select', {});
    SEVERITIES.forEach(function (s) { sev.appendChild(h('option', { value: s[0], text: s[1], selected: f.severity === s[0] })); });
    sev.addEventListener('change', function () { f.severity = sev.value; markDirty(); });

    card.appendChild(h('h4', {}, [
      document.createTextNode('Finding ' + f.id + (f.section ? ' — reported from Section ' + f.section : '')),
      h('button', { class: 'ghost small', type: 'button', text: 'delete', style: 'float:right',
        onclick: function () {
          if (!confirm('Delete finding ' + f.id + '?')) return;
          state.findings = state.findings.filter(function (x) { return x !== f; });
          card.remove(); markDirty();
        } })
    ]));
    card.appendChild(field('What is wrong', '', title));
    card.appendChild(field('Tell us more', '', desc));
    card.appendChild(field('How much does it bother you?', '', sev));
    card.appendChild(shotWidget(f.id));
    return card;
  }

  function addFinding(sectionId, container) {
    var f = { id: 'F' + state.nextFinding++, section: sectionId || '', title: '', description: '', severity: '', screenshots: [] };
    state.findings.push(f);
    var card = findingCard(f);
    (container || els.findings).appendChild(card);
    markDirty();
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var input = card.querySelector('input[type="text"]'); if (input) input.focus();
  }

  /* ------------------------------------------------------------ annotations */

  /* The annotator posts to the helper from the app's own tab; when the tester
     comes back here we collect whatever arrived and fold it into their answers. */

  function bookmarkletHref() {
    return 'javascript:(function(){window.__uatHelper='
      + encodeURIComponent(JSON.stringify(location.origin))
      + ';' + encodeURIComponent(MODEL.annotator) + '})();void 0;';
  }

  function annotationNote(a) {
    var lines = ['— Annotated ' + a.at + (a.url ? ' · ' + a.url : '')
                 + (a.viewport ? ' · ' + a.viewport : '')];
    a.pins.forEach(function (p) {
      var where = p.selector ? '  [' + p.selector + (p.text ? ' “' + p.text + '”' : '') + ']' : '';
      lines.push('  ' + circled(p.n) + ' ' + p.comment + where);
    });
    (a.consoleErrors || []).forEach(function (e) { lines.push('  ! console: ' + e); });
    if (a.browser) lines.push('  browser: ' + a.browser);
    return lines.join('\n');
  }

  function circled(n) {
    return (n >= 1 && n <= 20) ? String.fromCharCode(0x245F + n) : '(' + n + ')';
  }

  function mergeAnnotations(items) {
    if (!items || !items.length) return 0;
    var touched = {};
    items.forEach(function (a) {
      var t = ans(a.test);
      if (a.image) t.screenshots.push({ path: a.image, name: a.image.split('/').pop() });
      t.notes = (t.notes ? t.notes.replace(/\s+$/, '') + '\n' : '') + annotationNote(a);
      touched[a.test] = true;
      var card = document.getElementById('test-' + a.test);
      if (card) {
        var ta = card.querySelector('textarea');
        if (ta) ta.value = t.notes;
        var shots = card.querySelector('.shots');
        if (shots && shots._render) shots._render();
        card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
      }
    });
    markDirty();
    refresh();
    save(true);
    return Object.keys(touched).length;
  }

  function collectAnnotations(announce) {
    if (!online || !MODEL.annotator) return;
    fetch('api/annotations?after=' + (state.annotCursor || 0), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.items || !j.items.length) return;
        state.annotCursor = j.cursor;
        var n = mergeAnnotations(j.items);
        if (announce !== false) {
          toast(j.items.length + ' annotation' + (j.items.length === 1 ? '' : 's')
            + ' added to ' + n + ' test' + (n === 1 ? '' : 's') + '.');
        }
      })
      .catch(function () { /* helper went away; the banner already says so */ });
  }

  function toast(msg) {
    var t = h('div', { class: 'toast', text: msg });
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 6000);
  }

  /* -------------------------------------------------------------------- shell */

  function offlineBanner() {
    if ($('#offline-banner')) return;
    var b = h('div', { class: 'banner', id: 'offline-banner' }, [
      h('strong', { text: 'The helper program is not running. ' }),
      document.createTextNode('Your answers are being kept in this browser only, and the Submit button is switched off. ' +
        'To turn it back on, start the helper (see the instructions at the top of this page), then reload this page — ' +
        'your answers will still be here.')
    ]);
    els.main.insertBefore(b, els.main.firstChild);
    if (els.submit) { els.submit.disabled = true; els.submit.title = 'Start the helper program first'; }
    if (els.partial) { els.partial.disabled = true; }
  }

  function build() {
    var top = h('div', { class: 'topbar' }, [
      h('div', { class: 'topbar-inner' }, [
        h('div', {}, [
          h('h1', { text: MODEL.title }),
          h('div', {
            class: 'file',
            text: MODEL.file + (LEVEL_LABEL[MODEL.level] ? '  ·  ' + LEVEL_LABEL[MODEL.level] : '')
          })
        ]),
        h('div', { class: 'spacer' }),
        els.counts = h('div', { class: 'counts' }, [
          els.cPass = h('span', { class: 'pill pass', text: '0 pass' }),
          els.cFail = h('span', { class: 'pill fail', text: '0 fail' }),
          els.cSkip = h('span', { class: 'pill notdone', text: '0 not done' }),
          els.cConcern = h('span', { class: 'pill concern', text: '0 concerns' }),
          els.cLeft = h('span', { class: 'pill', text: '0 left' })
        ]),
        els.savestate = h('span', { class: 'savestate', text: 'not saved yet' }),
        h('button', { type: 'button', text: 'Save my work', onclick: function () { save(false); } }),
        els.submit = h('button', { class: 'primary', type: 'button', text: 'Submit', onclick: function () { submit(false); } })
      ]),
      h('div', { style: 'max-width:1400px;margin:0 auto;padding:0 20px 10px;display:flex;gap:12px;align-items:center' }, [
        h('div', { class: 'progress', style: 'flex:1' }, [els.bar = h('span', { style: 'width:0%' })]),
        els.progressLabel = h('span', { class: 'file', text: '' })
      ])
    ]);
    document.body.appendChild(top);

    var toc = h('nav', { class: 'toc' }, [h('h2', { text: 'Sections' })]);
    MODEL.sections.forEach(function (s) {
      var dots = h('span', { class: 'dots' });
      s.tests.forEach(function (t) { dots.appendChild(h('span', { class: 'dot', 'data-for': t.id })); });
      toc.appendChild(h('a', { href: '#section-' + s.id }, [
        h('span', { class: 'tocnum', text: s.id }), h('span', { text: s.title }), dots
      ]));
    });
    toc.appendChild(h('a', { href: '#findings' }, [h('span', { class: 'tocnum', text: '⚑' }), h('span', { text: 'Other findings' })]));

    els.main = h('main', {});
    var layout = h('div', { class: 'layout' }, [toc, els.main]);
    document.body.appendChild(layout);

    if (MODEL.intro) els.main.appendChild(h('section', { class: 'panel intro', html: MODEL.intro }));

    if (MODEL.annotator) els.main.appendChild(bookmarkletCard());

    var filters = h('div', { class: 'filters' }, [h('span', { class: 'lbl', text: 'Show:' })]);
    [['all', 'Everything'], ['unanswered', 'Still to do'], ['fail', 'Failures'], ['concern', 'With comments']].forEach(function (f) {
      var b = h('button', { class: 'chip', type: 'button', text: f[1], 'aria-pressed': filter === f[0] });
      b.addEventListener('click', function () {
        filter = f[0];
        filters.querySelectorAll('.chip').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
        applyFilter();
      });
      filters.appendChild(b);
    });
    els.main.appendChild(filters);

    MODEL.sections.forEach(function (s) {
      var sec = h('section', { class: 'section', id: 'section-' + s.id }, [
        h('h2', { text: 'Section ' + s.id + ' — ' + s.title })
      ]);
      s.tests.forEach(function (t) { sec.appendChild(testCard(t, s)); });
      var holder = h('div', {});
      sec.appendChild(holder);
      sec.appendChild(h('div', { class: 'addfinding' }, [
        h('button', { class: 'small', type: 'button', text: '+ Report something else you noticed in this section',
          onclick: function () { addFinding(s.id, holder); } })
      ]));
      els.main.appendChild(sec);
    });

    if (MODEL.outro) els.main.appendChild(h('section', { class: 'panel intro', html: MODEL.outro }));

    els.findings = h('div', {});
    els.main.appendChild(h('section', { class: 'panel', id: 'findings' }, [
      h('h2', { text: 'Anything else you noticed' }),
      h('p', { class: 'intro', text: 'Problems that no test above asked about. Add as many as you like — each one is written into the report with its pictures.' }),
      els.findings,
      h('div', { class: 'addfinding' }, [
        h('button', { type: 'button', text: '+ Report something else', onclick: function () { addFinding('', els.findings); } })
      ])
    ]));

    var testerInput = h('input', { type: 'text', placeholder: 'Your name', id: 'tester' });
    testerInput.value = state.tester;
    testerInput.addEventListener('input', function () { state.tester = testerInput.value; markDirty(); });
    els.main.appendChild(h('div', { class: 'footerbar' }, [
      h('span', { class: 'tester' }, [h('label', { for: 'tester', style: 'font-weight:700;font-size:13px;color:var(--ink-3)', text: 'TESTER' }), testerInput]),
      h('div', { class: 'spacer' }),
      h('button', { type: 'button', text: 'Save my work', onclick: function () { save(false); } }),
      els.partial = h('button', { type: 'button', text: 'Submit what I have so far', onclick: function () { submit(true); } }),
      h('button', { class: 'primary', type: 'button', text: 'Submit', onclick: function () { submit(false); } })
    ]));
  }

  function bookmarkletCard() {
    var link = h('a', { class: 'bmlet', text: '✎ Annotate this page' });
    link.href = bookmarkletHref();
    link.addEventListener('click', function (e) {
      e.preventDefault();
      alert('Do not click this button here — drag it up to your bookmarks bar instead.\n\n'
        + 'Then, when you are looking at the app, click it there to leave notes on the page.');
    });
    var box = h('details', { class: 'panel setup' }, [
      h('summary', { text: 'One-time setup: the “Annotate this page” button' }),
      h('p', { text: 'Some tests below have an "Open this screen and annotate it" button. To leave '
        + 'notes directly on the app, you need this button on your bookmarks bar first. You only '
        + 'ever do this once.' }),
      h('ol', {}, [
        h('li', { html: 'Show your bookmarks bar if it is hidden: press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> '
          + '(<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> on a Mac). A thin strip of links appears under the address bar.' }),
        h('li', {}, [document.createTextNode('Drag this button up onto that strip: '), link]),
        h('li', { text: 'That is it. When you are on the app and want to leave a note, click the '
          + 'button on your bookmarks bar and pins appear.' })
      ]),
      h('p', { class: 'hint', text: 'It only ever talks to this checklist on your own computer, '
        + 'and it disappears from the app page as soon as you close it.' })
    ]);
    box.open = true;
    return box;
  }

  /* ------------------------------------------------------------------ submit */

  function modal(kids) {
    var ov = h('div', { class: 'overlay', onclick: function (e) { if (e.target === ov) ov.remove(); } },
      [h('div', { class: 'modal' }, kids)]);
    document.body.appendChild(ov);
    return ov;
  }

  function jumpTo(id) {
    var el = document.getElementById('test-' + id);
    if (!el) return;
    filter = 'all';
    document.querySelectorAll('.chip').forEach(function (x, i) { x.setAttribute('aria-pressed', i === 0); });
    applyFilter();
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }

  function submit(partial) {
    if (!online) {
      modal([h('h2', { text: 'The helper program is not running' }),
        h('p', { text: 'Submitting writes your answers into the checklist file on your computer, and only the helper program can do that.' }),
        h('p', { text: 'Start it in a terminal, reload this page, then press Submit again. Your answers are safe in this browser in the meantime.' }),
        h('div', { class: 'actions' }, [h('button', { class: 'primary', type: 'button', text: 'OK', onclick: function () { $('.overlay').remove(); } })])]);
      return;
    }
    var problems = validate(partial);
    if (problems.length) {
      var list = h('ul', {});
      problems.slice(0, 40).forEach(function (p) {
        list.appendChild(h('li', {}, [
          document.createTextNode(p.msg + ' '),
          p.id ? h('button', { class: 'jump', type: 'button', text: 'take me there',
            onclick: function () { $('.overlay').remove(); jumpTo(p.id); } }) : null
        ]));
      });
      var ov = modal([
        h('h2', { text: partial ? 'Fix these before submitting' : 'Not finished yet' }),
        h('p', { text: problems.length + ' thing' + (problems.length === 1 ? '' : 's') + ' need' + (problems.length === 1 ? 's' : '') + ' your attention:' }),
        list,
        problems.length > 40 ? h('p', { text: '...and ' + (problems.length - 40) + ' more.' }) : null,
        h('div', { class: 'actions' }, [
          h('button', { type: 'button', text: 'Back to the checklist', onclick: function () { ov.remove(); } }),
          partial ? null : h('button', { type: 'button', text: 'Submit what I have so far',
            onclick: function () { ov.remove(); submit(true); } })
        ])
      ]);
      return;
    }
    var c = counts();
    if (partial && c.unanswered > 0 &&
        !confirm(c.unanswered + ' test(s) have no answer. The report will be clearly marked as an unfinished run. Carry on?')) return;

    post('api/submit', { state: state, partial: partial }).then(function (r) {
      if (!r.ok || !r.data.ok) {
        modal([h('h2', { text: 'Could not submit' }),
          h('p', { text: r.data.error || 'Unknown error.' }),
          (r.data.problems || []).length ? h('ul', {}, r.data.problems.map(function (p) { return h('li', { text: p.msg || p }); })) : null,
          h('div', { class: 'actions' }, [h('button', { class: 'primary', type: 'button', text: 'OK', onclick: function () { $('.overlay').remove(); } })])]);
        return;
      }
      markSaved('submitted');
      var d = r.data;
      modal([
        h('h2', { text: d.partial ? 'Partial results saved' : 'Thank you — your results are saved' }),
        h('p', { text: d.summary }),
        h('p', { text: 'Written to:' }),
        h('code', { class: 'cmd', text: d.mdPath }),
        h('p', { text: 'Tell whoever is fixing the app that you are done. In the project folder they can run:' }),
        h('code', { class: 'cmd', text: 'process the completed UAT at ' + d.mdRel }),
        h('div', { class: 'actions' }, [
          h('button', { type: 'button', text: 'Keep editing', onclick: function () { $('.overlay').remove(); } }),
          h('button', { class: 'primary', type: 'button', text: 'Done', onclick: function () { $('.overlay').remove(); } })
        ])
      ]);
    }).catch(function () {
      online = false; offlineBanner();
      alert('Lost contact with the helper program. Your answers are safe in this browser — restart it and try again.');
    });
  }

  /* -------------------------------------------------------------------- init */

  function mergeState(loaded) {
    if (!loaded || typeof loaded !== 'object') return;
    state.tester = loaded.tester || '';
    state.answers = loaded.answers || {};
    state.findings = (loaded.findings || []).map(function (f) {
      f.screenshots = f.screenshots || []; return f;
    });
    var max = 0;
    state.findings.forEach(function (f) { var n = parseInt(String(f.id).replace(/\D/g, ''), 10); if (n > max) max = n; });
    state.nextFinding = Math.max(loaded.nextFinding || 1, max + 1);
  }

  function boot(loaded) {
    mergeState(loaded);
    build();
    state.findings.forEach(function (f) { els.findings.appendChild(findingCard(f)); });
    refresh();
    if (!online) offlineBanner();
    else markSaved('loaded');

    document.addEventListener('focusin', function (e) {
      var card = e.target.closest ? e.target.closest('.test, .finding') : null;
      if (card) lastOwner = card;
    });
    document.addEventListener('click', function (e) {
      var card = e.target.closest ? e.target.closest('.test, .finding') : null;
      if (card) lastOwner = card;
    });
    document.addEventListener('paste', function (e) {
      if (!e.clipboardData || !e.clipboardData.files || !e.clipboardData.files.length) return;
      var card = (document.activeElement && document.activeElement.closest) ? document.activeElement.closest('.test, .finding') : null;
      card = card || lastOwner;
      if (!card) { alert('Click inside the test you want the picture to belong to first, then paste again.'); return; }
      e.preventDefault();
      var widget = card.querySelector('.shots');
      addShots(card.id.replace(/^test-/, ''), e.clipboardData.files, widget._render);
    });
    window.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(false); }
    });
    window.addEventListener('beforeunload', function (e) {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });
    setInterval(function () { if (dirty) save(true); }, 60000);

    if (MODEL.annotator) {
      window.addEventListener('focus', function () { collectAnnotations(); });
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) collectAnnotations();
      });
      setInterval(function () { if (!document.hidden) collectAnnotations(); }, 10000);
      collectAnnotations(false);
    }
  }

  var local = null;
  try { local = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) {}

  fetch('api/state', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw 0; return r.json(); })
    .then(function (j) {
      online = true;
      var server = j && j.state ? j.state : null;
      var pick = server;
      if (local && server && (local.updatedAt || 0) > (server.updatedAt || 0)) pick = local;
      boot(pick || local);
    })
    .catch(function () { online = false; boot(local); });
})();
